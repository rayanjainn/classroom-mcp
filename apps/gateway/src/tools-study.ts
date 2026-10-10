import { DocSpec, type DocSpecT } from "@classroompilot/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as cr from "./classroom.js";
import type { Env, Props } from "./env.js";
import { gget } from "./google.js";
import { allText, estimatePages, toLatex } from "./latex.js";
import { draftStats, extractRequirements, type Requirement } from "./requirements.js";
import { makeKit, UNTRUSTED_NOTE, wrap } from "./toolkit.js";

const DAY = 86_400_000;

/** Plain text and heading list of a Google Doc (including table cells). */
async function docPlain(token: string, fileId: string) {
  const doc = await gget<any>(token, `https://docs.googleapis.com/v1/documents/${fileId}`);
  const paras: string[] = [];
  const headings: string[] = [];
  let tables = 0;
  let images = Object.keys(doc.inlineObjects ?? {}).length;
  const walk = (content: any[] = []) => {
    for (const el of content) {
      if (el.paragraph) {
        const text = (el.paragraph.elements ?? []).map((e: any) => e.textRun?.content ?? "").join("").replace(/\n$/, "");
        paras.push(text);
        if (/^(HEADING_\d|TITLE)/.test(el.paragraph.paragraphStyle?.namedStyleType ?? "") && text.trim()) headings.push(text.trim());
      }
      if (el.table) {
        tables++;
        for (const row of el.table.tableRows ?? []) for (const c of row.tableCells ?? []) walk(c.content);
      }
    }
  };
  walk(doc.body?.content);
  return { title: doc.title as string, text: paras.join("\n"), headings, tables, images };
}

function effortHours(w: any): number {
  if (w.workType === "SHORT_ANSWER_QUESTION" || w.workType === "MULTIPLE_CHOICE_QUESTION") return 0.4;
  const words = (w.description ?? "").split(/\s+/).filter(Boolean).length;
  const attachments = (w.materials ?? []).length;
  return Math.round((1 + Math.min(3, (w.maxPoints ?? 20) / 50) + Math.min(1.5, words / 400) + Math.min(1, attachments * 0.25)) * 10) / 10;
}

const state = (s?: string) => ({
  pending: s === "NEW" || s === "CREATED" || s === "RECLAIMED_BY_STUDENT" || s === undefined,
  done: s === "TURNED_IN" || s === "RETURNED",
});

export function registerStudyTools(server: McpServer, env: Env, props: Props) {
  const { runWith } = makeKit(env, props);

  server.registerTool(
    "weekly_plan",
    {
      description:
        "Prioritised plan for the next N days across all active courses: overdue and upcoming work not yet turned in, estimated effort, a suggested start date and order. Use when the student asks what to do this week. Dates are UTC. " +
        UNTRUSTED_NOTE,
      inputSchema: { days: z.number().int().min(1).max(30).default(7) },
    },
    runWith<{ days: number }>(async (t, { days }) => {
      const now = Date.now();
      const courses = (await cr.listCourses(t)).slice(0, 8);
      const items: any[] = [];
      for (const c of courses) {
        const [work, subs] = await Promise.all([cr.listCourseWork(t, c.id, 100, 1), cr.listMySubmissions(t, c.id, "-", 2)]);
        const byWork = new Map(subs.map((s) => [s.courseWorkId, s]));
        for (const w of work) {
          const s = byWork.get(w.id);
          if (state(s?.state).done) continue;
          const due = cr.dueIso(w);
          const dueMs = due ? Date.parse(due) : undefined;
          if (dueMs !== undefined && dueMs > now + days * DAY) continue;
          const hours = effortHours(w);
          const startBy = dueMs !== undefined ? new Date(Math.max(now, dueMs - hours * 1.5 * 3_600_000 - DAY)).toISOString() : undefined;
          items.push({
            course: c.name,
            courseId: c.id,
            id: w.id,
            title: w.title,
            workType: w.workType,
            due,
            overdue: dueMs !== undefined && dueMs < now,
            hoursLeft: dueMs !== undefined ? Math.round((dueMs - now) / 360_000) / 10 : undefined,
            points: w.maxPoints,
            estimatedHours: hours,
            startBy,
            hasTemplateCopy: (s?.assignmentSubmission?.attachments ?? []).some((a: any) => a.driveFile),
            link: w.alternateLink,
          });
        }
      }
      items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || b.estimatedHours - a.estimatedHours);
      const undated = items.filter((i) => !i.due);
      const dated = items.filter((i) => i.due);
      return {
        windowDays: days,
        totalEstimatedHours: Math.round(items.reduce((n, i) => n + i.estimatedHours, 0) * 10) / 10,
        plan: dated,
        noDueDate: undated,
        note: "Effort is a rough estimate from points, description length and attachments. Confirm with the student before treating it as fact.",
      };
    }),
  );

  server.registerTool(
    "get_rubric",
    {
      description: `Grading rubric for an assignment (criteria, levels, points), if the teacher added one. ${UNTRUSTED_NOTE}`,
      inputSchema: { courseId: z.string(), assignmentId: z.string() },
    },
    runWith<{ courseId: string; assignmentId: string }>(async (t, a) => {
      const rubrics = await cr.getRubrics(t, a.courseId, a.assignmentId);
      if (!rubrics.length) return { rubric: null, note: "No rubric on this assignment." };
      return {
        rubric: rubrics.map((r) => ({
          id: r.id,
          criteria: (r.criteria ?? []).map((c: any) => ({
            title: wrap(`classroom:rubric:${r.id}`, c.title),
            description: wrap(`classroom:rubric:${r.id}`, c.description),
            levels: (c.levels ?? []).map((l: any) => ({ title: l.title, description: l.description, points: l.points })),
          })),
        })),
      };
    }),
  );

  server.registerTool(
    "list_topics",
    { description: "Topics (units) of a course.", inputSchema: { courseId: z.string() } },
    runWith<{ courseId: string }>(async (t, { courseId }) => ({ topics: await cr.listTopics(t, courseId) })),
  );

  server.registerTool(
    "get_stream",
    {
      description: `Unified chronological feed of a course (announcements, classwork and materials), newest first. Filter by type or by text. ${UNTRUSTED_NOTE}`,
      inputSchema: {
        courseId: z.string(),
        types: z.array(z.enum(["announcement", "classwork", "material"])).optional(),
        mentions: z.string().max(100).optional().describe("Only items containing this text"),
        limit: z.number().int().min(1).max(60).default(25),
      },
    },
    runWith<{ courseId: string; types?: string[]; mentions?: string; limit: number }>(async (t, a) => {
      const want = (k: string) => !a.types || a.types.includes(k);
      const [ann, work, mats] = await Promise.all([
        want("announcement") ? cr.listAnnouncements(t, a.courseId) : [],
        want("classwork") ? cr.listCourseWork(t, a.courseId, 100, 1) : [],
        want("material") ? cr.listMaterials(t, a.courseId) : [],
      ]);
      let feed = [
        ...ann.map((x: any) => ({ kind: "announcement", id: x.id, when: x.updateTime ?? x.creationTime, title: undefined as string | undefined, text: x.text as string | undefined, materials: x.materials, link: x.alternateLink })),
        ...work.map((x: any) => ({ kind: "classwork", id: x.id, when: x.updateTime ?? x.creationTime, title: x.title, text: x.description, materials: x.materials, link: x.alternateLink, due: cr.dueIso(x) })),
        ...mats.map((x: any) => ({ kind: "material", id: x.id, when: x.updateTime ?? x.creationTime, title: x.title, text: x.description, materials: x.materials, link: x.alternateLink })),
      ];
      if (a.mentions) {
        const n = a.mentions.toLowerCase();
        feed = feed.filter((f) => `${f.title ?? ""} ${f.text ?? ""}`.toLowerCase().includes(n));
      }
      feed.sort((x, y) => (y.when ?? "").localeCompare(x.when ?? ""));
      return {
        items: feed.slice(0, a.limit).map((f) => ({
          kind: f.kind,
          id: f.id,
          when: f.when,
          title: f.title,
          text: wrap(`classroom:${f.kind}:${f.id}`, f.text?.slice(0, 2000)),
          attachments: (f.materials ?? []).map(cr.summarizeMaterial),
          due: (f as any).due,
          link: f.link,
        })),
        total: feed.length,
      };
    }),
  );

  server.registerTool(
    "search_course_context",
    {
      description:
        "Keyword search over a course's (or all active courses') announcements, classwork and materials: titles, descriptions, announcement text, attachment titles. Returns ranked snippets with where they came from. Use to find what the teacher said about a topic. " +
        "It does not search inside attached files; read those with read_attachment. " +
        UNTRUSTED_NOTE,
      inputSchema: {
        query: z.string().min(2).max(200),
        courseId: z.string().optional(),
        limit: z.number().int().min(1).max(20).default(8),
      },
    },
    runWith<{ query: string; courseId?: string; limit: number }>(async (t, a) => {
      const terms = [...new Set(a.query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
      if (!terms.length) return { results: [], note: "Query had no searchable words." };
      const courses = a.courseId ? [{ id: a.courseId, name: undefined as string | undefined }] : (await cr.listCourses(t)).slice(0, 5);
      const hits: any[] = [];
      for (const c of courses) {
        const [ann, work, mats] = await Promise.all([cr.listAnnouncements(t, c.id, 50, 1), cr.listCourseWork(t, c.id, 100, 1), cr.listMaterials(t, c.id, 50, 1)]);
        const docs = [
          ...ann.map((x: any) => ({ kind: "announcement", id: x.id, title: "", body: x.text ?? "", att: x.materials, when: x.updateTime, link: x.alternateLink })),
          ...work.map((x: any) => ({ kind: "classwork", id: x.id, title: x.title ?? "", body: x.description ?? "", att: x.materials, when: x.updateTime, link: x.alternateLink })),
          ...mats.map((x: any) => ({ kind: "material", id: x.id, title: x.title ?? "", body: x.description ?? "", att: x.materials, when: x.updateTime, link: x.alternateLink })),
        ];
        for (const d of docs) {
          const attTitles = (d.att ?? []).map((m: any) => cr.summarizeMaterial(m).title ?? "").join(" ");
          const hayTitle = `${d.title} ${attTitles}`.toLowerCase();
          const hayBody = d.body.toLowerCase();
          let score = 0;
          for (const term of terms) {
            const inBody = hayBody.split(term).length - 1;
            const inTitle = hayTitle.split(term).length - 1;
            score += Math.min(inBody, 5) + inTitle * 3;
          }
          if (!score) continue;
          const first = terms.map((x) => hayBody.indexOf(x)).filter((i) => i >= 0).sort((p, q) => p - q)[0] ?? 0;
          const from = Math.max(0, first - 120);
          hits.push({
            score,
            course: c.name,
            courseId: c.id,
            kind: d.kind,
            id: d.id,
            title: d.title || undefined,
            updated: d.when,
            snippet: wrap(`classroom:${d.kind}:${d.id}`, d.body.slice(from, from + 360)),
            attachments: (d.att ?? []).map(cr.summarizeMaterial),
            link: d.link,
          });
        }
      }
      hits.sort((x, y) => y.score - x.score);
      return { query: a.query, results: hits.slice(0, a.limit).map(({ score, ...r }) => r), totalMatches: hits.length };
    }),
  );

  server.registerTool(
    "get_grades",
    {
      description:
        "The student's grades per assignment (assigned or draft), points possible, and an ESTIMATED overall percentage. Also shows which teacher feedback categories exist. The estimate ignores category weights unless the course provides them; say it is an estimate.",
      inputSchema: { courseId: z.string().optional() },
    },
    runWith<{ courseId?: string }>(async (t, a) => {
      const courses = a.courseId ? [{ id: a.courseId, name: undefined as string | undefined }] : (await cr.listCourses(t)).slice(0, 8);
      const out: any[] = [];
      for (const c of courses) {
        const [work, subs] = await Promise.all([cr.listCourseWork(t, c.id, 100, 1), cr.listMySubmissions(t, c.id, "-", 2)]);
        const byWork = new Map(subs.map((s) => [s.courseWorkId, s]));
        let earned = 0;
        let possible = 0;
        const cats = new Map<string, { name: string; weight?: number; earned: number; possible: number }>();
        const rows = work.map((w: any) => {
          const s = byWork.get(w.id);
          const grade = s?.assignedGrade;
          if (typeof grade === "number" && w.maxPoints) {
            earned += grade;
            possible += w.maxPoints;
            if (w.gradeCategory) {
              const g = cats.get(w.gradeCategory.id) ?? { name: w.gradeCategory.name, weight: w.gradeCategory.weight, earned: 0, possible: 0 };
              g.earned += grade;
              g.possible += w.maxPoints;
              cats.set(w.gradeCategory.id, g);
            }
          }
          return { id: w.id, title: w.title, state: s?.state, grade, draftGrade: s?.draftGrade, maxPoints: w.maxPoints, late: s?.late };
        });
        out.push({
          course: c.name,
          courseId: c.id,
          items: rows,
          gradedPoints: possible ? { earned, possible, estimatedPercent: Math.round((earned / possible) * 1000) / 10 } : null,
          categories: [...cats.values()].map((g) => ({ ...g, percent: g.possible ? Math.round((g.earned / g.possible) * 1000) / 10 : null })),
        });
      }
      return { courses: out, note: "Estimate only: it counts graded items and ignores ungraded work, dropped scores and, unless shown, category weights." };
    }),
  );

  server.registerTool(
    "check_requirements",
    {
      description:
        "Compare a draft with the assignment's requirements before it is handed in. Extracts a checklist (page/word limits, file format, citation style, naming, deadline changes, 'must include' lines) from the description and from announcements that mention the assignment, measures the draft (word count, estimated pages, headings, citations, leftover placeholders) and lists rubric criteria. " +
        "Provide EITHER fileId (the student's Google Doc) OR spec (a DocSpec). Each requirement gets a status of pass, fail or check; you must still judge 'check' items and the rubric, and tell the student about conflicts between sources. " +
        UNTRUSTED_NOTE,
      inputSchema: {
        courseId: z.string(),
        assignmentId: z.string(),
        fileId: z.string().optional(),
        spec: DocSpec.optional(),
      },
    },
    runWith<{ courseId: string; assignmentId: string; fileId?: string; spec?: DocSpecT }>(async (t, a) => {
      if (!a.fileId && !a.spec) return { error: "Provide fileId or spec." };
      const [w, ann, rubrics] = await Promise.all([
        cr.getCourseWork(t, a.courseId, a.assignmentId),
        cr.listAnnouncements(t, a.courseId, 50, 1).catch(() => [] as any[]),
        cr.getRubrics(t, a.courseId, a.assignmentId).catch(() => [] as any[]),
      ]);
      const title = (w.title ?? "").toLowerCase();
      const reqs: Requirement[] = [
        ...extractRequirements(w.description ?? "", "assignment description"),
        ...ann
          .filter((x: any) => title && (x.text ?? "").toLowerCase().includes(title))
          .flatMap((x: any) => extractRequirements(x.text ?? "", `announcement ${x.updateTime ?? ""}`.trim())),
      ];

      let stats: ReturnType<typeof draftStats> & { tables?: number; images?: number };
      let format = "unknown";
      let pages: number;
      let lint: unknown = undefined;
      if (a.spec) {
        const text = allText(a.spec).join("\n");
        const heads = a.spec.blocks.filter((b) => b.type === "heading").map((b: any) => b.text);
        stats = draftStats(text, heads);
        pages = estimatePages(a.spec);
        stats.hasReferencesSection = stats.hasReferencesSection || a.spec.bibliography.length > 0;
        stats.hasInTextCitations = stats.hasInTextCitations || /\[@/.test(text);
        format = a.spec.meta.format === "latex" ? "pdf (via LaTeX)" : "google doc";
        lint = toLatex(a.spec).lint;
      } else {
        const d = await docPlain(t, a.fileId!);
        stats = { ...draftStats(d.text, d.headings), tables: d.tables, images: d.images };
        pages = stats.estimatedPages;
        format = "google doc";
      }

      const checks = reqs.map((r) => {
        let status: "pass" | "fail" | "check" = "check";
        let evidence = "";
        if (r.kind === "pages") {
          evidence = `estimated ${pages} page(s) (rough: words/450 plus figures)`;
          if (r.max !== undefined && pages > r.max) status = "fail";
          else if (r.min !== undefined && pages < r.min) status = "fail";
          else status = "pass";
        } else if (r.kind === "words") {
          evidence = `${stats.words} words`;
          status = (r.max !== undefined && stats.words > r.max) || (r.min !== undefined && stats.words < r.min) ? "fail" : "pass";
        } else if (r.kind === "citation") {
          evidence = a.spec ? `citation style set to ${a.spec.meta.citationStyle}` : "style cannot be detected in a Doc";
          if (a.spec) status = a.spec.meta.citationStyle === r.value ? "pass" : "fail";
        } else if (r.kind === "format") {
          evidence = `draft is ${format}`;
          evidence += `; teacher asked for ${r.value}. A Google Doc can be downloaded as PDF/Word from Docs (File > Download).`;
        } else if (r.kind === "deadline") evidence = "deadline note: compare with the due date in the bundle";
        return { kind: r.kind, requirement: wrap(`classroom:${r.source}`, r.text), source: r.source, status, evidence };
      });

      const issues: string[] = [];
      if (stats.hasPlaceholders) issues.push("Leftover placeholders or blanks (e.g. [Your Name], ____) were found.");
      if (!stats.hasReferencesSection && !reqs.some((r) => r.kind === "citation")) issues.push("No references section found; fine unless sources were required.");
      if (stats.hasReferencesSection && !stats.hasInTextCitations) issues.push("References exist but no in-text citations were detected.");
      if (!stats.words) issues.push("The draft appears empty.");

      return {
        assignment: { id: w.id, title: w.title, due: cr.dueIso(w), points: w.maxPoints },
        draft: { source: a.spec ? "spec" : "google doc", format, ...stats, estimatedPages: pages, lint },
        requirements: checks,
        rubric: rubrics.flatMap((r: any) => (r.criteria ?? []).map((c: any) => ({ criterion: wrap(`classroom:rubric:${r.id}`, c.title), levels: (c.levels ?? []).map((l: any) => ({ title: l.title, points: l.points })) }))),
        issues,
        next: "Judge each 'check' item and each rubric criterion yourself, quoting evidence from the draft. If sources conflict (e.g. an announcement overrides the description), ask the student which applies.",
      };
    }),
  );

  server.registerTool(
    "prepare_submission",
    {
      description:
        "Final hand-off checklist for one assignment: which route applies (edit own copy / attach a new file / answer a question), time left, lateness, file-name suggestion and the exact steps in Classroom. Call this when the student says they are ready to submit. " +
        "This app cannot attach files or press Turn In on teacher-created work, so the student does the last clicks. " +
        UNTRUSTED_NOTE,
      inputSchema: {
        courseId: z.string(),
        assignmentId: z.string(),
        fileTitle: z.string().max(200).optional().describe("Title of the file the student will attach, if they created a new one (e.g. from render_document)"),
      },
    },
    runWith<{ courseId: string; assignmentId: string; fileTitle?: string }>(async (t, a) => {
      const [w, subs, courses] = await Promise.all([cr.getCourseWork(t, a.courseId, a.assignmentId), cr.listMySubmissions(t, a.courseId, a.assignmentId), cr.listCourses(t, true)]);
      const s = subs[0];
      const link = w.alternateLink as string | undefined;
      const dueIso = cr.dueIso(w);
      const dueMs = dueIso ? Date.parse(dueIso) : undefined;
      const hoursLeft = dueMs ? Math.round((dueMs - Date.now()) / 360_000) / 10 : undefined;
      const course = courses.find((c: any) => c.id === a.courseId);
      const ownCopy = (s?.assignmentSubmission?.attachments ?? []).map(cr.summarizeMaterial).filter((f: any) => f.kind === "driveFile");
      const type: string = w.workType ?? "ASSIGNMENT";
      const done = state(s?.state).done;

      let route: "already_submitted" | "edit_own_copy" | "attach_new_file" | "answer_question";
      const steps: string[] = [];
      if (done) {
        route = "already_submitted";
        steps.push("Classroom shows this as turned in. If the student needs to change it, they must Unsubmit first in Classroom.");
      } else if (type === "SHORT_ANSWER_QUESTION" || type === "MULTIPLE_CHOICE_QUESTION") {
        route = "answer_question";
        steps.push(`Open ${link ?? "the question in Classroom"}.`, "Paste or select the answer in the answer box.", "Click Turn in.");
      } else if (ownCopy.length) {
        route = "edit_own_copy";
        steps.push(
          `Open the student's copy: ${ownCopy[0].url ?? `https://docs.google.com/document/d/${ownCopy[0].id}/edit`}`,
          "Read it through once and fix anything that is not right (the app only writes what was approved).",
          `Open the assignment: ${link ?? "in Classroom"}. The file is already attached.`,
          "Click Turn in, then Turn in again to confirm.",
        );
      } else {
        route = "attach_new_file";
        steps.push(
          `Open the assignment: ${link ?? "in Classroom"}.`,
          `Under Your work click Add or create > Google Drive${a.fileTitle ? ` and search for "${a.fileTitle}"` : ""}. Files saved by ClassroomPilot are in Drive under ClassroomPilot/.`,
          "Upload a PDF instead via Add or create > File if the teacher asked for PDF (download it from Overleaf or File > Download > PDF in Docs).",
          "Click Turn in, then Turn in again to confirm.",
        );
      }

      const warnings: string[] = [];
      if (!done && hoursLeft !== undefined) {
        if (hoursLeft < 0) warnings.push(`Past the due date by ${Math.abs(hoursLeft)} hours: it will be marked late (the teacher decides what that means).`);
        else if (hoursLeft < 6) warnings.push(`Only ${hoursLeft} hours left.`);
      }
      if (s?.late) warnings.push("Classroom already flags this submission as late.");

      const fileName = [course?.section, a.fileTitle ?? w.title].filter(Boolean).join(" - ").replace(/[\\/:*?"<>|]/g, "_");
      return {
        assignment: { id: w.id, title: w.title, workType: type, due: dueIso, hoursLeft, link },
        state: s?.state,
        route,
        steps,
        warnings,
        suggestedFileName: fileName,
        before: ["Run check_requirements on the final draft.", "Make sure no placeholders like [Your Name] remain.", "Confirm the right assignment is open (title above)."],
        after: "When the student says they pressed Turn in, call verify_turned_in to confirm.",
      };
    }),
  );
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env, Props } from "./env.js";
import { GoogleError, gget } from "./google.js";
import { makeKit, UNTRUSTED_NOTE, ok, wrap } from "./toolkit.js";
import * as cr from "./classroom.js";
import { readGoogleFile } from "./files.js";
import { applyEdits } from "./docapply.js";
import { EditBlock } from "./docedit.js";
import {
  CourseSettingsSchema, deleteAll, getCourseSettings, getProfile, ProfileSchema, scanPlaceholders, updateCourseSettings, updateProfile,
} from "./profile.js";
import { checkConfirm, issueConfirm, sha256 } from "./security.js";

export function registerTools(server: McpServer, env: Env, props: Props) {
  const { runWith } = makeKit(env, props);

  server.registerTool(
    "whoami",
    {
      description: "Show who is connected. Call first when the user asks whether ClassroomPilot is working.",
      inputSchema: {},
    },
    async () => ok({ connected: true, email: props.email }),
  );

  server.registerTool(
    "list_courses",
    {
      description: `List the student's Google Classroom courses (active by default). ${UNTRUSTED_NOTE}`,
      inputSchema: { includeArchived: z.boolean().optional() },
    },
    runWith<{ includeArchived?: boolean }>(async (t, a) => ({
      courses: await cr.listCourses(t, a.includeArchived),
    })),
  );

  server.registerTool(
    "get_course_overview",
    {
      description: `Course map: topics plus recent announcements, classwork and materials, with attachments summarized. ${UNTRUSTED_NOTE}`,
      inputSchema: { courseId: z.string() },
    },
    runWith<{ courseId: string }>(async (t, { courseId }) => {
      const [topics, work, materials, announcements] = await Promise.all([
        cr.listTopics(t, courseId),
        cr.listCourseWork(t, courseId, 20),
        cr.listMaterials(t, courseId, 20),
        cr.listAnnouncements(t, courseId, 10),
      ]);
      return {
        topics,
        classwork: work.map((w) => ({
          id: w.id,
          title: w.title,
          workType: w.workType,
          topicId: w.topicId,
          due: cr.dueIso(w),
          maxPoints: w.maxPoints,
          attachments: (w.materials ?? []).map(cr.summarizeMaterial),
        })),
        materials: materials.map((m) => ({
          id: m.id,
          title: m.title,
          topicId: m.topicId,
          attachments: (m.materials ?? []).map(cr.summarizeMaterial),
        })),
        announcements: announcements.map((a) => ({
          id: a.id,
          updated: a.updateTime,
          text: wrap(`classroom:announcement:${a.id}`, a.text),
          attachments: (a.materials ?? []).map(cr.summarizeMaterial),
        })),
      };
    }),
  );

  server.registerTool(
    "list_assignments",
    {
      description: `List classwork with the student's submission state, sorted by due date. Use status to filter. ${UNTRUSTED_NOTE}`,
      inputSchema: {
        courseId: z.string().optional().describe("Omit to scan all active courses"),
        status: z.enum(["pending", "turned_in", "returned", "late", "all"]).optional(),
      },
    },
    runWith<{ courseId?: string; status?: string }>(async (t, a) => {
      const courses = a.courseId ? [{ id: a.courseId, name: undefined }] : (await cr.listCourses(t)).slice(0, 8);
      const rows: any[] = [];
      for (const c of courses) {
        const [work, subs] = await Promise.all([cr.listCourseWork(t, c.id), cr.listMySubmissions(t, c.id)]);
        const byWork = new Map(subs.map((s) => [s.courseWorkId, s]));
        for (const w of work) {
          const s = byWork.get(w.id);
          rows.push({
            courseId: c.id,
            courseName: c.name,
            id: w.id,
            title: w.title,
            workType: w.workType,
            due: cr.dueIso(w),
            maxPoints: w.maxPoints,
            submissionState: s?.state,
            late: s?.late ?? false,
            grade: s?.assignedGrade,
            link: w.alternateLink,
          });
        }
      }
      const want = a.status ?? "pending";
      const filtered = rows.filter((r) => {
        if (want === "all") return true;
        if (want === "pending") return r.submissionState === "NEW" || r.submissionState === "CREATED" || r.submissionState === "RECLAIMED_BY_STUDENT";
        if (want === "turned_in") return r.submissionState === "TURNED_IN";
        if (want === "returned") return r.submissionState === "RETURNED";
        if (want === "late") return r.late;
        return true;
      });
      filtered.sort((x, y) => (x.due ?? "9999").localeCompare(y.due ?? "9999"));
      return { assignments: filtered };
    }),
  );

  server.registerTool(
    "get_assignment_bundle",
    {
      description: `Everything Classroom holds about one assignment: description, attachments, rubric, the student's submission (including their own copy of a template), and posts mentioning it. Call this before drafting anything. ${UNTRUSTED_NOTE}`,
      inputSchema: { courseId: z.string(), assignmentId: z.string() },
    },
    runWith<{ courseId: string; assignmentId: string }>(async (t, { courseId, assignmentId }) => {
      const errors: string[] = [];
      const part = async <T,>(name: string, p: Promise<T>, fallback: T): Promise<T> => {
        try {
          return await p;
        } catch (e) {
          errors.push(`${name}: ${e instanceof GoogleError ? e.describe() : String(e)}`);
          return fallback;
        }
      };
      const w = await cr.getCourseWork(t, courseId, assignmentId);
      const [subs, rubrics, announcements, topics] = await Promise.all([
        part("submission", cr.listMySubmissions(t, courseId, assignmentId), [] as any[]),
        part("rubric", cr.getRubrics(t, courseId, assignmentId), [] as any[]),
        part("announcements", cr.listAnnouncements(t, courseId, 30), [] as any[]),
        part("topics", cr.listTopics(t, courseId), [] as any[]),
      ]);
      const sub = subs[0];
      const studentFiles = (sub?.assignmentSubmission?.attachments ?? []).map(cr.summarizeMaterial);
      const title: string = (w.title ?? "").toLowerCase();
      const firstCopy = studentFiles.find((f: any) => f.kind === "driveFile" && f.id);
      let studentCopyContent: unknown = undefined;
      if (firstCopy) {
        const r = await readGoogleFile(t, firstCopy.id);
        studentCopyContent = r.ok
          ? { type: r.type, title: r.title, truncated: r.truncated, text: wrap(`drive:${firstCopy.id}`, r.text.slice(0, 8000)) }
          : { unreadable: r.reason };
      }
      const mentions = announcements.filter((a) => title && (a.text ?? "").toLowerCase().includes(title));
      const attachments = (w.materials ?? []).map(cr.summarizeMaterial);
      const templateStatus = studentFiles.some((f: any) => f.kind === "driveFile")
        ? "student_copy_exists"
        : attachments.some((f: any) => f.kind === "driveFile")
          ? "teacher_attachment_check_manually"
          : "none";
      return {
        assignment: {
          id: w.id,
          title: w.title,
          workType: w.workType,
          state: w.state,
          due: cr.dueIso(w),
          maxPoints: w.maxPoints,
          topic: topics.find((x) => x.topicId === w.topicId)?.name,
          description: wrap(`classroom:assignment:${w.id}`, w.description),
          link: w.alternateLink,
        },
        attachments,
        rubric: rubrics,
        submission: sub && {
          id: sub.id,
          state: sub.state,
          late: sub.late,
          grade: sub.assignedGrade,
          studentFiles,
          shortAnswer: sub.shortAnswerSubmission,
          link: sub.alternateLink,
        },
        templateStatus,
        studentCopyContent,
        announcementsMentioningThis: mentions.map((a) => ({
          id: a.id,
          updated: a.updateTime,
          text: wrap(`classroom:announcement:${a.id}`, a.text),
        })),
        partialErrors: errors,
        caveats: [
          "studentCopyContent is the student's own copy of the template (what to fill in). The teacher's master file is usually not shared with students, so a 403 on it is expected: use the student copy instead.",
          "Use read_attachment with an attachment id to read other Google Docs/Slides/Sheets.",
          "Classroom does not let this app attach files or turn in on teacher-created work; the student presses Turn In.",
        ],
      };
    }),
  );

  server.registerTool(
    "list_announcements",
    {
      description: `Recent stream announcements for a course (deadline changes and clarifications live here). ${UNTRUSTED_NOTE}`,
      inputSchema: { courseId: z.string() },
    },
    runWith<{ courseId: string }>(async (t, { courseId }) => ({
      announcements: (await cr.listAnnouncements(t, courseId, 30)).map((a) => ({
        id: a.id,
        updated: a.updateTime,
        text: wrap(`classroom:announcement:${a.id}`, a.text),
        attachments: (a.materials ?? []).map(cr.summarizeMaterial),
        link: a.alternateLink,
      })),
    })),
  );

  server.registerTool(
    "list_materials",
    {
      description: `Class materials (notes, slides, readings) for a course. ${UNTRUSTED_NOTE}`,
      inputSchema: { courseId: z.string() },
    },
    runWith<{ courseId: string }>(async (t, { courseId }) => ({
      materials: (await cr.listMaterials(t, courseId, 50)).map((m) => ({
        id: m.id,
        title: m.title,
        description: wrap(`classroom:material:${m.id}`, m.description),
        topicId: m.topicId,
        attachments: (m.materials ?? []).map(cr.summarizeMaterial),
        link: m.alternateLink,
      })),
    })),
  );

  server.registerTool(
    "get_submission_status",
    {
      description: "State, lateness, grade and history of the student's submission for one assignment.",
      inputSchema: { courseId: z.string(), assignmentId: z.string() },
    },
    runWith<{ courseId: string; assignmentId: string }>(async (t, { courseId, assignmentId }) => {
      const s = (await cr.listMySubmissions(t, courseId, assignmentId))[0];
      return s ?? { error: "No submission found" };
    }),
  );

  server.registerTool(
    "read_attachment",
    {
      description: `Read the text of a Google Doc, Slides deck or Sheet attached to Classroom work (use the file id from an attachment's "id"). Works for the teacher's attachments and the student's own copy. Returns a clear reason when a file cannot be read (PDF, Word, no access). ${UNTRUSTED_NOTE}`,
      inputSchema: { fileId: z.string() },
    },
    runWith<{ fileId: string }>(async (t, { fileId }) => {
      const r = await readGoogleFile(t, fileId);
      return r.ok ? { ...r, text: wrap(`drive:${fileId}`, r.text) } : r;
    }),
  );

  server.registerTool(
    "edit_student_doc",
    {
      description:
        "Fill in the student's OWN copy of an assignment Google Doc (the file listed in the bundle's submission.studentFiles). " +
        "Two steps: call once WITHOUT confirmToken to get a preview and a confirmToken; show the preview to the student and, only after they approve, call again with the SAME arguments plus confirmToken. " +
        "replacements swaps placeholder text (e.g. [Your Name]) everywhere; appendBlocks adds headings, paragraphs (supports **bold**, *italic*, `code`), lists, code, tables and page breaks at the end. " +
        "Never edits files that are not the student's own submission attachment. The student must still press Turn In themselves.",
      inputSchema: {
        courseId: z.string(),
        assignmentId: z.string(),
        fileId: z.string(),
        replacements: z.array(z.object({ find: z.string().min(1).max(200), replace: z.string().max(2000) })).max(50).optional(),
        appendBlocks: z.array(EditBlock).max(200).optional(),
        confirmToken: z.string().optional(),
      },
    },
    runWith<any>(async (t, a) => {
      const subs = await cr.listMySubmissions(t, a.courseId, a.assignmentId);
      const own = subs.flatMap((s: any) => s.assignmentSubmission?.attachments ?? []).map(cr.summarizeMaterial);
      if (!own.some((f: any) => f.kind === "driveFile" && f.id === a.fileId))
        return { error: "fileId is not the student's own submission attachment for this assignment. Refusing to edit." };
      if (!a.replacements?.length && !a.appendBlocks?.length) return { error: "Nothing to do: give replacements and/or appendBlocks." };

      const { confirmToken, ...core } = a;
      const argsHash = await sha256(JSON.stringify(core));
      const secret = env.GOOGLE_CLIENT_SECRET;
      const docUrl = `https://docs.googleapis.com/v1/documents/${a.fileId}`;
      const doc = await gget<any>(t, docUrl);

      if (!confirmToken) {
        const token = await issueConfirm(secret, props.userId, "edit_student_doc", argsHash);
        const plain = (doc.body.content as any[])
          .flatMap((el) => (el.paragraph?.elements ?? []).map((e: any) => e.textRun?.content ?? ""))
          .join("");
        const counts = (needle: string) => plain.split(needle).length - 1;
        return {
          preview: true,
          document: doc.title,
          replacements: (a.replacements ?? []).map((r: any) => ({ ...r, occurrencesFound: counts(r.find) })),
          appendBlocks: (a.appendBlocks ?? []).map((b: any) => (b.type === "heading" ? `heading: ${b.text}` : b.type)),
          confirmToken: token,
          expiresInSeconds: 600,
          next: "Show this to the student. If they approve, call edit_student_doc again with identical arguments plus this confirmToken.",
        };
      }
      if (!(await checkConfirm(secret, confirmToken, props.userId, "edit_student_doc", argsHash)))
        return { error: "confirmToken is invalid, expired, or arguments changed since the preview. Call again without confirmToken to get a new preview." };

      const { replaced, tablesFilled } = await applyEdits(t, a.fileId, { replacements: a.replacements, blocks: a.appendBlocks }, doc);
      return {
        applied: true,
        document: doc.title,
        link: `https://docs.google.com/document/d/${a.fileId}/edit`,
        replacementsMade: replaced,
        blocksAppended: a.appendBlocks?.length ?? 0,
        tablesFilled,
        note: "Review the Doc (File > Version history can undo). The student must press Turn In in Classroom.",
      };
    }),
  );

  server.registerTool(
    "get_profile",
    {
      description:
        "Get the student's saved details (name, roll no, UID, branch, batch, etc.) used to fill cover pages and headers. If fields needed for the task are missing, ask the student once, then save them with update_profile. Pass courseId to also get that course's saved settings (subject code, teacher, template notes).",
      inputSchema: { courseId: z.string().optional() },
    },
    runWith<{ courseId?: string }>(async (_t, a) => ({
      profile: await getProfile(env, props.userId),
      courseSettings: a.courseId ? await getCourseSettings(env, props.userId, a.courseId) : undefined,
      googleEmail: props.email,
    })),
  );

  server.registerTool(
    "update_profile",
    {
      description:
        "Save or change the student's details and/or per-course settings. Only send fields the student actually told you. Send an empty string to clear a field. courseSettings are reusable per course (e.g. structureNotes describing the lab-report layout the teacher wants).",
      inputSchema: {
        profile: ProfileSchema.optional(),
        courseId: z.string().optional(),
        courseSettings: CourseSettingsSchema.optional(),
      },
    },
    runWith<any>(async (_t, a) => {
      if (a.courseSettings && !a.courseId) return { error: "courseId is required with courseSettings" };
      return {
        profile: a.profile ? await updateProfile(env, props.userId, a.profile) : undefined,
        courseSettings: a.courseSettings ? await updateCourseSettings(env, props.userId, a.courseId, a.courseSettings) : undefined,
      };
    }),
  );

  server.registerTool(
    "delete_my_data",
    {
      description: "Delete the student's saved profile and per-course settings. Only call when the student explicitly asks.",
      inputSchema: {},
    },
    runWith<any>(async () => ({ deletedRecords: await deleteAll(env, props.userId) })),
  );

  server.registerTool(
    "map_profile_to_template",
    {
      description:
        "Scan the student's own template copy (a Google Doc) for fill-in spots like [Your Name], {{rollNo}} or 'Roll No: ____' and match them to the saved profile. Returns ready-made `replacements` for edit_student_doc, plus `missing` fields to ask the student about. Call before filling a cover page.",
      inputSchema: { fileId: z.string() },
    },
    runWith<{ fileId: string }>(async (t, { fileId }) => {
      const doc = await gget<any>(t, `https://docs.googleapis.com/v1/documents/${fileId}`);
      const paras: string[] = [];
      const walk = (content: any[] = []) => {
        for (const el of content) {
          if (el.paragraph) paras.push((el.paragraph.elements ?? []).map((e: any) => e.textRun?.content ?? "").join("").replace(/\n$/, ""));
          for (const row of el.table?.tableRows ?? []) for (const c of row.tableCells ?? []) walk(c.content);
        }
      };
      walk(doc.body?.content);
      const profile = (await getProfile(env, props.userId)) as Record<string, string | undefined>;
      const found = scanPlaceholders(paras);
      const replacements: { find: string; replace: string }[] = [];
      const missing: string[] = [];
      const unknown: string[] = [];
      for (const p of found) {
        if (!p.field) unknown.push(p.find);
        else if (profile[p.field]) {
          const label = p.find.startsWith("[") || p.find.startsWith("{{") ? undefined : p.find.replace(/[_.]+\s*$/, "").replace(/\s+$/, "");
          replacements.push({ find: p.find, replace: label ? `${label} ${profile[p.field]}` : profile[p.field]! });
        } else missing.push(p.field);
      }
      return {
        document: doc.title,
        placeholdersFound: found,
        replacements,
        missing: [...new Set(missing)],
        unmatched: unknown,
        next: "Ask the student for any missing fields, save with update_profile, then pass replacements to edit_student_doc (preview first).",
      };
    }),
  );

  server.registerTool(
    "verify_turned_in",
    {
      description: "After the student says they pressed Turn In, check Classroom to confirm the submission is actually TURNED_IN (and whether it is late or graded).",
      inputSchema: { courseId: z.string(), assignmentId: z.string() },
    },
    runWith<{ courseId: string; assignmentId: string }>(async (t, { courseId, assignmentId }) => {
      const s = (await cr.listMySubmissions(t, courseId, assignmentId))[0];
      if (!s) return { error: "No submission found" };
      const turnedIn = s.state === "TURNED_IN" || s.state === "RETURNED";
      return {
        turnedIn,
        state: s.state,
        late: s.late ?? false,
        grade: s.assignedGrade,
        message: turnedIn
          ? "Confirmed: Classroom shows this as turned in."
          : "Not turned in yet. The student must open the assignment in Classroom and click Turn in (this app cannot do it for teacher-created work).",
        link: s.alternateLink,
      };
    }),
  );
}

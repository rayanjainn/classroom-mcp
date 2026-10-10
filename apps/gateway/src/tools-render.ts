import { DocSpec, type DocSpecT } from "@classroompilot/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyEdits, styleNewDoc } from "./docapply.js";
import { docsFont, specToEditBlocks } from "./docrender.js";
import { ensureFolderPath, moveToFolder, safeName, uploadText } from "./drive.js";
import type { Env, Props } from "./env.js";
import { gget, gpost } from "./google.js";
import { toLatex } from "./latex.js";
import { getCourseSettings, getProfile, guessField, scanPlaceholders } from "./profile.js";
import { makeKit, UNTRUSTED_NOTE } from "./toolkit.js";

const MAX_INLINE_TEX = 40_000;

/** Fill missing cover fields from the saved profile and course settings (never overwrites what the AI set). */
export function applyProfile(spec: DocSpecT, profile: Record<string, string | undefined>, course: Record<string, string | undefined>): DocSpecT {
  if (!spec.meta.useProfile) return spec;
  const copy: DocSpecT = JSON.parse(JSON.stringify(spec));
  const cover = copy.blocks.find((b) => b.type === "cover");
  if (cover && cover.type === "cover") {
    const merged: Record<string, string | undefined> = {
      institution: profile.institution,
      department: profile.department,
      fullName: profile.fullName,
      rollNo: profile.rollNo,
      uid: profile.uid,
      enrollmentNo: profile.enrollmentNo,
      programme: profile.programme,
      branch: profile.branch,
      className: profile.className,
      section: profile.section,
      batch: profile.batch,
      semester: profile.semester,
      subject: course.subjectName,
      subjectCode: course.subjectCode,
      teacherName: course.teacherName,
    };
    for (const [k, v] of Object.entries(merged)) if (v && !cover.fields[k]) cover.fields[k] = v;
  }
  return copy;
}

const RenderInput = {
  spec: DocSpec,
  courseId: z.string().optional().describe("Used to load saved course settings (subject code, teacher) for the cover page"),
  courseName: z.string().max(100).optional().describe("Names the Drive folder ClassroomPilot/<courseName>/<assignmentTitle>"),
  assignmentTitle: z.string().max(100).optional(),
  saveToDrive: z.boolean().default(true).describe("Save the result in the student's Drive (new files only)"),
};

export function registerRenderTools(server: McpServer, env: Env, props: Props) {
  const { runWith } = makeKit(env, props);

  server.registerTool(
    "render_document",
    {
      description:
        "Build a finished document from a structured DocSpec (headings, paragraphs with **bold**/*italic*/`code`/$math$/[@cite], tables, equations, code, lists, charts, flow diagrams, cover page, references). " +
        "format 'latex': returns publication-quality LaTeX (.tex saved to the student's Drive, plus a one-click Overleaf link that compiles it to PDF) with a lint report and estimated page count. " +
        "format 'google-doc': creates a NEW editable Google Doc in the student's Drive (with PDF/Word export links). Charts and diagrams appear as tables/lists there. " +
        "Never edits existing files (use edit_student_doc for the student's own submission copy). Check the lint report and estimatedPages against the assignment requirements before handing over. " +
        `Cover fields not given are filled from the saved profile. ${UNTRUSTED_NOTE}`,
      inputSchema: RenderInput,
    },
    runWith<{ spec: DocSpecT; courseId?: string; courseName?: string; assignmentTitle?: string; saveToDrive: boolean }>(async (t, a) => {
      const profile = (await getProfile(env, props.userId)) as Record<string, string | undefined>;
      const course = a.courseId ? ((await getCourseSettings(env, props.userId, a.courseId)) as Record<string, string | undefined>) : {};
      const spec = applyProfile(a.spec, profile, course);
      const base = safeName(a.assignmentTitle ?? spec.meta.title, "Document");
      const folderParts = [a.courseName, a.assignmentTitle].filter(Boolean) as string[];

      let folderId: string | undefined;
      const folder = async () => (a.saveToDrive ? (folderId ??= await ensureFolderPath(t, folderParts)) : undefined);

      if (spec.meta.format === "latex") {
        const r = toLatex(spec);
        const id = crypto.randomUUID().replace(/-/g, "");
        await env.OAUTH_KV.put(`cp:tex:${id}`, JSON.stringify({ tex: r.tex, engine: r.engine, name: base }), { expirationTtl: 3600 });
        let drive: { id: string; webViewLink?: string } | undefined;
        if (a.saveToDrive) drive = await uploadText(t, `${base}.tex`, "text/plain", r.tex, await folder());
        return {
          format: "latex",
          engine: r.engine,
          estimatedPages: r.estimatedPages,
          lint: r.lint,
          overleafLink: `${env.PUBLIC_BASE_URL}/open/${id}`,
          overleafLinkExpires: "1 hour",
          driveFile: drive && { id: drive.id, link: drive.webViewLink ?? `https://drive.google.com/file/d/${drive.id}/view` },
          tex: r.tex.length <= MAX_INLINE_TEX ? r.tex : undefined,
          texTruncated: r.tex.length > MAX_INLINE_TEX ? "Too long to inline; use the Overleaf link or the Drive file." : undefined,
          next: [
            "Tell the student to open the Overleaf link (free account), which creates a project and compiles the PDF; then Download > PDF.",
            "Check lint and estimatedPages against the assignment's requirements (use check_requirements).",
            "A PDF cannot be attached to the assignment by this app: the student attaches it in Classroom, then presses Turn In.",
          ],
        };
      }

      // Google Doc
      const r = specToEditBlocks(spec);
      const created = await gpost<{ documentId: string; title: string }>(t, "https://docs.googleapis.com/v1/documents", { title: base });
      const docId = created.documentId;
      await styleNewDoc(t, docId, { paper: spec.meta.paper, marginCm: spec.meta.marginCm, header: spec.meta.header });
      await applyEdits(t, docId, {
        blocks: r.blocks,
        style: { font: docsFont(spec.meta.font), sizePt: spec.meta.fontSize, lineSpacingPct: Math.round(spec.meta.lineSpacing * 100) },
      });
      if (a.saveToDrive) await moveToFolder(t, docId, (await folder())!);
      const link = `https://docs.google.com/document/d/${docId}/edit`;
      return {
        format: "google-doc",
        document: { id: docId, link },
        exportLinks: {
          pdf: `https://docs.google.com/document/d/${docId}/export?format=pdf`,
          word: `https://docs.google.com/document/d/${docId}/export?format=docx`,
        },
        estimatedPages: r.estimatedPages,
        lint: r.lint,
        notes: r.notes,
        next: [
          "Open the Doc and review it. In Classroom, attach it via Add or create > Google Drive (the app cannot attach files), then press Turn In.",
        ],
      };
    }),
  );

  server.registerTool(
    "analyze_template",
    {
      description:
        "Analyse the structure of the student's own template copy (a Google Doc): page setup, fonts, headings/sections, tables, headers/footers and fill-in placeholders. Use before drafting so the content follows the teacher's layout. Returns a TemplateSpec summary and ambiguities to confirm with the student.",
      inputSchema: { fileId: z.string() },
    },
    runWith<{ fileId: string }>(async (t, { fileId }) => {
      const doc = await gget<any>(t, `https://docs.googleapis.com/v1/documents/${fileId}`);
      const ds = doc.documentStyle ?? {};
      const mm = (d?: { magnitude?: number }) => (d?.magnitude ? Math.round((d.magnitude / 28.3465) * 10) / 10 : undefined);
      const sections: { heading: string; level: string }[] = [];
      const fonts = new Map<string, number>();
      const paras: string[] = [];
      let tables = 0;
      const walk = (content: any[] = []) => {
        for (const el of content) {
          if (el.paragraph) {
            const text = (el.paragraph.elements ?? []).map((e: any) => e.textRun?.content ?? "").join("").replace(/\n$/, "");
            paras.push(text);
            const st: string = el.paragraph.paragraphStyle?.namedStyleType ?? "";
            if (/^(HEADING_\d|TITLE|SUBTITLE)/.test(st) && text.trim()) sections.push({ heading: text.trim(), level: st });
            for (const e of el.paragraph.elements ?? []) {
              const f = e.textRun?.textStyle?.weightedFontFamily?.fontFamily;
              if (f) fonts.set(f, (fonts.get(f) ?? 0) + (e.textRun.content?.length ?? 0));
            }
          }
          if (el.table) {
            tables++;
            for (const row of el.table.tableRows ?? []) for (const c of row.tableCells ?? []) walk(c.content);
          }
        }
      };
      walk(doc.body?.content);
      const placeholders = scanPlaceholders(paras).map((p) => ({ ...p, field: p.field ?? guessField(p.label) }));
      const hasText = (segs: Record<string, any> | undefined) =>
        Object.values(segs ?? {}).some((s: any) => (s.content ?? []).some((c: any) => (c.paragraph?.elements ?? []).some((e: any) => (e.textRun?.content ?? "").trim())));
      const ambiguities: string[] = [];
      if (!sections.length) ambiguities.push("No heading styles found: sections may be plain bold lines. Ask the student which sections the teacher expects.");
      if (!placeholders.length) ambiguities.push("No fill-in placeholders detected: the template may be blank or use unusual markers.");
      if ((doc.inlineObjects && Object.keys(doc.inlineObjects).length) || false) ambiguities.push("The template contains images (for example a logo); they are kept when editing in place.");
      return {
        title: doc.title,
        kind: "docs_copy",
        page: {
          widthCm: mm(ds.pageSize?.width),
          heightCm: mm(ds.pageSize?.height),
          marginsCm: { top: mm(ds.marginTop), bottom: mm(ds.marginBottom), left: mm(ds.marginLeft), right: mm(ds.marginRight) },
        },
        fonts: [...fonts.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f).slice(0, 3),
        sections,
        tables,
        placeholders,
        headerFooter: { header: hasText(doc.headers), footer: hasText(doc.footers) },
        characters: paras.join("").length,
        ambiguities,
        next: "Summarise this to the student ('I understood your template as follows...') and get a go/no-go. Fill placeholders with map_profile_to_template, add content with edit_student_doc.",
      };
    }),
  );
}

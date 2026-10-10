/** In-memory stand-in for the Google APIs the gateway calls. Records requests and validates Docs index ranges. */
export class FakeKV {
  m = new Map<string, string>();
  async get(k: string) { return this.m.get(k) ?? null; }
  async put(k: string, v: string) { this.m.set(k, v); }
  async delete(k: string) { this.m.delete(k); }
  async list({ prefix }: { prefix: string }) { return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; }
}

class DocSim {
  text = "\n"; // body text from index 1; always ends with the final newline
  styles: string[] = ["NORMAL_TEXT"];
  tables = 0;
  pageBreaks = 0;
  headerText = "";
  constructor(public title: string) {}
  get end() { return this.text.length + 1; }
  paraOf(offset: number) { return this.text.slice(0, offset).split("\n").length - 1; }
  json(id: string) {
    const content: any[] = [{ endIndex: 1, sectionBreak: {} }];
    let idx = 1;
    this.text.split(/(?<=\n)/).forEach((p, i) => {
      content.push({ startIndex: idx, endIndex: idx + p.length, paragraph: { elements: [{ startIndex: idx, endIndex: idx + p.length, textRun: { content: p } }], paragraphStyle: { namedStyleType: this.styles[i] ?? "NORMAL_TEXT" } } });
      idx += p.length;
    });
    return { documentId: id, title: this.title, body: { content }, documentStyle: {} };
  }
  check(r: { startIndex: number; endIndex: number }, what: string) {
    if (!(r.startIndex >= 1 && r.endIndex > r.startIndex && r.endIndex <= this.end)) throw new Error(`${what}: range ${r.startIndex}-${r.endIndex} outside 1-${this.end}`);
  }
  apply(req: any): any {
    if (req.insertText) {
      const { location, text } = req.insertText;
      if (location.segmentId) { this.headerText += text; return {}; }
      if (!(location.index >= 1 && location.index <= this.text.length)) throw new Error(`insertText index ${location.index} outside 1-${this.text.length}`);
      const off = location.index - 1;
      const p = this.paraOf(off);
      this.text = this.text.slice(0, off) + text + this.text.slice(off);
      for (let i = 0; i < (text.match(/\n/g) ?? []).length; i++) this.styles.splice(p, 0, this.styles[p]);
      return {};
    }
    if (req.updateParagraphStyle) {
      const { range, paragraphStyle } = req.updateParagraphStyle;
      this.check(range, "updateParagraphStyle");
      for (let p = this.paraOf(range.startIndex - 1); p <= this.paraOf(range.endIndex - 2); p++) if (paragraphStyle.namedStyleType) this.styles[p] = paragraphStyle.namedStyleType;
      return {};
    }
    if (req.updateTextStyle) { this.check(req.updateTextStyle.range, "updateTextStyle"); return {}; }
    if (req.createParagraphBullets) { this.check(req.createParagraphBullets.range, "createParagraphBullets"); return {}; }
    if (req.deleteContentRange) {
      const r = req.deleteContentRange.range;
      this.check(r, "deleteContentRange");
      this.text = this.text.slice(0, r.startIndex - 1) + this.text.slice(r.endIndex - 1);
      return {};
    }
    if (req.insertTable) { this.tables++; return {}; }
    if (req.insertPageBreak) { this.pageBreaks++; return {}; }
    if (req.replaceAllText) {
      const { containsText, replaceText } = req.replaceAllText;
      const n = this.text.split(containsText.text).length - 1;
      this.text = this.text.split(containsText.text).join(replaceText);
      return { replaceAllText: { occurrencesChanged: n } };
    }
    if (req.updateDocumentStyle) return {};
    if (req.createHeader) return { createHeader: { headerId: "hdr1" } };
    throw new Error("unsupported request " + Object.keys(req)[0]);
  }
}

export function installFakeGoogle(opts: { kv?: FakeKV } = {}) {
  const docs = new Map<string, DocSim>();
  const log: string[] = [];
  const uploads: { name: string; body: string }[] = [];
  const folders = new Map<string, string>();
  let counter = 0;

  const seedDoc = (id: string, title: string, text: string) => {
    const d = new DocSim(title);
    d.text = text.endsWith("\n") ? text : text + "\n";
    d.styles = d.text.split(/(?<=\n)/).map(() => "NORMAL_TEXT");
    docs.set(id, d);
    return d;
  };

  const courseWork = [
    { id: "W1", title: "Understanding MCP", description: "Submit as a PDF. Maximum 3 pages. Use APA citations.", state: "PUBLISHED", dueDate: { year: 2026, month: 10, day: 12 }, dueTime: { hours: 18, minutes: 29 }, maxPoints: 100, workType: "ASSIGNMENT", topicId: "T1", alternateLink: "https://classroom.google.com/c/C1/a/W1", updateTime: "2026-10-01T00:00:00Z", materials: [{ driveFile: { driveFile: { id: "TEACHER_DOC", title: "[Template] Submission Doc", alternateLink: "https://docs.google.com/document/d/TEACHER_DOC" }, shareMode: "STUDENT_COPY" } }] },
    { id: "W2", title: "Quiz question", description: "Answer briefly.", state: "PUBLISHED", maxPoints: 10, workType: "SHORT_ANSWER_QUESTION", alternateLink: "https://classroom.google.com/c/C1/a/W2", updateTime: "2026-10-02T00:00:00Z" },
    { id: "W3", title: "Old lab", state: "PUBLISHED", dueDate: { year: 2026, month: 9, day: 1 }, maxPoints: 50, workType: "ASSIGNMENT", gradeCategory: { id: "G1", name: "Labs", weight: 40000 }, alternateLink: "https://classroom.google.com/c/C1/a/W3" },
  ];
  const subs = [
    { id: "S1", courseWorkId: "W1", state: "CREATED", late: false, alternateLink: "https://classroom.google.com/c/C1/a/W1/s/S1", assignmentSubmission: { attachments: [{ driveFile: { id: "STUDENT_DOC", title: "Rayan - Submission Doc", alternateLink: "https://docs.google.com/document/d/STUDENT_DOC" } }] } },
    { id: "S2", courseWorkId: "W2", state: "NEW" },
    { id: "S3", courseWorkId: "W3", state: "RETURNED", assignedGrade: 45 },
  ];

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const err = (status: number, message: string, reason?: string) => json({ error: { code: status, message, status: "ERR", details: reason ? [{ reason }] : [] } }, status);

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname;
    log.push(`${method} ${url.host}${path}`);
    if (url.host === "oauth2.googleapis.com") return json({ access_token: "tok", expires_in: 3600 });

    if (url.host === "classroom.googleapis.com") {
      if (path === "/v1/courses") return json({ courses: [{ id: "C1", name: "MCP 101", section: "CSE-B", courseState: "ACTIVE", alternateLink: "https://classroom.google.com/c/C1" }] });
      if (path === "/v1/courses/C1/topics") return json({ topic: [{ topicId: "T1", name: "MCP" }] });
      if (path === "/v1/courses/C1/courseWork") return json({ courseWork });
      const m = /^\/v1\/courses\/C1\/courseWork\/([^/]+)(?:\/(studentSubmissions|rubrics))?$/.exec(path);
      if (m) {
        if (m[2] === "studentSubmissions") return json({ studentSubmissions: m[1] === "-" ? subs : subs.filter((s) => s.courseWorkId === m[1]) });
        if (m[2] === "rubrics") return json({ rubrics: [{ id: "R1", criteria: [{ title: "Clarity", description: "Explains well", levels: [{ title: "Good", points: 5 }, { title: "Poor", points: 1 }] }] }] });
        const w = courseWork.find((x) => x.id === m[1]);
        return w ? json(w) : err(404, "not found");
      }
      if (path === "/v1/courses/C1/announcements") return json({ announcements: [{ id: "A1", text: "Deadline for Understanding MCP is extended to Friday. Submit as PDF.", updateTime: "2026-10-05T00:00:00Z", alternateLink: "https://classroom.google.com/c/C1/p/A1" }] });
      if (path === "/v1/courses/C1/courseWorkMaterials") return json({ courseWorkMaterial: [{ id: "M1", title: "MCP spec notes", description: "Read the protocol overview", topicId: "T1", materials: [{ link: { url: "https://modelcontextprotocol.io", title: "MCP site" } }], updateTime: "2026-09-20T00:00:00Z" }] });
      return err(404, "unknown classroom path " + path);
    }

    if (url.host === "docs.googleapis.com") {
      if (path === "/v1/documents" && method === "POST") {
        const id = "NEWDOC" + ++counter;
        docs.set(id, new DocSim(JSON.parse(init.body).title));
        return json({ documentId: id, title: JSON.parse(init.body).title });
      }
      const m = /^\/v1\/documents\/([^/:]+)(:batchUpdate)?$/.exec(path);
      const d = m && docs.get(m[1]);
      if (!d) return err(404, "doc not found");
      if (m![2]) {
        try {
          const replies = JSON.parse(init.body).requests.map((r: any) => d.apply(r));
          return json({ replies });
        } catch (e) {
          return err(400, (e as Error).message);
        }
      }
      return json(d.json(m![1]));
    }

    if (url.host === "www.googleapis.com" && path.startsWith("/upload/drive/v3/files")) {
      uploads.push({ name: JSON.parse(String(init.body).split("\r\n\r\n")[1].split("\r\n")[0]).name, body: String(init.body) });
      return json({ id: "UP" + uploads.length, webViewLink: "https://drive.google.com/file/d/UP" + uploads.length });
    }
    if (url.host === "www.googleapis.com" && path === "/drive/v3/files" && method === "GET") {
      const name = /name='([^']+)'/.exec(url.searchParams.get("q") ?? "")?.[1] ?? "";
      return json({ files: folders.has(name) ? [{ id: folders.get(name) }] : [] });
    }
    if (url.host === "www.googleapis.com" && path === "/drive/v3/files" && method === "POST") {
      const b = JSON.parse(init.body);
      const id = "FOLDER" + ++counter;
      folders.set(b.name, id);
      return json({ id });
    }
    if (url.host === "www.googleapis.com" && /^\/drive\/v3\/files\/[^/]+$/.test(path)) return method === "PATCH" ? json({ id: "x" }) : json({ parents: ["root"] });
    return err(404, `unmocked ${method} ${url.host}${path}`);
  }) as typeof fetch;

  return { docs, seedDoc, log, uploads, folders, restore: () => (globalThis.fetch = realFetch) };
}

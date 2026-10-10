import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRenderTools } from "../apps/gateway/src/tools-render.ts";
import { registerStudyTools } from "../apps/gateway/src/tools-study.ts";
import { registerTools } from "../apps/gateway/src/tools.ts";
import { annotateTools } from "../apps/gateway/src/toolkit.ts";
import { FakeKV, installFakeGoogle } from "./fake-google.ts";
import { sample } from "./sample-spec.ts";

const kv = new FakeKV();
const g = installFakeGoogle({ kv });
g.seedDoc("STUDENT_DOC", "Rayan - Submission Doc", "MCP 101 Assignment 1\nName: ________\n[Roll Number]\n");
g.seedDoc("OTHER_DOC", "Someone else's doc", "secret\n");
const env: any = { OAUTH_KV: kv, GOOGLE_CLIENT_SECRET: "test-secret", GOOGLE_CLIENT_ID: "cid", PUBLIC_BASE_URL: "https://mcp.test", WEB_ORIGIN: "https://web.test", PICKER_API_KEY: "k", GCP_PROJECT_NUMBER: "1" };
const props: any = { userId: "u1", email: "s@example.com", googleRefreshToken: "rt", scopeVersion: 4 };

const server = new McpServer({ name: "t", version: "0" });
annotateTools(server);
registerTools(server, env, props);
registerRenderTools(server, env, props);
registerStudyTools(server, env, props);
const [a, b] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "c", version: "0" });
await Promise.all([server.connect(a), client.connect(b)]);

async function call(name: string, args: any = {}) {
  const r: any = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  if (r.isError) return { __error: text } as any;
  try { return JSON.parse(text); } catch { return text; }
}
const must = (r: any, label: string) => { assert.ok(!r?.__error, `${label} failed: ${r?.__error}`); return r; };

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log(tools.length, "tools registered");
assert.equal(new Set(tools).size, tools.length);
const listed = (await client.listTools()).tools;
const ann = (n: string) => listed.find((t) => t.name === n)!.annotations!;
assert.equal(ann("list_courses").readOnlyHint, true);
assert.equal(ann("edit_student_doc").readOnlyHint, false);
assert.equal(ann("edit_student_doc").destructiveHint, true);
assert.equal(ann("render_document").destructiveHint, false);
const sizes = Object.fromEntries(listed.map((t) => [t.name, JSON.stringify(t.inputSchema).length]));
console.log("largest schemas:", Object.entries(sizes).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(", "));

let r: any;
r = must(await call("whoami"), "whoami"); assert.equal(r.connected, true);
r = must(await call("list_courses"), "list_courses"); assert.equal(r.courses[0].id, "C1");
r = must(await call("get_course_overview", { courseId: "C1" }), "overview"); assert.equal(r.classwork.length, 3); assert.equal(r.announcements.length, 1);
r = must(await call("list_assignments", { status: "pending" }), "list_assignments"); assert.deepEqual(r.assignments.map((x: any) => x.id), ["W1", "W2"]);
r = must(await call("list_assignments", { courseId: "C1", status: "all" }), "list all"); assert.equal(r.assignments.length, 3);

r = must(await call("get_assignment_bundle", { courseId: "C1", assignmentId: "W1" }), "bundle");
assert.equal(r.templateStatus, "student_copy_exists");
assert.equal(r.submission.studentFiles[0].id, "STUDENT_DOC");
assert.equal(r.attachments[0].id, "TEACHER_DOC");
assert.match(r.studentCopyContent.text, /MCP 101 Assignment 1/);
assert.equal(r.announcementsMentioningThis.length, 1);
assert.deepEqual(r.partialErrors, []);
assert.ok(r.rubric.length === 1);

r = must(await call("read_attachment", { fileId: "STUDENT_DOC" }), "read_attachment"); assert.equal(r.type, "doc");
r = must(await call("read_attachment", { fileId: "NOPE", name: "x.pdf" }), "read nonDoc");
assert.equal(r.ok, false); assert.equal(r.needsPicker, true); assert.match(r.pickerLink, /^https:\/\/web\.test\/pick\/\?s=[a-f0-9]{32}$/);

// profile
must(await call("update_profile", { profile: { fullName: "Rayan Jain", rollNo: "21CS001", branch: "CSE", institution: "Test Institute" }, courseId: "C1", courseSettings: { subjectName: "MCP 101", subjectCode: "CS101", teacherName: "Dr T" } }), "update_profile");
r = must(await call("get_profile", { courseId: "C1" }), "get_profile"); assert.equal(r.profile.fullName, "Rayan Jain"); assert.equal(r.courseSettings.subjectCode, "CS101");
assert.ok(![...kv.m.values()].some((v) => v.includes("Rayan Jain")), "profile must be stored encrypted");
r = must(await call("map_profile_to_template", { fileId: "STUDENT_DOC" }), "map_profile");
assert.deepEqual(r.replacements.map((x: any) => x.replace), ["Name: Rayan Jain", "21CS001"]);

// edit in place: ownership check, preview, confirm, apply
r = await call("edit_student_doc", { courseId: "C1", assignmentId: "W1", fileId: "OTHER_DOC", appendBlocks: [{ type: "paragraph", text: "x" }] });
assert.match(r.error, /not the student's own/);
const edit = { courseId: "C1", assignmentId: "W1", fileId: "STUDENT_DOC", replacements: r.error ? r && map(r) : [], appendBlocks: [{ type: "heading", level: 1, text: "Aim" }, { type: "paragraph", text: "Hello **bold**." }, { type: "list", ordered: false, items: ["a", "b"] }, { type: "table", columns: ["A", "B"], rows: [["1", "2"]] }, { type: "pagebreak" }, { type: "paragraph", text: "End" }] };
function map(_: any) { return [{ find: "Name: ________", replace: "Name: Rayan Jain" }, { find: "[Roll Number]", replace: "21CS001" }]; }
r = must(await call("edit_student_doc", edit), "edit preview"); assert.equal(r.preview, true); assert.ok(r.confirmToken);
const token = r.confirmToken;
assert.match((await call("edit_student_doc", { ...edit, confirmToken: "1.bad" })).error, /invalid/);
assert.match((await call("edit_student_doc", { ...edit, appendBlocks: [], confirmToken: token })).error ?? "x", /Nothing to do|invalid/);
r = must(await call("edit_student_doc", { ...edit, confirmToken: token }), "edit apply"); assert.equal(r.applied, true); assert.equal(r.replacementsMade, 2);
const doc = g.docs.get("STUDENT_DOC")!;
assert.match(doc.text, /Name: Rayan Jain\n21CS001\n/);
assert.match(doc.text, /\nAim\nHello bold\.\na\nb\n/, doc.text);
assert.equal(doc.tables, 1); assert.equal(doc.pageBreaks, 1);
assert.ok(!doc.text.includes("§§"), "placeholders cleaned up: " + JSON.stringify(doc.text));
assert.equal(doc.styles[doc.text.split("\n").indexOf("Aim")], "HEADING_1");

// terminal figure added to the student's Doc
const termEdit = { courseId: "C1", assignmentId: "W1", fileId: "STUDENT_DOC", appendBlocks: [{ type: "terminal", theme: "powershell", source: "illustrative", caption: "Running the server", alt: "terminal", entries: [{ cmd: "node server.js", output: "listening on 8000" }] }] };
r = must(await call("edit_student_doc", termEdit), "terminal preview");
r = must(await call("edit_student_doc", { ...termEdit, confirmToken: r.confirmToken }), "terminal apply"); assert.equal(r.applied, true);
assert.match(doc.text, /Figure: Running the server \(simulated output\)/);
assert.equal(doc.tables, 2, "terminal becomes a table");

// render: latex
const spec = JSON.parse(JSON.stringify(sample));
r = must(await call("render_document", { spec, courseId: "C1", courseName: "MCP 101", assignmentTitle: "Understanding MCP" }), "render latex");
assert.equal(r.format, "latex"); assert.match(r.overleafLink, /^https:\/\/mcp\.test\/open\/[a-f0-9]{32}$/); assert.ok(r.tex.includes("\\begin{document}")); assert.ok(r.driveFile.id);
const cspec = JSON.parse(JSON.stringify(sample)); cspec.blocks.find((x: any) => x.type === "cover").fields = { date: "10 Oct" };
const tspec2 = JSON.parse(JSON.stringify(spec)); tspec2.blocks.push({ type: "terminal", theme: "ubuntu", source: "captured", caption: "Run", alt: "t", entries: [{ cmd: "ls", output: "a  b" }] }, { type: "ui", kind: "browser", source: "illustrative", caption: "Page", alt: "p", title: "T", url: "https://x.test", content: [{ t: "heading", text: "Hi" }] });
r = must(await call("render_document", { spec: tspec2, saveToDrive: false }), "render with figures");
assert.ok(r.tex.includes("tikzpicture") && r.tex.includes("(simulated)"), "illustrative UI is labelled");
assert.ok(!r.tex.includes("simulated output"), "captured terminal carries no simulated label");
const cr2 = must(await call("render_document", { spec: cspec, courseId: "C1", saveToDrive: false }), "render latex cover");
for (const want of ["Test Institute", "Rayan Jain", "21CS001", "CS101", "Dr T"]) assert.ok(cr2.tex.includes(want), "cover missing " + want);
assert.equal(g.uploads.length, 1); assert.equal(g.uploads[0].name, "Understanding MCP.tex");
assert.ok([...g.folders.keys()].join() === "ClassroomPilot,MCP 101,Understanding MCP", [...g.folders.keys()].join());
// render: google doc (cover filled from profile)
const gspec = JSON.parse(JSON.stringify(sample)); gspec.meta.format = "google-doc"; gspec.blocks.find((x: any) => x.type === "cover").fields = { date: "10 Oct" };
r = must(await call("render_document", { spec: gspec, courseId: "C1", saveToDrive: false }), "render doc");
assert.equal(r.format, "google-doc"); const nd = g.docs.get(r.document.id)!;
assert.ok(nd.tables >= 2, "cover + data tables"); assert.match(nd.text, /\[1, 2\]/); assert.match(nd.text, /References/);
assert.ok(nd.headerText.includes("DBMS Lab"));

// analysis & planning
r = must(await call("analyze_template", { fileId: "STUDENT_DOC" }), "analyze_template"); assert.equal(r.kind, "docs_copy");
r = must(await call("weekly_plan", { days: 30 }), "weekly_plan"); assert.equal(r.plan[0].id, "W1"); assert.equal(r.noDueDate[0].id, "W2"); assert.ok(!JSON.stringify(r).includes("W3")); // returned work is excluded
r = must(await call("get_rubric", { courseId: "C1", assignmentId: "W1" }), "get_rubric"); assert.equal(r.rubric[0].criteria.length, 1);
r = must(await call("list_topics", { courseId: "C1" }), "list_topics"); assert.equal(r.topics[0].name, "MCP");
r = must(await call("get_stream", { courseId: "C1", mentions: "mcp" }), "get_stream"); assert.ok(r.total >= 2);
r = must(await call("search_course_context", { query: "protocol overview" }), "search"); assert.equal(r.results[0].id, "M1");
r = must(await call("get_grades"), "get_grades"); assert.equal(r.courses[0].gradedPoints.estimatedPercent, 90); assert.equal(r.courses[0].categories[0].name, "Labs");
r = must(await call("check_requirements", { courseId: "C1", assignmentId: "W1", spec: gspec }), "check spec");
assert.ok(r.requirements.some((x: any) => x.kind === "pages" && x.status === "fail") || r.requirements.some((x: any) => x.kind === "pages"));
assert.ok(r.requirements.some((x: any) => x.kind === "citation"));
r = must(await call("check_requirements", { courseId: "C1", assignmentId: "W1", fileId: "STUDENT_DOC" }), "check doc"); assert.ok(r.draft.words > 5);
r = must(await call("prepare_submission", { courseId: "C1", assignmentId: "W1" }), "prepare"); assert.equal(r.route, "edit_own_copy");
r = must(await call("prepare_submission", { courseId: "C1", assignmentId: "W2" }), "prepare W2"); assert.equal(r.route, "answer_question");
r = must(await call("prepare_submission", { courseId: "C1", assignmentId: "W3" }), "prepare W3"); assert.equal(r.route, "already_submitted");
r = must(await call("verify_turned_in", { courseId: "C1", assignmentId: "W3" }), "verify"); assert.equal(r.turnedIn, true);
r = must(await call("get_submission_status", { courseId: "C1", assignmentId: "W1" }), "status"); assert.equal(r.state, "CREATED");
r = must(await call("delete_my_data"), "delete"); assert.ok(r.deletedRecords >= 2);
r = must(await call("get_profile"), "get_profile after delete"); assert.deepEqual(r.profile, {});

// error mapping
const real = globalThis.fetch;
globalThis.fetch = (async (i: any, o: any) => String(i).includes("/courses") && !String(i).includes("oauth") ? new Response(JSON.stringify({ error: { code: 403, message: "Docs API disabled", status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } }), { status: 403 }) : real(i, o)) as any;
r = await call("list_courses"); assert.match(r.__error, /not enabled/);
globalThis.fetch = real;

console.log("e2e passed;", g.log.length, "google calls");

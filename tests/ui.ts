import { DocSpec } from "@classroompilot/shared";
import { toLatex } from "../apps/gateway/src/latex.ts";
import { writeFileSync } from "node:fs";
const spec = {
  meta: { title: "UI mockups", template: "minimal", format: "latex", useProfile: false },
  blocks: [
    { type: "ui", kind: "browser", theme: "light", source: "illustrative", caption: "Student portal login result", alt: "browser", title: "Student Portal - Dashboard", url: "https://portal.example.edu/dashboard",
      sidebar: ["Dashboard", "Courses", "Grades", "Settings"], activeSidebar: 0,
      content: [
        { t: "heading", text: "Welcome back, Rayan" },
        { t: "alert", tone: "success", text: "You are signed in. Your last login was today at 09:41." },
        { t: "text", text: "Here is a summary of your enrolled courses and their current grades for this semester. Select a course to see details." },
        { t: "table", columns: ["Course", "Code", "Grade"], rows: [["Database Management Systems", "CS301", "A"], ["Machine Learning", "CS402", "A-"]] },
        { t: "input", label: "Search courses", placeholder: "Type a course name" },
        { t: "buttons", labels: ["Enroll", "Cancel"], primary: 0 },
      ] },
    { type: "ui", kind: "window", theme: "dark", source: "captured", caption: "Notes app", alt: "app", title: "Notes", menu: ["File", "Edit", "View", "Help"],
      content: [{ t: "heading", text: "Meeting notes" }, { t: "list", items: ["Review MCP spec", "Draft assignment", "Ask about rubric"] }, { t: "code", text: "npm run build\nnpm test" }, { t: "alert", tone: "error", text: "Could not sync: network unavailable." }, { t: "input", label: "Title", value: "Meeting notes" }, { t: "button", text: "Save" }] },
  ],
};
const r = toLatex(DocSpec.parse(spec));
writeFileSync(process.argv[2], r.tex);
console.log(r.engine, JSON.stringify(r.lint.map((l) => l.message.slice(0, 70))));

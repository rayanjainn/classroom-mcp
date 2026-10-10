import { DocSpec } from "@classroompilot/shared";
import { toLatex } from "../apps/gateway/src/latex.ts";
import { writeFileSync } from "node:fs";
const py = [
  { cwd: "~/mcp-demo", cmd: "python3 server.py", output: "Starting MCP server on http://127.0.0.1:8000/mcp\nRegistered tools: add, greet\nINFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)" },
  { cmd: "curl -s localhost:8000/healthz", output: '{"ok":true}' },
  { cmd: "python3 client.py add 2 3", output: "Traceback (most recent call last):\n  File \"client.py\", line 4, in <module>\n    result = session.call_tool(\"add\", a=2, b=3)\nTypeError: call_tool() got an unexpected keyword argument 'a'" },
];
const win = [
  { cwd: "C:\\Users\\rayan\\mcp-demo", cmd: "node --version", output: "v22.11.0" },
  { cmd: "npm test", output: "> mcp-demo@1.0.0 test\n> node --test\n\n\u2714 tool add returns 5 (1.8ms)\n\u2714 tool greet returns greeting (0.9ms)\n\u2139 tests 2\n\u2139 pass 2\n\u2139 fail 0" },
];
const mk = (theme: string, entries: any[], extra: any = {}) => ({ type: "terminal", theme, source: "illustrative", caption: `Terminal (${theme})`, alt: "terminal", entries, ...extra });
const spec = {
  meta: { title: "Terminal themes", template: "minimal", format: "latex", useProfile: false },
  blocks: [
    mk("ubuntu", py, { user: "rayan", host: "rayan-pc" }),
    mk("macos-dark", py, { user: "rayan", host: "Rayans-MacBook-Air" }),
    mk("macos-light", py, { user: "rayan" }),
    mk("powershell", win, { user: "rayan" }),
    mk("cmd", win),
    mk("vscode", win),
    mk("ubuntu", [{ cwd: "~/lab", cmd: "echo 'a very long line to check wrapping behaviour of the terminal emulator model '$(seq 1 40 | tr '\\n' ' ')", output: "ok" }], { columns: 60, endPrompt: false, source: "captured" }),
  ],
};
const r = toLatex(DocSpec.parse(spec));
writeFileSync(process.argv[2], r.tex);
console.log(r.engine, r.estimatedPages, JSON.stringify(r.lint.map((l) => l.message.slice(0, 80))));

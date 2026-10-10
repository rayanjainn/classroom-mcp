import { DocSpec } from "@classroompilot/shared";
import { toLatex } from "../apps/gateway/src/latex.ts";
import { sample } from "./sample-spec.ts";
import { writeFileSync } from "node:fs";
const base = JSON.parse(JSON.stringify(sample));
base.blocks = base.blocks.filter((b: any) => b.type !== "toc");
base.blocks.find((b: any) => b.type === "paragraph" && b.text.includes("arrows")).text = "Indexes helped by about 2x - “nice” – café.";
const long = { type: "table", caption: "Long", columns: ["A", "B"], rows: Array.from({ length: 60 }, (_, i) => [`r${i}`, `v${i}`]) };
const hostile = [
  { type: "paragraph", text: "Bad math $\\input{/etc/passwd}$ and $\\write18{ls}$ and {unbalanced $x}$ and \\textbackslash weird \\ & % # _ ~ ^" },
  { type: "equation", latex: "\\immediate\\write18{rm -rf /}" },
  { type: "equation", latex: "x^{2" },
  { type: "code", language: "python", text: "print('\\\\end{lstlisting} é')" },
];
const variants: Record<string, any> = {
  v1: { ...base },
  v2: { ...base, meta: { ...base.meta, font: "times", columns: 2, colorMode: "grayscale", template: "project-report", fontSize: 10 } },
  v3: { ...base, blocks: [...base.blocks, long] },
  v4: { ...base, blocks: [...base.blocks, ...hostile] },
};
for (const [k, v] of Object.entries(variants)) {
  const r = toLatex(DocSpec.parse(v));
  writeFileSync(`/tmp/claude-0/${k}.tex`, r.tex);
  console.log(k, r.engine, r.estimatedPages, r.lint.map((l) => l.message.slice(0, 60)).join(" | "));
}

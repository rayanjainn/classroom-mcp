import { DocSpec } from "@classroompilot/shared";
import { toLatex } from "../apps/gateway/src/latex.ts";
import { sample } from "./sample-spec.ts";
import { writeFileSync } from "node:fs";
const spec = DocSpec.parse(sample);
const r = toLatex(spec);
writeFileSync(process.argv[2], r.tex);
console.log(r.engine, r.estimatedPages, JSON.stringify(r.lint));

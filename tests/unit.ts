import assert from "node:assert/strict";
import { safeMath, esc } from "../apps/gateway/src/latex.ts";
import { scanPlaceholders } from "../apps/gateway/src/profile.ts";
import { buildAppend } from "../apps/gateway/src/docedit.ts";
import { issueConfirm, checkConfirm } from "../apps/gateway/src/security.ts";

// math safety
for (const bad of ["\\input{/etc/passwd}", "\\write18{ls}", "\\immediate\\write18{x}", "\\csname x\\endcsname", "x^{2", "x}", "\\def\\a{b}", "\\usepackage{x}", "\\catcode`\\^^M=12", "\\@namedef{a}{b}", "\\pdfshellescape", "\\directlua{os.execute()}", "\\begin{document}", "a $ b", "\\verb|x|", "\\href{http://x}{y}"])
  assert.equal(safeMath(bad), false, `should reject ${bad}`);
for (const good of ["\\frac{a}{b}", "\\sum_{i=1}^{N} x_i", "\\left( x \\right)", "\\leq \\int_0^1 f", "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", "\\begin{cases} 1 & x>0 \\\\ 0 & \\text{else} \\end{cases}", "\\sigma^2", "\\mathbb{R}", "\\reals", "\\imath"])
  assert.equal(safeMath(good), true, `should accept ${good}`);
assert.equal(esc("a_b & 50% #1 {x} ~ ^"), "a\\_b \\& 50\\% \\#1 \\{x\\} \\textasciitilde{} \\textasciicircum{}");

// placeholders
const ph = scanPlaceholders(["Name: ________", "Roll No:", "[Your Name]", "{{uid}}", "Batch: B3", "Some prose: not a field here, really."]);
assert.deepEqual(ph.map((p) => p.field), ["fullName", "rollNo", "fullName", "uid"]);

// docs index arithmetic: every insertText index equals previous index + previous length
const b = buildAppend([{ type: "heading", level: 1, text: "Aim" }, { type: "paragraph", text: "Hi **x**\n\nSecond" }, { type: "list", ordered: true, items: ["a", "bb"] }, { type: "table", columns: ["A"], rows: [["1"]] }, { type: "pagebreak" }], 10, true);
let expect = 10;
for (const r of b.requests) if (r.insertText) { assert.equal(r.insertText.location.index, expect); expect += r.insertText.text.length; }
assert.equal(expect, b.endIndex);
assert.equal(b.jobs.length, 2);

// confirm tokens
const t = await issueConfirm("s3cret", "u1", "edit", "h1");
assert.equal(await checkConfirm("s3cret", t, "u1", "edit", "h1"), true);
assert.equal(await checkConfirm("s3cret", t, "u1", "edit", "h2"), false);
assert.equal(await checkConfirm("s3cret", t, "u2", "edit", "h1"), false);
assert.equal(await checkConfirm("other", t, "u1", "edit", "h1"), false);
assert.equal(await checkConfirm("s3cret", "1.abc", "u1", "edit", "h1"), false);
console.log("unit tests passed");

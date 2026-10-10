import type { BlockT, DocSpecT } from "@classroompilot/shared";
import { citedKeys, formatEntry, inText, orderBibliography } from "./cite.js";

export interface LintItem {
  level: "error" | "warning" | "info";
  message: string;
}

export interface LatexResult {
  tex: string;
  engine: "pdflatex" | "xelatex";
  lint: LintItem[];
  estimatedPages: number;
}

// ---------- escaping & inline rendering ----------

const SPECIAL: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "<": "\\textless{}",
  ">": "\\textgreater{}",
  "|": "\\textbar{}",
};

export const esc = (s: string) => s.replace(/[\\&%$#_{}~^<>|]/g, (c) => SPECIAL[c]).replace(/\u000b/g, "\\\\").replace(/\u00a0/g, "~");

const FORBIDDEN_CMDS =
  "input|include|includeonly|import|subimport|write|newwrite|openout|closeout|openin|newread|read|readline|immediate|def|edef|gdef|xdef|let|futurelet|catcode|csname|endcsname|expandafter|noexpand|usepackage|RequirePackage|documentclass|newcommand|renewcommand|providecommand|DeclareRobustCommand|href|url|special|jobname|detokenize|scantokens|endinput|verbatiminput|lstinputlisting|includegraphics|includepdf|ShellEscape|makeatletter|makeatother|begin|end|verb|string|uppercase|lowercase|pdf[A-Za-z]*|lua[A-Za-z]*|directlua|latelua|tikz[A-Za-z]*|pgf[A-Za-z]*|foreach";
// A control word is forbidden when followed by a non-letter (so \write18 is caught but \writer is not), or when it contains @, or ^^ notation is used.
const FORBIDDEN = new RegExp(`\\\\(?:(?:${FORBIDDEN_CMDS})(?![A-Za-z])|[A-Za-z]*@)|\\^\\^`, "i");

/** True when a LaTeX math fragment is safe to emit. */
const MATH_ENVS = /\\(?:begin|end)\{(?:pmatrix|bmatrix|vmatrix|Vmatrix|matrix|smallmatrix|cases|aligned|array|split|gathered)\}/g;

export function safeMath(src: string): boolean {
  if (FORBIDDEN.test(src.replace(MATH_ENVS, ""))) return false;
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth < 0) return false;
  }
  return depth === 0 && !/\$|\n\s*\n/.test(src);
}

const safeLabel = (s: string) => s.replace(/[^A-Za-z0-9:_-]/g, "");

interface Ctx {
  spec: DocSpecT;
  lint: LintItem[];
  bibMap: Map<string, DocSpecT["bibliography"][number]>;
  order: string[];
}

const INLINE = /(\$(?!\s)[^$\n]+?(?<!\s)\$|`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[@[^\]\n]+\])/g;

export function inline(src: string, ctx: Ctx): string {
  let out = "";
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    out += esc(src.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("$")) {
      const body = t.slice(1, -1);
      if (safeMath(body)) out += `$${body}$`;
      else {
        ctx.lint.push({ level: "warning", message: `Unsafe or unbalanced math removed: ${t.slice(0, 40)}` });
        out += esc(t);
      }
    } else if (t.startsWith("`")) out += `\\texttt{${esc(t.slice(1, -1))}}`;
    else if (t.startsWith("**")) out += `\\textbf{${inline(t.slice(2, -2), ctx)}}`;
    else if (t.startsWith("[@")) {
      const keys = citedKeys([t]);
      for (const k of keys) if (!ctx.bibMap.has(k)) ctx.lint.push({ level: "warning", message: `Citation [@${k}] has no bibliography entry` });
      out += esc(inText(keys, ctx.bibMap, ctx.order, ctx.spec.meta.citationStyle));
    } else out += `\\emph{${inline(t.slice(1, -1), ctx)}}`;
    last = m.index! + t.length;
  }
  return out + esc(src.slice(last));
}

// ---------- cover page ----------

const LABELS: Record<string, string> = {
  fullName: "Name",
  rollNo: "Roll No.",
  uid: "UID",
  enrollmentNo: "Enrollment No.",
  branch: "Branch",
  programme: "Programme",
  className: "Class",
  section: "Section",
  batch: "Batch",
  semester: "Semester",
  teacherName: "Submitted to",
  date: "Date",
};
const ROW_ORDER = ["fullName", "rollNo", "uid", "enrollmentNo", "programme", "branch", "className", "section", "batch", "semester", "teacherName", "date"];
const TOP_KEYS = ["institution", "department", "subject", "subjectCode"];

export const humanize = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

export function coverRows(fields: Record<string, string>): [string, string][] {
  const keys = [...ROW_ORDER.filter((k) => fields[k]), ...Object.keys(fields).filter((k) => fields[k] && !ROW_ORDER.includes(k) && !TOP_KEYS.includes(k))];
  return keys.map((k) => [LABELS[k] ?? humanize(k), fields[k]]);
}

function cover(fields: Record<string, string>, spec: DocSpecT, ctx: Ctx): string {
  const rows = coverRows(fields)
    .map(([l, v]) => `\\textbf{${esc(l)}} & ${inline(v, ctx)} \\\\`)
    .join("\n");
  const subject = [fields.subject, fields.subjectCode ? `(${fields.subjectCode})` : ""].filter(Boolean).join(" ");
  return `\\begin{titlepage}
\\centering
\\vspace*{1cm}
${fields.institution ? `{\\Large\\bfseries ${esc(fields.institution)}\\par}\\vspace{4pt}\n` : ""}${fields.department ? `{\\large ${esc(fields.department)}\\par}\\vspace{1.5cm}\n` : "\\vspace{1.5cm}\n"}${subject ? `{\\large ${esc(subject)}\\par}\\vspace{0.8cm}\n` : ""}\\rule{\\linewidth}{0.6pt}\\par\\vspace{0.4cm}
{\\LARGE\\bfseries ${inline(spec.meta.title, ctx)}\\par}
${spec.meta.subtitle ? `\\vspace{0.3cm}{\\large ${inline(spec.meta.subtitle, ctx)}\\par}\n` : ""}\\vspace{0.4cm}\\rule{\\linewidth}{0.6pt}\\par
\\vfill
${rows ? `\\begin{tabular}{@{}ll@{}}\n${rows}\n\\end{tabular}\n` : ""}\\vfill
\\end{titlepage}
`;
}

// ---------- blocks ----------

const LST_LANG: Record<string, string> = {
  python: "Python", py: "Python", java: "Java", c: "C", cpp: "C++", "c++": "C++", sql: "SQL", javascript: "Java", js: "Java",
  bash: "bash", sh: "bash", html: "HTML", xml: "XML", r: "R", matlab: "Matlab", php: "PHP", ruby: "Ruby", go: "Go",
  rust: "none", json: "none", yaml: "none", text: "none",
};

function table(b: Extract<BlockT, { type: "table" }>, ctx: Ctx): string {
  const n = b.columns.length;
  if (n > 6) ctx.lint.push({ level: "warning", message: `Table "${b.caption ?? b.columns[0]}" has ${n} columns; it may look cramped.` });
  const longCols = b.columns.map((c, i) => Math.max(c.length, ...b.rows.map((r) => (r[i] ?? "").length)) > 28);
  const spec = b.columns
    .map((_, i) => (longCols[i] ? `>{\\raggedright\\arraybackslash}X` : (b.align?.[i] ?? "l")))
    .join(" ");
  const useX = longCols.some(Boolean);
  const head = b.columns.map((c) => `\\textbf{${inline(c, ctx)}}`).join(" & ");
  const rows = b.rows.map((r) => {
    if (r.length > n) ctx.lint.push({ level: "warning", message: "A table row had extra cells that were dropped." });
    return b.columns.map((_, i) => inline(r[i] ?? "", ctx)).join(" & ");
  });
  const long = b.rows.length > 28;
  const cap = b.caption ? `\\caption{${inline(b.caption, ctx)}}` : "";
  const size = n > 6 ? "\\small\\setlength{\\tabcolsep}{4pt}\n" : "";
  if (long) {
    const colspec = useX ? spec.replace(/>\{\\raggedright\\arraybackslash\}X/g, "p{0.3\\linewidth}") : spec;
    return `{${size}\\begin{longtable}{${colspec}}
${cap}${cap ? "\\\\" : ""}
\\toprule
${head} \\\\
\\midrule
\\endfirsthead
\\toprule
${head} \\\\
\\midrule
\\endhead
\\bottomrule
\\endfoot
${rows.join(" \\\\\n")} \\\\
\\end{longtable}}
`;
  }
  const env = useX ? `\\begin{tabularx}{\\linewidth}{${spec}}` : `\\begin{tabular}{${spec}}`;
  const endEnv = useX ? "\\end{tabularx}" : "\\end{tabular}";
  return `\\begin{table}[htbp]
\\centering
${size}${cap}
${env}
\\toprule
${head} \\\\
\\midrule
${rows.join(" \\\\\n")}${rows.length ? " \\\\" : ""}
\\bottomrule
${endEnv}
\\end{table}
`;
}

function chart(b: Extract<BlockT, { type: "chart" }>, ctx: Ctx): string {
  const gray = ctx.spec.meta.colorMode === "grayscale";
  const opts: string[] = ["width=0.88\\linewidth", "height=6.5cm", "grid=major", "legend pos=outer north east"];
  if (b.title) opts.push(`title={${esc(b.title)}}`);
  if (b.xLabel) opts.push(`xlabel={${esc(b.xLabel)}}`);
  if (b.yLabel) opts.push(`ylabel={${esc(b.yLabel)}}`);
  if (gray) opts.push("cycle list name=black white");
  let plots = "";
  if (b.chartType === "bar") {
    const cats = (b.categories ?? b.series[0].y.map((_, i) => String(i + 1))).map((c) => c.replace(/[,{}]/g, " "));
    opts.push("ybar", "bar width=8pt", `xtick=data`, `xticklabels={${cats.map(esc).join(",")}}`, "enlarge x limits=0.15", "ymin=0");
    if (cats.length > 6) opts.push("x tick label style={rotate=45,anchor=east}");
    for (const s of b.series) {
      if (s.y.length !== cats.length) ctx.lint.push({ level: "warning", message: `Series "${s.name}" has ${s.y.length} values for ${cats.length} categories.` });
      plots += `\\addplot${gray ? "[fill=gray!60]" : ""} coordinates {${s.y.map((y, i) => `(${i},${y})`).join(" ")}};\n\\addlegendentry{${esc(s.name)}}\n`;
    }
  } else {
    for (const s of b.series) {
      const pts = s.y.map((y, i) => `(${s.x?.[i] ?? i + 1},${y})`).join(" ");
      plots += `\\addplot[${b.chartType === "scatter" ? "only marks" : "mark=*"}] coordinates {${pts}};\n\\addlegendentry{${esc(s.name)}}\n`;
    }
  }
  return `\\begin{figure}[htbp]
\\centering
% alt: ${b.alt.replace(/[\r\n]+/g, " ")}
\\begin{tikzpicture}
\\begin{axis}[${opts.join(",\n  ")}]
${plots}\\end{axis}
\\end{tikzpicture}
\\caption{${inline(b.caption, ctx)}}
\\end{figure}
`;
}

function diagram(b: Extract<BlockT, { type: "diagram" }>, ctx: Ctx): string {
  const ids = new Set(b.nodes.map((n) => n.id));
  const edges = b.edges.filter((e) => {
    const ok = ids.has(e.from) && ids.has(e.to);
    if (!ok) ctx.lint.push({ level: "warning", message: `Diagram edge ${e.from}->${e.to} references an unknown node and was skipped.` });
    return ok;
  });
  // Layer = longest path from sources, ignoring back edges found by DFS.
  const adj = new Map<string, string[]>(b.nodes.map((n) => [n.id, []]));
  const indeg = new Map<string, number>(b.nodes.map((n) => [n.id, 0]));
  const state = new Map<string, number>();
  const forward: [string, string][] = [];
  const visit = (u: string) => {
    state.set(u, 1);
    for (const e of edges.filter((x) => x.from === u)) {
      const s = state.get(e.to) ?? 0;
      if (s === 1) continue; // back edge
      forward.push([u, e.to]);
      if (s === 0) visit(e.to);
    }
    state.set(u, 2);
  };
  const roots = b.nodes.filter((n) => !edges.some((e) => e.to === n.id && e.from !== n.id));
  for (const n of [...roots, ...b.nodes]) if (!state.get(n.id)) visit(n.id);
  for (const [u, v] of forward) (adj.get(u)!.push(v), indeg.set(v, indeg.get(v)! + 1));
  const layer = new Map<string, number>(b.nodes.map((n) => [n.id, 0]));
  const queue = b.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const deg = new Map(indeg);
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of adj.get(u)!) {
      layer.set(v, Math.max(layer.get(v)!, layer.get(u)! + 1));
      deg.set(v, deg.get(v)! - 1);
      if (deg.get(v) === 0) queue.push(v);
    }
  }
  const slot = new Map<number, number>();
  const pos = new Map<string, [number, number]>();
  for (const n of b.nodes) {
    const L = layer.get(n.id)!;
    const j = slot.get(L) ?? 0;
    slot.set(L, j + 1);
    pos.set(n.id, b.direction === "LR" ? [L * 3.6, -j * 2.0] : [j * 3.6, -L * 2.2]);
  }
  const style = (s: string) => (s === "diamond" ? "diamond, aspect=2, inner sep=1pt" : s === "round" ? "rounded corners=8pt" : "rounded corners=2pt");
  const nodes = b.nodes
    .map((n) => {
      const [x, y] = pos.get(n.id)!;
      return `\\node[draw, ${style(n.shape)}, align=center, text width=${n.shape === "diamond" ? "2.2cm" : "2.4cm"}, minimum height=0.9cm, font=\\small] (${n.id}) at (${x.toFixed(2)},${y.toFixed(2)}) {${esc(n.label)}};`;
    })
    .join("\n");
  const back = new Set(forward.map(([u, v]) => `${u}>${v}`));
  const paths = edges
    .map((e) => {
      const lbl = e.label ? ` node[midway, above, font=\\scriptsize, fill=white, inner sep=1pt]{${esc(e.label)}}` : "";
      if (e.from === e.to) return `\\draw[-{Stealth}] (${e.from}) edge[loop above]${lbl} (${e.to});`;
      const bend = back.has(`${e.from}>${e.to}`) ? "" : ", bend left=35";
      return `\\draw[-{Stealth}${bend}] (${e.from}) to${lbl} (${e.to});`;
    })
    .join("\n");
  return `\\begin{figure}[htbp]
\\centering
% alt: ${b.alt.replace(/[\r\n]+/g, " ")}
\\begin{adjustbox}{max width=\\linewidth}
\\begin{tikzpicture}[>=Stealth]
${nodes}
${paths}
\\end{tikzpicture}
\\end{adjustbox}
\\caption{${inline(b.caption, ctx)}}
\\end{figure}
`;
}

function renderBlock(b: BlockT, ctx: Ctx): string {
  switch (b.type) {
    case "heading":
      return `\\${["section", "subsection", "subsubsection"][b.level - 1]}{${inline(b.text, ctx)}}\n`;
    case "paragraph":
      return b.text.split(/\n{2,}/).map((p) => inline(p.trim().replace(/\n/g, " "), ctx)).filter(Boolean).join("\n\n") + "\n";
    case "equation": {
      if (!safeMath(b.latex)) {
        ctx.lint.push({ level: "warning", message: `Equation rejected as unsafe/unbalanced: ${b.latex.slice(0, 50)}` });
        return `\\begin{quote}\\texttt{${esc(b.latex)}}\\end{quote}\n`;
      }
      const label = b.label ? safeLabel(b.label) : "";
      return label ? `\\begin{equation}\\label{${label}}\n${b.latex}\n\\end{equation}\n` : `\\[\n${b.latex}\n\\]\n`;
    }
    case "table":
      return table(b, ctx);
    case "code": {
      const lang = LST_LANG[b.language.toLowerCase()] ?? "none";
      const opts = [lang === "none" ? "" : `language=${lang}`, b.caption ? `caption={${esc(b.caption)}}` : ""].filter(Boolean).join(",");
      return `\\begin{lstlisting}${opts ? `[${opts}]` : ""}\n${b.text.replace(/\\end\{lstlisting\}/g, "\\end{lstlisting }")}\n\\end{lstlisting}\n`;
    }
    case "list": {
      const env = b.ordered ? "enumerate" : "itemize";
      return `\\begin{${env}}[nosep]\n${b.items.map((i) => `\\item ${inline(i, ctx)}`).join("\n")}\n\\end{${env}}\n`;
    }
    case "quote":
      return `\\begin{quote}\n${inline(b.text, ctx)}\n\\end{quote}\n`;
    case "abstract":
      return `\\begin{abstract}\n${inline(b.text, ctx)}\n\\end{abstract}\n`;
    case "algorithm":
      return `\\paragraph{${inline(b.caption, ctx)}}\n\\begin{enumerate}[nosep,label=\\arabic*.]\n${b.steps.map((s) => `\\item ${inline(s, ctx)}`).join("\n")}\n\\end{enumerate}\n`;
    case "toc":
      return "\\tableofcontents\n\\clearpage\n";
    case "pagebreak":
      return "\\clearpage\n";
    case "chart":
      return chart(b, ctx);
    case "diagram":
      return diagram(b, ctx);
    case "cover":
      return ""; // handled separately
  }
}

// ---------- document ----------

const blockTexts = (b: BlockT): string[] => {
  switch (b.type) {
    case "paragraph": case "quote": case "abstract": return [b.text];
    case "heading": return [b.text];
    case "list": return b.items;
    case "table": return [...b.columns, ...b.rows.flat(), b.caption ?? ""];
    case "algorithm": return [b.caption, ...b.steps];
    case "chart": case "diagram": return [b.caption];
    default: return [];
  }
};

export function allText(spec: DocSpecT): string[] {
  return [spec.meta.title, spec.meta.subtitle ?? "", ...spec.blocks.flatMap(blockTexts)];
}

export function needsUnicodeEngine(spec: DocSpecT): boolean {
  // listings cannot handle any UTF-8 under pdflatex, so non-ASCII code also needs XeLaTeX.
  const code = spec.blocks.filter((b): b is Extract<BlockT, { type: "code" }> => b.type === "code").map((b) => b.text);
  const cover = spec.blocks.find((b): b is Extract<BlockT, { type: "cover" }> => b.type === "cover");
  const nonLatin = (s: string) => /[^\u0000-\u024f\u2010-\u2027\u2030-\u203a\u20ac]/.test(s);
  return code.some((c) => /[^\x00-\x7f]/.test(c)) || [...allText(spec), ...Object.values(cover?.fields ?? {})].some(nonLatin);
}

export function estimatePages(spec: DocSpecT): number {
  const words = allText(spec).join(" ").split(/\s+/).filter(Boolean).length;
  const perPage = (spec.meta.fontSize === 12 ? 380 : spec.meta.fontSize === 10 ? 560 : 460) * (spec.meta.columns === 2 ? 1.15 : 1) / Math.max(1, spec.meta.lineSpacing / 1.15);
  let pages = words / perPage;
  for (const b of spec.blocks) {
    if (b.type === "table") pages += 0.15 + b.rows.length * 0.03;
    else if (b.type === "chart" || b.type === "diagram") pages += 0.38;
    else if (b.type === "code") pages += b.text.split("\n").length / 48;
    else if (b.type === "cover" || b.type === "toc") pages += 1;
    else if (b.type === "equation") pages += 0.04;
  }
  return Math.max(1, Math.round(pages * 10) / 10);
}

export function lintSpec(spec: DocSpecT): LintItem[] {
  const out: LintItem[] = [];
  const headings = spec.blocks.filter((b) => b.type === "heading") as Extract<BlockT, { type: "heading" }>[];
  let prev = 0;
  for (const h of headings) {
    if (h.level > prev + 1 && prev !== 0) out.push({ level: "warning", message: `Heading "${h.text}" skips a level.` });
    prev = h.level;
  }
  spec.blocks.forEach((b, i) => {
    const next = spec.blocks[i + 1];
    if (b.type === "heading" && (!next || next.type === "heading") && !(next && (next as any).level > b.level))
      out.push({ level: "warning", message: `Section "${b.text}" has no content.` });
    if (b.type === "paragraph" && !b.text.trim()) out.push({ level: "warning", message: "An empty paragraph was found." });
  });
  const keys = spec.bibliography.map((e) => e.key);
  if (new Set(keys).size !== keys.length) out.push({ level: "error", message: "Duplicate bibliography keys." });
  const cited = citedKeys(allText(spec));
  for (const e of spec.bibliography) if (!cited.includes(e.key)) out.push({ level: "info", message: `Bibliography entry "${e.key}" is never cited.` });
  return out;
}

export function toLatex(spec: DocSpecT): LatexResult {
  const lint = lintSpec(spec);
  const cited = citedKeys(allText(spec));
  const bibMap = new Map(spec.bibliography.map((b) => [b.key, b]));
  const ctx: Ctx = { spec, lint, bibMap, order: cited.filter((k) => bibMap.has(k)) };
  const m = spec.meta;
  const unicode = needsUnicodeEngine(spec);
  const engine: LatexResult["engine"] = unicode ? "xelatex" : "pdflatex";
  const gray = m.colorMode === "grayscale";
  const coverBlock = spec.blocks.find((b) => b.type === "cover") as Extract<BlockT, { type: "cover" }> | undefined;
  const hasChartOrDiagram = spec.blocks.some((b) => b.type === "chart" || b.type === "diagram");
  const unnumbered = m.template === "lab-report" || m.template === "assignment-answers";

  const fontPre = unicode
    ? `\\usepackage{fontspec}\n${m.font === "times" ? "\\setmainfont{TeX Gyre Termes}" : m.font === "sans" ? "\\setmainfont{Latin Modern Sans}" : ""}`
    : `\\usepackage[T1]{fontenc}\n\\usepackage[utf8]{inputenc}\n${m.font === "times" ? "\\usepackage{mathptmx}" : m.font === "sans" ? "\\usepackage{helvet}\n\\renewcommand{\\familydefault}{\\sfdefault}" : "\\usepackage{lmodern}"}`;

  const body: string[] = [];
  let hasTitle = false;
  for (const b of spec.blocks) {
    if (b.type === "cover") {
      body.push(cover(b.fields, spec, ctx));
      hasTitle = true;
    } else body.push(renderBlock(b, ctx));
  }

  const preamble = `% Generated by ClassroomPilot. Compile with ${engine} (Overleaf: Menu > Compiler).
% !TEX program = ${engine}
\\documentclass[${m.fontSize}pt,${m.paper === "A4" ? "a4paper" : "letterpaper"}${m.columns === 2 ? ",twocolumn" : ""}]{article}
${fontPre}
\\usepackage[${m.paper === "A4" ? "a4paper" : "letterpaper"},margin=${m.marginCm}cm]{geometry}
\\usepackage{amsmath,amssymb,booktabs,tabularx,longtable,array,graphicx,caption,listings,enumitem,setspace,fancyhdr,adjustbox}
\\usepackage[${gray ? "gray" : "dvipsnames"}]{xcolor}
${hasChartOrDiagram ? "\\usepackage{pgfplots}\n\\pgfplotsset{compat=1.16}\n\\usetikzlibrary{arrows.meta,shapes.geometric,positioning}\n" : ""}\\usepackage[colorlinks=true,linkcolor=black,citecolor=black,urlcolor=${gray ? "black" : "blue"}]{hyperref}
\\setstretch{${m.lineSpacing}}
${unnumbered ? "\\setcounter{secnumdepth}{0}\n" : ""}\\lstset{basicstyle=\\ttfamily\\small,breaklines=true,frame=single,numbers=left,numberstyle=\\tiny,columns=fullflexible,keepspaces=true,showstringspaces=false,xleftmargin=1.5em,framexleftmargin=1.5em}
\\captionsetup{font=small,labelfont=bf}
\\pagestyle{fancy}\\fancyhf{}
${m.header ? `\\fancyhead[L]{\\small ${esc(m.header)}}\n` : ""}${m.pageNumbers ? "\\fancyfoot[C]{\\thepage}\n" : ""}\\renewcommand{\\headrulewidth}{${m.header ? "0.4pt" : "0pt"}}
\\setlength{\\parindent}{0pt}\\setlength{\\parskip}{0.6em}
\\title{${inline(m.title, ctx)}${m.subtitle ? `\\\\[0.3em]\\large ${inline(m.subtitle, ctx)}` : ""}}
\\date{}
\\author{}
`;

  let tex = preamble + "\\begin{document}\n";
  if (!hasTitle) tex += "\\maketitle\n\\thispagestyle{fancy}\n";
  tex += body.join("\n");

  if (cited.length || spec.bibliography.length) {
    const entries = orderBibliography(spec.bibliography, cited, m.citationStyle);
    if (m.citationStyle === "ieee") {
      tex += `\n\\begin{thebibliography}{99}\n${entries.map((e) => `\\bibitem{${e.key}} ${inline(formatEntry(e, m.citationStyle), ctx)}`).join("\n")}\n\\end{thebibliography}\n`;
    } else {
      tex += `\n\\section*{References}\n${entries.map((e) => `\\par\\hangindent=1.5em\\hangafter=1 ${inline(formatEntry(e, m.citationStyle), ctx)}\\par`).join("\n")}\n`;
    }
  }
  tex += "\\end{document}\n";

  if (unicode) lint.push({ level: "info", message: "Non-Latin characters found: compile with XeLaTeX (the file sets this for Overleaf). Indic scripts may need a Noto font via \\setmainfont." });
  return { tex, engine, lint, estimatedPages: estimatePages(spec) };
}

import type { BlockT, DocSpecT } from "@classroompilot/shared";
import { citedKeys, formatEntry, inText, orderBibliography } from "./cite.js";
import type { EditBlockT } from "./docedit.js";
import { allText, coverRows, estimatePages, lintSpec, type LintItem } from "./latex.js";

export interface DocsRender {
  blocks: EditBlockT[];
  notes: string[];
  lint: LintItem[];
  estimatedPages: number;
}

const FONT = { "computer-modern": "Cambria", times: "Times New Roman", sans: "Arial" } as const;
export const docsFont = (f: DocSpecT["meta"]["font"]) => FONT[f];

/** Convert a DocSpec into blocks the Google Docs appender understands. */
export function specToEditBlocks(spec: DocSpecT): DocsRender {
  const notes: string[] = [];
  const lint = lintSpec(spec);
  const bib = new Map(spec.bibliography.map((b) => [b.key, b]));
  const cited = citedKeys(allText(spec));
  const numbering = cited.filter((k) => bib.has(k));
  const style = spec.meta.citationStyle;

  const cite = (s: string) =>
    s.replace(/\[@([^\]\n]+)\]/g, (_m, inner: string) => {
      const keys = citedKeys([`[@${inner}]`]);
      for (const k of keys) if (!bib.has(k)) lint.push({ level: "warning", message: `Citation [@${k}] has no bibliography entry` });
      return inText(keys, bib, numbering, style);
    });

  const out: EditBlockT[] = [];
  const cap = (c?: string) => c && out.push({ type: "paragraph", text: `*${cite(c)}*` });
  const has = (t: BlockT["type"]) => spec.blocks.some((b) => b.type === t);

  if (!has("cover")) {
    out.push({ type: "heading", level: 1, text: spec.meta.title });
    if (spec.meta.subtitle) out.push({ type: "paragraph", text: `*${spec.meta.subtitle}*` });
  }

  for (const b of spec.blocks) {
    switch (b.type) {
      case "cover": {
        const f = b.fields;
        if (f.institution) out.push({ type: "paragraph", text: `**${f.institution}**` });
        if (f.department) out.push({ type: "paragraph", text: f.department });
        const subj = [f.subject, f.subjectCode ? `(${f.subjectCode})` : ""].filter(Boolean).join(" ");
        if (subj) out.push({ type: "paragraph", text: subj });
        out.push({ type: "heading", level: 1, text: spec.meta.title });
        if (spec.meta.subtitle) out.push({ type: "paragraph", text: `*${spec.meta.subtitle}*` });
        const rows = coverRows(f);
        if (rows.length) out.push({ type: "table", columns: ["Detail", "Value"], rows: rows.map(([l, v]) => [l, v]) });
        out.push({ type: "pagebreak" });
        break;
      }
      case "toc":
        notes.push("A table of contents cannot be inserted through the Docs API. In Google Docs use Insert > Table of contents.");
        break;
      case "heading":
        out.push({ type: "heading", level: b.level, text: cite(b.text) });
        break;
      case "paragraph":
        out.push({ type: "paragraph", text: cite(b.text) });
        break;
      case "equation":
        out.push({ type: "code", text: b.latex });
        notes.push("Equations appear as LaTeX text in Google Docs. Use the LaTeX output for typeset maths, or Insert > Equation to retype them.");
        break;
      case "table":
        cap(b.caption ? `Table: ${b.caption}` : undefined);
        out.push({ type: "table", columns: b.columns.map(cite), rows: b.rows.map((r) => r.map(cite)) });
        break;
      case "code":
        cap(b.caption);
        out.push({ type: "code", text: b.text });
        break;
      case "list":
        out.push({ type: "list", ordered: b.ordered, items: b.items.map(cite) });
        break;
      case "quote":
        out.push({ type: "paragraph", text: `*${cite(b.text)}*` });
        break;
      case "abstract":
        out.push({ type: "paragraph", text: `**Abstract.** ${cite(b.text)}` });
        break;
      case "algorithm":
        out.push({ type: "paragraph", text: `**${cite(b.caption)}**` });
        out.push({ type: "list", ordered: true, items: b.steps.map(cite) });
        break;
      case "pagebreak":
        out.push({ type: "pagebreak" });
        break;
      case "terminal":
        out.push(b);
        break;
      case "ui":
        notes.push("UI mockups are only drawn in the LaTeX output; in Google Docs they are skipped.");
        out.push({ type: "paragraph", text: `*Figure: ${b.caption} (UI mockup omitted in Google Docs output)*` });
        break;
      case "chart": {
        cap(`Figure: ${b.caption}`);
        const cats = b.categories ?? [...new Set(b.series.flatMap((s) => s.x ?? s.y.map((_, i) => i + 1)))].map(String);
        const rows = cats.map((c, i) => [c, ...b.series.map((s) => {
          const idx = s.x ? s.x.map(String).indexOf(c) : i;
          return idx >= 0 && s.y[idx] !== undefined ? String(s.y[idx]) : "";
        })]);
        out.push({ type: "table", columns: [b.xLabel ?? "x", ...b.series.map((s) => s.name)], rows });
        notes.push("Charts are shown as data tables in Google Docs. Use the LaTeX output for drawn charts, or build one in Google Sheets and insert it.");
        break;
      }
      case "diagram": {
        cap(`Figure: ${b.caption}`);
        const label = new Map(b.nodes.map((n) => [n.id, n.label]));
        out.push({ type: "list", ordered: false, items: b.edges.map((e) => `${label.get(e.from) ?? e.from} → ${label.get(e.to) ?? e.to}${e.label ? ` (${e.label})` : ""}`) });
        notes.push("Diagrams are listed as steps in Google Docs. Use the LaTeX output for drawn diagrams, or Insert > Drawing.");
        break;
      }
    }
  }

  if (cited.length || spec.bibliography.length) {
    const entries = orderBibliography(spec.bibliography, cited, style);
    out.push({ type: "heading", level: 1, text: "References" });
    out.push(style === "ieee" ? { type: "list", ordered: true, items: entries.map((e) => formatEntry(e, style)) } : { type: "list", ordered: false, items: entries.map((e) => formatEntry(e, style)) });
  }
  return { blocks: out, notes: [...new Set(notes)], lint, estimatedPages: estimatePages(spec) };
}

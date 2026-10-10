import { z } from "zod";

export const EditBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), level: z.number().int().min(1).max(4), text: z.string().max(300) }),
  z.object({ type: z.literal("paragraph"), text: z.string().max(20_000) }),
  z.object({ type: z.literal("list"), ordered: z.boolean(), items: z.array(z.string().max(2_000)).max(100) }),
  z.object({ type: z.literal("code"), text: z.string().max(20_000) }),
  z.object({
    type: z.literal("table"),
    columns: z.array(z.string().max(200)).min(1).max(8),
    rows: z.array(z.array(z.string().max(1_000))).max(60),
  }),
  z.object({ type: z.literal("pagebreak") }),
]);
export type EditBlockT = z.infer<typeof EditBlock>;

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

/** Tiny inline parser: **bold**, *italic*, `code`. */
export function parseInline(src: string): Run[] {
  const runs: Run[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  for (const m of src.matchAll(re)) {
    if (m.index! > last) runs.push({ text: src.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith("**")) runs.push({ text: t.slice(2, -2), bold: true });
    else if (t.startsWith("`")) runs.push({ text: t.slice(1, -1), code: true });
    else runs.push({ text: t.slice(1, -1), italic: true });
    last = m.index! + t.length;
  }
  if (last < src.length) runs.push({ text: src.slice(last) });
  return runs.length ? runs : [{ text: "" }];
}

/** Work done in a later pass because it changes indexes unpredictably. */
export interface PostJob {
  placeholder: string;
  kind: "table" | "pagebreak";
  cells?: string[][];
}

const range = (startIndex: number, endIndex: number) => ({ startIndex, endIndex });

/**
 * Build Docs batchUpdate requests that append blocks at `start` (the index of the document's
 * final, empty paragraph). Tables are emitted as placeholder paragraphs and filled in later passes.
 */
export function buildAppend(blocks: EditBlockT[], start: number) {
  const requests: any[] = [];
  const jobs: PostJob[] = [];
  let idx = start;

  const para = (runs: Run[], named: string, extra?: (s: number, e: number) => void) => {
    const text = runs.map((r) => r.text).join("");
    requests.push({ insertText: { location: { index: idx }, text: text + "\n" } });
    requests.push({
      updateParagraphStyle: {
        range: range(idx, idx + text.length + 1),
        paragraphStyle: { namedStyleType: named },
        fields: "namedStyleType",
      },
    });
    // Inserted text inherits neighbouring character style; reset it, then apply runs.
    requests.push({
      updateTextStyle: {
        range: range(idx, idx + text.length),
        textStyle: { bold: false, italic: false },
        fields: "bold,italic",
      },
    });
    let off = idx;
    for (const r of runs) {
      if (r.text && (r.bold || r.italic || r.code)) {
        const style: any = {};
        const fields: string[] = [];
        if (r.bold) (style.bold = true), fields.push("bold");
        if (r.italic) (style.italic = true), fields.push("italic");
        if (r.code) (style.weightedFontFamily = { fontFamily: "Courier New" }), fields.push("weightedFontFamily");
        requests.push({ updateTextStyle: { range: range(off, off + r.text.length), textStyle: style, fields: fields.join(",") } });
      }
      off += r.text.length;
    }
    extra?.(idx, idx + text.length + 1);
    idx += text.length + 1;
  };

  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        para(parseInline(b.text), `HEADING_${b.level}`);
        break;
      case "paragraph":
        for (const line of b.text.split(/\n{2,}/)) para(parseInline(line.replace(/\n/g, " ")), "NORMAL_TEXT");
        break;
      case "list": {
        const s = idx;
        for (const it of b.items) para(parseInline(it), "NORMAL_TEXT");
        requests.push({
          createParagraphBullets: {
            range: range(s, idx),
            bulletPreset: b.ordered ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE",
          },
        });
        break;
      }
      case "code":
        para([{ text: b.text.replace(/\n/g, "\v"), code: true }], "NORMAL_TEXT");
        break;
      case "pagebreak": {
        const placeholder = `§§JOB${jobs.length}§§`;
        para([{ text: placeholder }], "NORMAL_TEXT");
        jobs.push({ placeholder, kind: "pagebreak" });
        break;
      }
      case "table": {
        const placeholder = `§§JOB${jobs.length}§§`;
        para([{ text: placeholder }], "NORMAL_TEXT");
        jobs.push({ placeholder, kind: "table", cells: [b.columns, ...b.rows.map((r) => b.columns.map((_, i) => r[i] ?? ""))] });
        break;
      }
    }
  }
  return { requests, jobs, endIndex: idx };
}

/** Index of the final empty paragraph: insert point for appending. */
export function appendPoint(doc: any): number {
  const content = doc.body.content;
  return content[content.length - 1].endIndex - 1;
}

/** Find the paragraph containing `needle`; returns its start index. */
export function findText(doc: any, needle: string): { start: number; end: number } | null {
  for (const el of doc.body.content as any[]) {
    for (const e of el.paragraph?.elements ?? []) {
      const i = (e.textRun?.content ?? "").indexOf(needle);
      if (i >= 0) return { start: e.startIndex + i, end: e.startIndex + i + needle.length };
    }
  }
  return null;
}

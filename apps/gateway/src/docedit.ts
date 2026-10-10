import { Terminal, type TerminalT } from "@classroompilot/shared";
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
  Terminal,
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
  kind: "table" | "pagebreak" | "terminal";
  cells?: string[][];
  terminal?: TerminalT;
}

const range = (startIndex: number, endIndex: number) => ({ startIndex, endIndex });

/**
 * Build Docs batchUpdate requests that append blocks at `start` (the index of the document's
 * final, empty paragraph). Tables are emitted as placeholder paragraphs and filled in later passes.
 */
export interface AppendStyle {
  font?: string;
  sizePt?: number;
  /** Line spacing as a percentage; 100 = single. */
  lineSpacingPct?: number;
}

export function buildAppend(blocks: EditBlockT[], start: number, leadingBreak = false, style: AppendStyle = {}) {
  const requests: any[] = [];
  const jobs: PostJob[] = [];
  let idx = start;
  if (leadingBreak) {
    // The last paragraph already has text: start a new paragraph instead of extending it.
    requests.push({ insertText: { location: { index: idx }, text: "\n" } });
    idx += 1;
  }

  const para = (runs: Run[], named: string, extra?: (s: number, e: number) => void) => {
    const text = runs.map((r) => r.text).join("");
    requests.push({ insertText: { location: { index: idx }, text: text + "\n" } });
    const body = named === "NORMAL_TEXT";
    requests.push({
      updateParagraphStyle: {
        range: range(idx, idx + text.length + 1),
        paragraphStyle: { namedStyleType: named, ...(body && style.lineSpacingPct ? { lineSpacing: style.lineSpacingPct } : {}) },
        fields: body && style.lineSpacingPct ? "namedStyleType,lineSpacing" : "namedStyleType",
      },
    });
    // Inserted text inherits neighbouring character style; reset it, then apply runs.
    if (text.length) {
      const reset: any = { bold: false, italic: false };
      const fields = ["bold", "italic"];
      if (style.font) (reset.weightedFontFamily = { fontFamily: style.font }), fields.push("weightedFontFamily");
      if (style.sizePt && body) (reset.fontSize = { magnitude: style.sizePt, unit: "PT" }), fields.push("fontSize");
      requests.push({ updateTextStyle: { range: range(idx, idx + text.length), textStyle: reset, fields: fields.join(",") } });
    }
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
        if (!b.items.length) break;
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
      case "terminal": {
        const placeholder = `§§JOB${jobs.length}§§`;
        para([{ text: placeholder }], "NORMAL_TEXT");
        jobs.push({ placeholder, kind: "terminal", terminal: b });
        para(parseInline(`*Figure: ${b.caption}${b.source === "illustrative" ? " (simulated output)" : ""}*`), "NORMAL_TEXT");
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

/** Insert point for appending (just before the document's final newline), and whether that paragraph has text. */
export function appendPoint(doc: any): { index: number; hasText: boolean } {
  const content = doc.body.content;
  const last = content[content.length - 1];
  const text = (last.paragraph?.elements ?? []).map((e: any) => e.textRun?.content ?? "").join("");
  return { index: last.endIndex - 1, hasText: text.replace(/\n$/, "").length > 0 };
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

// ---------- deletions ----------

export interface DeletionSpec {
  /** Delete everything under a heading, up to the next heading of the same or higher level. */
  sections?: { heading: string; includeHeading?: boolean }[];
  /** Delete from the paragraph containing `from` up to (not including) the next paragraph containing `to`, or to the end. */
  between?: { from: string; to?: string }[];
  /** Delete the whole body. */
  clear?: boolean;
}

export interface PlannedDeletion {
  label: string;
  start: number;
  end: number;
  characters: number;
  preview: string;
}

interface Para {
  start: number;
  end: number;
  text: string;
  level: number | null; // null = not a heading; 0 = title
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function topParagraphs(doc: any): Para[] {
  const out: Para[] = [];
  for (const el of doc.body.content as any[]) {
    if (!el.paragraph) continue;
    const named: string = el.paragraph.paragraphStyle?.namedStyleType ?? "";
    const m = /^HEADING_(\d)/.exec(named);
    out.push({
      start: el.startIndex,
      end: el.endIndex,
      text: (el.paragraph.elements ?? []).map((e: any) => e.textRun?.content ?? "").join("").replace(/\n$/, ""),
      level: m ? Number(m[1]) : named === "TITLE" ? 0 : null,
    });
  }
  return out;
}

/** Work out which index ranges would be removed; pure so it can be previewed before applying. */
export function planDeletions(doc: any, spec: DeletionSpec): { ranges: PlannedDeletion[]; notFound: string[]; notes: string[] } {
  const paras = topParagraphs(doc);
  const content = doc.body.content as any[];
  const docEnd = content[content.length - 1].endIndex - 1; // never delete the final newline
  const textIn = (a: number, b: number) =>
    content
      .filter((el) => el.startIndex >= a && el.endIndex <= b)
      .flatMap((el) => (el.paragraph?.elements ?? []).map((e: any) => e.textRun?.content ?? "").concat(el.table ? ["[table]"] : []))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  const raw: PlannedDeletion[] = [];
  const notFound: string[] = [];
  const notes: string[] = [];
  const add = (label: string, start: number, end: number) => {
    end = Math.min(end, docEnd);
    if (end > start) raw.push({ label, start, end, characters: end - start, preview: textIn(start, end).slice(0, 160) });
  };

  const find = (needle: string, from = 0, headingOnly = false) => {
    const n = norm(needle);
    const pool = paras.slice(from).filter((p) => (!headingOnly || p.level !== null) && p.text.trim());
    const exact = pool.filter((p) => norm(p.text) === n);
    if (exact.length > 1) notes.push(`"${needle}" matches ${exact.length} paragraphs; the first one is used.`);
    return exact[0] ?? pool.find((p) => norm(p.text).startsWith(n)) ?? pool.find((p) => norm(p.text).includes(n));
  };

  for (const s of spec.sections ?? []) {
    const h = find(s.heading, 0, true);
    if (!h) {
      notFound.push(`section "${s.heading}" (no heading with that text)`);
      continue;
    }
    const level = h.level!;
    const next = paras.find((p) => p.start > h.start && p.level !== null && p.level <= level);
    add(`section "${h.text}"`, s.includeHeading === false ? h.end : h.start, next ? next.start : docEnd);
  }
  for (const b of spec.between ?? []) {
    const a = find(b.from);
    if (!a) {
      notFound.push(`start text "${b.from}"`);
      continue;
    }
    let end = docEnd;
    if (b.to) {
      const z = paras.find((p) => p.start > a.start && norm(p.text).includes(norm(b.to!)));
      if (!z) {
        notFound.push(`end text "${b.to}" (after "${b.from}")`);
        continue;
      }
      end = z.start;
    }
    add(`from "${a.text.slice(0, 40)}"${b.to ? ` to "${b.to}"` : " to the end"}`, a.start, end);
  }
  if (spec.clear) add("the whole document body", 1, docEnd);

  // Merge overlapping ranges so deleting twice is harmless.
  raw.sort((x, y) => x.start - y.start || y.end - x.end);
  const ranges: PlannedDeletion[] = [];
  for (const r of raw) {
    const last = ranges[ranges.length - 1];
    if (last && r.start < last.end) {
      if (r.end > last.end) {
        last.end = r.end;
        last.characters = last.end - last.start;
      }
      last.label += ` + ${r.label}`;
    } else ranges.push({ ...r });
  }
  return { ranges, notFound, notes };
}

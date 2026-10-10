import { buildTerminal } from "./terminal.js";
import { appendPoint, buildAppend, findText, planDeletions, type AppendStyle, type DeletionSpec, type EditBlockT } from "./docedit.js";
import { gget, gpost } from "./google.js";

const DOCS = "https://docs.googleapis.com/v1/documents";

export interface ApplyOptions {
  /** Removed first; text deletions use replacement-with-nothing. */
  deletions?: DeletionSpec & { text?: string[] };
  replacements?: { find: string; replace: string }[];
  blocks?: EditBlockT[];
  style?: AppendStyle;
}

/** Apply replacements and append blocks to a Google Doc. Returns counts. */
export async function applyEdits(token: string, docId: string, opts: ApplyOptions, existing?: any) {
  const docUrl = `${DOCS}/${docId}`;
  const batch = (requests: any[]) => gpost<any>(token, `${docUrl}:batchUpdate`, { requests });

  let deleted = 0;
  let current = existing;
  const del = opts.deletions;
  if (del && (del.sections?.length || del.between?.length || del.clear || del.text?.length)) {
    if (del.sections?.length || del.between?.length || del.clear) {
      const doc = current ?? (await gget<any>(token, docUrl));
      const plan = planDeletions(doc, del);
      // Last range first, so earlier indexes stay valid.
      const reqs = [...plan.ranges].sort((a, b) => b.start - a.start).map((r) => ({ deleteContentRange: { range: { startIndex: r.start, endIndex: r.end } } }));
      if (reqs.length) await batch(reqs);
      deleted += plan.ranges.reduce((n, r) => n + r.characters, 0);
    }
    if (del.text?.length) {
      const r = await batch(del.text.map((t) => ({ replaceAllText: { containsText: { text: t, matchCase: true }, replaceText: "" } })));
      deleted += (r.replies ?? []).reduce((n: number, x: any) => n + (x.replaceAllText?.occurrencesChanged ?? 0), 0);
    }
    current = undefined; // positions changed
  }

  let replaced = 0;
  if (opts.replacements?.length) {
    const r = await batch(
      opts.replacements.map((x) => ({ replaceAllText: { containsText: { text: x.find, matchCase: true }, replaceText: x.replace } })),
    );
    replaced = (r.replies ?? []).reduce((n: number, x: any) => n + (x.replaceAllText?.occurrencesChanged ?? 0), 0);
  }

  let jobs: ReturnType<typeof buildAppend>["jobs"] = [];
  if (opts.blocks?.length) {
    const fresh = opts.replacements?.length || !current ? await gget<any>(token, docUrl) : current;
    const ap = appendPoint(fresh);
    const built = buildAppend(opts.blocks, ap.index, ap.hasText, opts.style);
    jobs = built.jobs;
    // Docs rejects very large batches; chunk to stay well under limits.
    for (let i = 0; i < built.requests.length; i += 400) await batch(built.requests.slice(i, i + 400));
  }

  // Second pass: tables and page breaks (reverse order keeps indexes valid).
  let tablesFilled = 0;
  if (jobs.length) {
    const d2 = await gget<any>(token, docUrl);
    const located = jobs
      .map((j) => ({ j, pos: findText(d2, j.placeholder) }))
      .filter((x) => x.pos)
      .sort((x, y) => y.pos!.start - x.pos!.start);
    const second: any[] = [];
    for (const { j, pos } of located) {
      second.push({ deleteContentRange: { range: { startIndex: pos!.start, endIndex: pos!.end } } });
      second.push(
        j.kind === "table"
          ? { insertTable: { location: { index: pos!.start }, rows: j.cells!.length, columns: j.cells![0].length } }
          : j.kind === "terminal"
            ? { insertTable: { location: { index: pos!.start }, rows: 2, columns: 1 } }
            : { insertPageBreak: { location: { index: pos!.start } } },
      );
    }
    if (second.length) await batch(second);

    const tableJobs = located.map((x) => x.j).filter((j) => j.kind === "table" || j.kind === "terminal").reverse(); // document order
    if (tableJobs.length) {
      const d3 = await gget<any>(token, docUrl);
      const newTables = (d3.body.content as any[]).filter((el) => el.table).slice(-tableJobs.length);
      // Each table's requests only touch its own (and later) positions, so apply tables last-to-first.
      const groups: { key: number; reqs: any[] }[] = [];
      newTables.forEach((tbl, ti) => {
        const job = tableJobs[ti];
        groups.push({ key: tbl.startIndex, reqs: job.kind === "terminal" ? terminalRequests(tbl, job.terminal!) : plainTableRequests(tbl, job.cells!, opts.style?.font) });
      });
      groups.sort((x, y) => y.key - x.key);
      const fillReqs = groups.flatMap((g) => g.reqs);
      for (let i = 0; i < fillReqs.length; i += 400) await batch(fillReqs.slice(i, i + 400));
      tablesFilled = newTables.length;
    }
  }
  return { replaced, tablesFilled, deleted };
}

/** Page size, margins and an optional header for a freshly created document. */
export async function styleNewDoc(token: string, docId: string, o: { paper: "A4" | "Letter"; marginCm: number; header?: string }) {
  const pt = (cm: number) => ({ magnitude: Math.round(cm * 28.3465 * 10) / 10, unit: "PT" });
  const size = o.paper === "A4" ? { width: { magnitude: 595.28, unit: "PT" }, height: { magnitude: 841.89, unit: "PT" } } : { width: { magnitude: 612, unit: "PT" }, height: { magnitude: 792, unit: "PT" } };
  const url = `${DOCS}/${docId}:batchUpdate`;
  await gpost(token, url, {
    requests: [
      {
        updateDocumentStyle: {
          documentStyle: { pageSize: size, marginTop: pt(o.marginCm), marginBottom: pt(o.marginCm), marginLeft: pt(o.marginCm), marginRight: pt(o.marginCm) },
          fields: "pageSize,marginTop,marginBottom,marginLeft,marginRight",
        },
      },
    ],
  });
  if (o.header) {
    const r = await gpost<any>(token, url, { requests: [{ createHeader: { type: "DEFAULT" } }] });
    const headerId = r.replies?.[0]?.createHeader?.headerId;
    if (headerId) await gpost(token, url, { requests: [{ insertText: { location: { segmentId: headerId, index: 0 }, text: o.header } }] });
  }
}

function plainTableRequests(tbl: any, cells: string[][], font?: string) {
  const fills: { at: number; text: string; bold: boolean }[] = [];
  tbl.table.tableRows.forEach((row: any, ri: number) =>
    row.tableCells.forEach((cell: any, ci: number) => {
      const text = cells[ri]?.[ci];
      if (text) fills.push({ at: cell.content[0].startIndex, text, bold: ri === 0 });
    }),
  );
  fills.sort((x, y) => y.at - x.at);
  const reqs: any[] = [];
  for (const f of fills) {
    reqs.push({ insertText: { location: { index: f.at }, text: f.text } });
    const ts: any = { bold: f.bold };
    const fields = ["bold"];
    if (font) (ts.weightedFontFamily = { fontFamily: font }), fields.push("weightedFontFamily");
    reqs.push({ updateTextStyle: { range: { startIndex: f.at, endIndex: f.at + f.text.length }, textStyle: ts, fields: fields.join(",") } });
  }
  return reqs;
}

const rgb = (hex: string) => ({
  color: { rgbColor: { red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4), 16) / 255 } },
});

/** A terminal "screenshot" as a two-row dark table: title bar and monospaced body with coloured runs. */
export function terminalRequests(tbl: any, t: import("@classroompilot/shared").TerminalT) {
  const m = buildTerminal(t);
  const th = m.theme;
  const mono = th.chrome === "windows" || th.chrome === "vscode" ? "Consolas" : "Roboto Mono";
  const start = tbl.startIndex;
  const loc = (row: number) => ({ tableCellLocation: { tableStartLocation: { index: start }, rowIndex: row, columnIndex: 0 }, rowSpan: 1, columnSpan: 1 });
  const border = { color: rgb(th.border), width: { magnitude: 0.75, unit: "PT" }, dashStyle: "SOLID" };
  const cellStyle = (bg: string, pad: number) => ({
    backgroundColor: rgb(bg),
    paddingTop: { magnitude: pad, unit: "PT" }, paddingBottom: { magnitude: pad, unit: "PT" },
    paddingLeft: { magnitude: 8, unit: "PT" }, paddingRight: { magnitude: 8, unit: "PT" },
    borderTop: border, borderBottom: border, borderLeft: border, borderRight: border,
  });
  const cellFields = "backgroundColor,paddingTop,paddingBottom,paddingLeft,paddingRight,borderTop,borderBottom,borderLeft,borderRight";
  const reqs: any[] = [
    { updateTableCellStyle: { tableRange: loc(0), tableCellStyle: cellStyle(th.titleBg, 4), fields: cellFields } },
    { updateTableCellStyle: { tableRange: loc(1), tableCellStyle: cellStyle(th.bg, 8), fields: cellFields } },
  ];

  // Body (row 1 first: it has the higher index).
  const body = m.lines.map((l) => l.map((s) => s.t).join("")).join("\n");
  const bodyAt = tbl.table.tableRows[1].tableCells[0].content[0].startIndex;
  if (body) {
    reqs.push({ insertText: { location: { index: bodyAt }, text: body } });
    reqs.push({
      updateTextStyle: {
        range: { startIndex: bodyAt, endIndex: bodyAt + body.length },
        textStyle: { bold: false, italic: false, fontSize: { magnitude: 9, unit: "PT" }, weightedFontFamily: { fontFamily: mono }, foregroundColor: rgb(th.fg) },
        fields: "bold,italic,fontSize,weightedFontFamily,foregroundColor",
      },
    });
    reqs.push({
      updateParagraphStyle: {
        range: { startIndex: bodyAt, endIndex: bodyAt + body.length },
        paragraphStyle: { lineSpacing: 100, spaceAbove: { magnitude: 0, unit: "PT" }, spaceBelow: { magnitude: 0, unit: "PT" }, alignment: "START" },
        fields: "lineSpacing,spaceAbove,spaceBelow,alignment",
      },
    });
    let pos = bodyAt;
    m.lines.forEach((l, i) => {
      for (const seg of l) {
        if (seg.t && (seg.c || seg.b))
          reqs.push({
            updateTextStyle: {
              range: { startIndex: pos, endIndex: pos + seg.t.length },
              textStyle: { ...(seg.c ? { foregroundColor: rgb(seg.c) } : {}), ...(seg.b ? { bold: true } : {}) },
              fields: [seg.c ? "foregroundColor" : "", seg.b ? "bold" : ""].filter(Boolean).join(","),
            },
          });
        pos += seg.t.length;
      }
      if (i < m.lines.length - 1) pos += 1; // newline
    });
  }

  // Title bar
  const title = th.chrome === "vscode" ? "PROBLEMS    OUTPUT    DEBUG CONSOLE    TERMINAL    PORTS" : m.title;
  const titleAt = tbl.table.tableRows[0].tableCells[0].content[0].startIndex;
  if (title) {
    reqs.push({ insertText: { location: { index: titleAt }, text: title } });
    reqs.push({
      updateTextStyle: {
        range: { startIndex: titleAt, endIndex: titleAt + title.length },
        textStyle: { bold: false, fontSize: { magnitude: 8, unit: "PT" }, weightedFontFamily: { fontFamily: "Arial" }, foregroundColor: rgb(th.titleFg) },
        fields: "bold,fontSize,weightedFontFamily,foregroundColor",
      },
    });
    reqs.push({
      updateParagraphStyle: {
        range: { startIndex: titleAt, endIndex: titleAt + title.length },
        paragraphStyle: { alignment: th.chrome === "ubuntu" || th.chrome === "macos" ? "CENTER" : "START", spaceAbove: { magnitude: 0, unit: "PT" }, spaceBelow: { magnitude: 0, unit: "PT" } },
        fields: "alignment,spaceAbove,spaceBelow",
      },
    });
  }
  return reqs;
}

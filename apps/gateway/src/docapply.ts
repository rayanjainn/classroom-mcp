import { appendPoint, buildAppend, findText, type AppendStyle, type EditBlockT } from "./docedit.js";
import { gget, gpost } from "./google.js";

const DOCS = "https://docs.googleapis.com/v1/documents";

export interface ApplyOptions {
  replacements?: { find: string; replace: string }[];
  blocks?: EditBlockT[];
  style?: AppendStyle;
}

/** Apply replacements and append blocks to a Google Doc. Returns counts. */
export async function applyEdits(token: string, docId: string, opts: ApplyOptions, existing?: any) {
  const docUrl = `${DOCS}/${docId}`;
  const batch = (requests: any[]) => gpost<any>(token, `${docUrl}:batchUpdate`, { requests });

  let replaced = 0;
  if (opts.replacements?.length) {
    const r = await batch(
      opts.replacements.map((x) => ({ replaceAllText: { containsText: { text: x.find, matchCase: true }, replaceText: x.replace } })),
    );
    replaced = (r.replies ?? []).reduce((n: number, x: any) => n + (x.replaceAllText?.occurrencesChanged ?? 0), 0);
  }

  let jobs: ReturnType<typeof buildAppend>["jobs"] = [];
  if (opts.blocks?.length) {
    const fresh = opts.replacements?.length || !existing ? await gget<any>(token, docUrl) : existing;
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
          : { insertPageBreak: { location: { index: pos!.start } } },
      );
    }
    if (second.length) await batch(second);

    const tableJobs = jobs.filter((j) => j.kind === "table");
    if (tableJobs.length) {
      const d3 = await gget<any>(token, docUrl);
      const newTables = (d3.body.content as any[]).filter((el) => el.table).slice(-tableJobs.length);
      const fills: { at: number; text: string; bold: boolean }[] = [];
      newTables.forEach((tbl, ti) => {
        const cells = tableJobs[ti].cells!;
        tbl.table.tableRows.forEach((row: any, ri: number) =>
          row.tableCells.forEach((cell: any, ci: number) => {
            const text = cells[ri]?.[ci];
            if (text) fills.push({ at: cell.content[0].startIndex, text, bold: ri === 0 });
          }),
        );
      });
      fills.sort((x, y) => y.at - x.at);
      const fillReqs: any[] = [];
      for (const f of fills) {
        fillReqs.push({ insertText: { location: { index: f.at }, text: f.text } });
        const ts: any = { bold: f.bold };
        const fields = ["bold"];
        if (opts.style?.font) (ts.weightedFontFamily = { fontFamily: opts.style.font }), fields.push("weightedFontFamily");
        fillReqs.push({ updateTextStyle: { range: { startIndex: f.at, endIndex: f.at + f.text.length }, textStyle: ts, fields: fields.join(",") } });
      }
      for (let i = 0; i < fillReqs.length; i += 400) await batch(fillReqs.slice(i, i + 400));
      tablesFilled = newTables.length;
    }
  }
  return { replaced, tablesFilled };
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

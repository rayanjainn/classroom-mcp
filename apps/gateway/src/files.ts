import { GoogleError, gget } from "./google.js";

const MAX_CHARS = 60_000;

function docText(doc: any): string {
  const out: string[] = [];
  const walk = (content: any[] = []) => {
    for (const el of content) {
      if (el.paragraph) {
        const style: string = el.paragraph.paragraphStyle?.namedStyleType ?? "";
        const text = (el.paragraph.elements ?? []).map((e: any) => e.textRun?.content ?? "").join("").replace(/\n$/, "");
        if (!text.trim()) continue;
        const m = /^HEADING_(\d)/.exec(style);
        const bullet = el.paragraph.bullet ? "- " : "";
        out.push(m ? `${"#".repeat(Number(m[1]))} ${text}` : style === "TITLE" ? `# ${text}` : bullet + text);
      } else if (el.table) {
        for (const row of el.table.tableRows ?? []) {
          const cells = (row.tableCells ?? []).map((c: any) => {
            const t: string[] = [];
            for (const ce of c.content ?? [])
              for (const e of ce.paragraph?.elements ?? []) t.push(e.textRun?.content ?? "");
            return t.join("").replace(/\s+/g, " ").trim();
          });
          out.push(`| ${cells.join(" | ")} |`);
        }
      }
    }
  };
  walk(doc.body?.content);
  return out.join("\n");
}

function slidesText(p: any): string {
  return (p.slides ?? [])
    .map((s: any, i: number) => {
      const parts: string[] = [];
      for (const pe of s.pageElements ?? [])
        for (const te of pe.shape?.text?.textElements ?? []) if (te.textRun?.content) parts.push(te.textRun.content.trim());
      return `## Slide ${i + 1}\n${parts.filter(Boolean).join("\n")}`;
    })
    .join("\n\n");
}

function truncate(text: string) {
  return text.length > MAX_CHARS
    ? { text: text.slice(0, MAX_CHARS), truncated: true, totalChars: text.length }
    : { text, truncated: false, totalChars: text.length };
}

const notThisType = (e: unknown) => e instanceof GoogleError && (e.status === 400 || e.status === 404);

export type ReadResult =
  | { ok: true; type: "doc" | "slides" | "sheet"; title?: string; text: string; truncated: boolean; totalChars: number }
  | { ok: false; reason: string; fix: string };

/** Read a Google Doc, Slides deck or Sheet by file id, trying each API in turn. */
export async function readGoogleFile(token: string, fileId: string): Promise<ReadResult> {
  let denied = false;
  try {
    const d = await gget<any>(token, `https://docs.googleapis.com/v1/documents/${fileId}`);
    return { ok: true, type: "doc", title: d.title, ...truncate(docText(d)) };
  } catch (e) {
    if (e instanceof GoogleError && e.status === 403) denied = true;
    else if (!notThisType(e)) throw e;
  }
  try {
    const p = await gget<any>(token, `https://slides.googleapis.com/v1/presentations/${fileId}`);
    return { ok: true, type: "slides", title: p.title, ...truncate(slidesText(p)) };
  } catch (e) {
    if (e instanceof GoogleError && e.status === 403) denied = true;
    else if (!notThisType(e)) throw e;
  }
  try {
    const s = await gget<any>(token, `https://sheets.googleapis.com/v4/spreadsheets/${fileId}`, {
      fields: "properties.title,sheets.properties(title,gridProperties)",
    });
    const parts: string[] = [];
    for (const sh of (s.sheets ?? []).slice(0, 5)) {
      const name = sh.properties.title;
      const v = await gget<{ values?: string[][] }>(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${encodeURIComponent(`'${name}'!A1:Z200`)}`,
      );
      parts.push(`## ${name}\n` + (v.values ?? []).map((r) => r.join("\t")).join("\n"));
    }
    return { ok: true, type: "sheet", title: s.properties?.title, ...truncate(parts.join("\n\n")) };
  } catch (e) {
    if (e instanceof GoogleError && e.status === 403) denied = true;
    else if (!notThisType(e)) throw e;
  }
  return denied
    ? {
        ok: false,
        reason: "No access to this file (403). The owner has not shared it with the student, or a needed scope was not granted.",
        fix: "Ask the student to open the file in Classroom and confirm they can view it; if it is theirs, reconnect to grant the new read scopes.",
      }
    : {
        ok: false,
        reason: "Not a Google Doc, Slides deck or Sheet (probably a PDF, Word file or image), so it cannot be read through Google's document APIs.",
        fix: "Ask the student to paste the text or upload the file to the chat. Direct PDF/Word reading is planned.",
      };
}

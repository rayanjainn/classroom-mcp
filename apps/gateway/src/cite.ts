import type { BibEntryT, DocSpecT } from "@classroompilot/shared";

type Style = DocSpecT["meta"]["citationStyle"];

const surname = (author?: string) => {
  if (!author) return "Anon.";
  const first = author.split(/;| and |&/)[0].trim();
  const s = first.includes(",") ? first.split(",")[0] : first.split(/\s+/).slice(-1)[0];
  const many = /;| and |&/.test(author);
  return `${s || "Anon."}${many ? " et al." : ""}`;
};

/** Order of first citation in the document: [@a] [@a; @b] */
export function citedKeys(texts: string[]): string[] {
  const seen: string[] = [];
  for (const t of texts)
    for (const m of t.matchAll(/\[@([^\]\n]+)\]/g))
      for (const k of m[1].split(/[;,]/).map((x) => x.replace(/^\s*@?/, "").trim()).filter(Boolean)) if (!seen.includes(k)) seen.push(k);
  return seen;
}

export function inText(keys: string[], bib: Map<string, BibEntryT>, order: string[], style: Style): string {
  const parts = keys.map((k) => {
    const e = bib.get(k);
    if (!e) return "?";
    switch (style) {
      case "ieee":
        return String(order.indexOf(k) + 1);
      case "mla":
        return surname(e.author);
      default:
        return `${surname(e.author)}, ${e.year ?? "n.d."}`;
    }
  });
  return style === "ieee" ? `[${parts.join(", ")}]` : `(${parts.join("; ")})`;
}

/** Bibliography entry as markdown-ish text (*italic*) for the inline renderer. */
export function formatEntry(e: BibEntryT, style: Style): string {
  const a = e.author?.trim();
  const y = e.year ?? "n.d.";
  const url = e.url ? ` ${e.url}` : "";
  const venue = e.venue ? `*${e.venue}*` : "";
  const pub = e.publisher ? e.publisher : "";
  const j = (xs: (string | undefined)[], sep: string) => xs.filter(Boolean).join(sep);
  switch (style) {
    case "ieee":
      if (e.type === "book") return `${j([a, `*${e.title}*`], ", ")}. ${j([pub, String(y)], ", ")}.`;
      if (e.type === "web") return `${j([a, `"${e.title},"`], ", ")} ${venue ? venue + ". " : ""}[Online]. Available:${url}`;
      return `${j([a, `"${e.title},"`], ", ")} ${j([venue, pub, String(y)], ", ")}.${url}`;
    case "apa":
      if (e.type === "book") return `${j([a ? `${a} (${y}).` : `(${y}).`, `*${e.title}*.`, pub ? pub + "." : ""], " ")}`;
      return `${j([a ? `${a} (${y}).` : `(${y}).`, `${e.title}.`, venue ? venue + "." : "", pub ? pub + "." : ""], " ")}${url}`;
    case "mla":
      if (e.type === "book") return `${j([a ? a + "." : "", `*${e.title}*.`, j([pub, String(y)], ", ") + "."], " ")}`;
      return `${j([a ? a + "." : "", `"${e.title}."`, j([venue, pub, String(y)], ", ") + "."], " ")}${url}`;
    case "harvard":
      return `${j([a ? `${a} (${y})` : `(${y})`, e.type === "book" ? `*${e.title}*.` : `'${e.title}',`, venue ? venue + "," : "", pub ? pub + "." : ""], " ")}${e.url ? ` Available at: ${e.url}` : ""}`;
  }
}

/** Entries in print order: IEEE by first citation, others alphabetical. Uncited entries are included last. */
export function orderBibliography(bib: BibEntryT[], cited: string[], style: Style): BibEntryT[] {
  if (style === "ieee") {
    const byKey = new Map(bib.map((b) => [b.key, b]));
    const ordered = cited.map((k) => byKey.get(k)).filter(Boolean) as BibEntryT[];
    return [...ordered, ...bib.filter((b) => !cited.includes(b.key))];
  }
  return [...bib].sort((x, y) => (x.author ?? x.title).localeCompare(y.author ?? y.title));
}

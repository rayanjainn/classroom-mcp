export interface Requirement {
  kind: "pages" | "words" | "format" | "citation" | "naming" | "deadline" | "other";
  text: string;
  /** Structured limit when one can be parsed */
  min?: number;
  max?: number;
  value?: string;
  source: string;
}

const sentences = (t: string) =>
  t
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+|\s[•\-]\s/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);

const num = (s: string) => Number(s.replace(/,/g, ""));

/** Deterministic pass over instruction text. The AI refines and confirms ambiguities with the student. */
export function extractRequirements(text: string, source: string): Requirement[] {
  const out: Requirement[] = [];
  const add = (r: Omit<Requirement, "source">) => out.push({ ...r, source });
  for (const s of sentences(text)) {
    let matched = false;
    let m: RegExpExecArray | null;

    if ((m = /(\d[\d,]*)\s*(?:-|–|to)\s*(\d[\d,]*)\s*pages?/i.exec(s))) (add({ kind: "pages", text: s, min: num(m[1]), max: num(m[2]) }), (matched = true));
    else if ((m = /(?:max(?:imum)?(?:\s+of)?|up to|no more than|not (?:more than|exceed(?:ing)?)|at most|limit(?:ed)? to|within|under)\s*(\d[\d,]*)\s*pages?/i.exec(s)) || (m = /(\d[\d,]*)\s*pages?\s*(?:max(?:imum)?|limit|at most)/i.exec(s)))
      (add({ kind: "pages", text: s, max: num(m[1]) }), (matched = true));
    else if ((m = /(?:min(?:imum)?(?:\s+of)?|at least)\s*(\d[\d,]*)\s*pages?/i.exec(s))) (add({ kind: "pages", text: s, min: num(m[1]) }), (matched = true));

    if ((m = /(\d[\d,]*)\s*(?:-|–|to)\s*(\d[\d,]*)\s*words?/i.exec(s))) (add({ kind: "words", text: s, min: num(m[1]), max: num(m[2]) }), (matched = true));
    else if ((m = /(?:max(?:imum)?(?:\s+of)?|up to|no more than|not (?:more than|exceed(?:ing)?)|at most|limit(?:ed)? to|within|under)\s*(\d[\d,]*)\s*words?/i.exec(s)))
      (add({ kind: "words", text: s, max: num(m[1]) }), (matched = true));
    else if ((m = /(?:min(?:imum)?(?:\s+of)?|at least)\s*(\d[\d,]*)\s*words?/i.exec(s))) (add({ kind: "words", text: s, min: num(m[1]) }), (matched = true));
    else if ((m = /\b(\d[\d,]*)\s*words?\b/i.exec(s)) && /\b(about|around|approx|approximately|roughly|essay|write)\b/i.test(s)) (add({ kind: "words", text: s, min: Math.round(num(m[1]) * 0.9), max: Math.round(num(m[1]) * 1.1) }), (matched = true));

    if ((m = /(?:submit|upload|turn in|hand in|save)[^.]*?\b(?:as|in)\s+(?:a\s+|an\s+)?(pdf|docx?|word|google doc|google docs|pptx?|powerpoint|slides|zip|txt)\b/i.exec(s)) || (m = /\b(pdf|docx|word document|google doc)\s+(?:format|only|file)\b/i.exec(s)))
      (add({ kind: "format", text: s, value: m[1].toLowerCase() }), (matched = true));

    if ((m = /\b(APA|MLA|IEEE|Harvard|Chicago|Vancouver)\b/.exec(s)) && /cit|refer|bibliograph|style|format/i.test(s)) (add({ kind: "citation", text: s, value: m[1].toLowerCase() }), (matched = true));

    if (/\b(file ?name|name (?:the|your) (?:file|document)|rename|naming (?:convention|format))\b/i.test(s)) (add({ kind: "naming", text: s }), (matched = true));

    if (/\b(deadline|due date|extended|extension|postponed|rescheduled|no later than|preponed)\b/i.test(s) && /\b(extended|extension|postponed|rescheduled|moved|changed|new deadline|preponed)\b/i.test(s))
      (add({ kind: "deadline", text: s }), (matched = true));

    if (!matched && s.length < 300 && /\b(must|should|required|requirement|ensure|make sure|do not|don't|include|mandatory|compulsory|need to|have to)\b/i.test(s)) add({ kind: "other", text: s });
  }
  return out;
}

/** Plain-text statistics of a draft. */
export function draftStats(text: string, headings: string[] = []) {
  const words = text.split(/\s+/).filter(Boolean).length;
  const lower = text.toLowerCase();
  return {
    words,
    estimatedPages: Math.max(1, Math.round((words / 450) * 10) / 10),
    headings,
    hasReferencesSection: /\b(references|bibliography|works cited)\b/.test(lower),
    hasInTextCitations: /\[\d+(?:,\s*\d+)*\]|\([A-Z][A-Za-z-]+(?: et al\.)?,?\s*(?:\d{4}|n\.d\.)\)/.test(text),
    hasPlaceholders: /\[[^\]\n]{2,40}\]|\{\{[^}]+\}\}|_{4,}/.test(text),
  };
}

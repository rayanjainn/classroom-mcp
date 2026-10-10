import type { UiT } from "@classroompilot/shared";

type El = UiT["content"][number];

const n = (x: number) => (Math.round(x * 100) / 100).toString();

interface Pal {
  page: string; window: string; chrome: string; chromeFg: string; border: string; text: string; muted: string;
  primary: string; primaryFg: string; field: string; sidebar: string; sidebarActive: string; tableHead: string;
  codeBg: string; codeFg: string; info: string; success: string; warning: string; error: string;
}
const LIGHT: Pal = { page: "FFFFFF", window: "FFFFFF", chrome: "DEE1E6", chromeFg: "3C4043", border: "DADCE0", text: "202124", muted: "5F6368", primary: "1A73E8", primaryFg: "FFFFFF", field: "FFFFFF", sidebar: "F1F3F4", sidebarActive: "D2E3FC", tableHead: "F1F3F4", codeBg: "F6F8FA", codeFg: "24292F", info: "1A73E8", success: "188038", warning: "E37400", error: "D93025" };
const DARK: Pal = { page: "202124", window: "202124", chrome: "35363A", chromeFg: "E8EAED", border: "3C4043", text: "E8EAED", muted: "9AA0A6", primary: "8AB4F8", primaryFg: "202124", field: "292A2D", sidebar: "292A2D", sidebarActive: "394457", tableHead: "2D2E31", codeBg: "171717", codeFg: "E8EAED", info: "8AB4F8", success: "81C995", warning: "FDD663", error: "F28B82" };

class Colors {
  used = new Set<string>();
  name(hex: string) {
    this.used.add(hex);
    return `ui${hex}`;
  }
  defs() {
    return [...this.used].map((h) => `\\definecolor{ui${h}}{HTML}{${h}}`).join("\n");
  }
}

const wrapCount = (text: string, width: number, charW: number) => Math.max(1, Math.ceil((text.length * charW) / width));

/** A web page / app window drawn in TikZ with simple flow layout. */
export function uiFigure(b: UiT, deps: { esc: (s: string) => string; caption: string }): { tex: string; warnings: string[] } {
  const P = b.theme === "dark" ? DARK : LIGHT;
  const col = new Colors();
  const esc = deps.esc;
  const W = 470;
  const warnings: string[] = [];
  const out: string[] = [];
  const c = (h: string) => col.name(h);

  const tabH = b.kind === "browser" ? 26 : 26;
  const toolH = b.kind === "browser" ? 30 : b.menu?.length ? 22 : 0;
  const chromeH = tabH + toolH;
  const sideW = b.sidebar?.length ? 112 : 0;
  const pad = 16;
  const contentW = W - sideW - 2 * pad;
  const x0 = sideW + pad;

  const node = (x: number, y: number, text: string, opts: string, width?: number) =>
    `\\node[anchor=north west, inner sep=0pt, ${width ? `text width=${n(width)}pt, ` : ""}${opts}] at (${n(x)},${n(-y)}) {${text}};`;
  const sf = (size: number, color: string, bold = false) => `font=\\sffamily${bold ? "\\bfseries" : ""}\\fontsize{${size}}{${n(size * 1.25)}}\\selectfont, text=${c(color)}`;

  // ----- content flow -----
  let y = chromeH + pad;
  const body: string[] = [];
  const add = (e: El) => {
    switch (e.t) {
      case "heading":
        body.push(node(x0, y, esc(e.text), sf(15, P.text, true), contentW));
        y += 26;
        break;
      case "text": {
        const lines = wrapCount(e.text, contentW, 4.9);
        body.push(node(x0, y, esc(e.text), sf(9.5, P.text), contentW));
        y += lines * 12.5 + 8;
        break;
      }
      case "button":
      case "buttons": {
        const labels = e.t === "button" ? [e.text] : e.labels;
        const primary = e.t === "button" ? (e.primary ?? true) : undefined;
        let x = x0;
        labels.forEach((l, i) => {
          const w = Math.max(64, l.length * 6.2 + 28);
          const isPrimary = e.t === "button" ? primary : i === (e.primary ?? 0);
          body.push(`\\fill[${c(isPrimary ? P.primary : P.window)}, rounded corners=4pt] (${n(x)},${n(-y)}) rectangle (${n(x + w)},${n(-(y + 24))});`);
          if (!isPrimary) body.push(`\\draw[${c(P.border)}, rounded corners=4pt, line width=0.6pt] (${n(x)},${n(-y)}) rectangle (${n(x + w)},${n(-(y + 24))});`);
          body.push(`\\node[inner sep=0pt, ${sf(9, isPrimary ? P.primaryFg : P.primary, true)}] at (${n(x + w / 2)},${n(-(y + 12))}) {${esc(l)}};`);
          x += w + 8;
        });
        y += 34;
        break;
      }
      case "input": {
        body.push(node(x0, y, esc(e.label), sf(8.5, P.muted), contentW));
        const w = Math.min(contentW, 300);
        body.push(`\\fill[${c(P.field)}, rounded corners=3pt] (${n(x0)},${n(-(y + 14))}) rectangle (${n(x0 + w)},${n(-(y + 38))});`);
        body.push(`\\draw[${c(P.border)}, rounded corners=3pt, line width=0.7pt] (${n(x0)},${n(-(y + 14))}) rectangle (${n(x0 + w)},${n(-(y + 38))});`);
        const shown = e.value ?? e.placeholder ?? "";
        if (shown) body.push(`\\node[anchor=west, inner sep=0pt, ${sf(9.5, e.value ? P.text : P.muted)}] at (${n(x0 + 8)},${n(-(y + 26))}) {${esc(shown)}};`);
        y += 48;
        break;
      }
      case "table": {
        const rows = [e.columns, ...e.rows.map((r) => e.columns.map((_, i) => r[i] ?? ""))];
        // Column widths follow content length (min 6 chars) so long cells get the room.
        const weights = e.columns.map((_, ci) => Math.max(6, ...rows.map((r) => Math.min(40, r[ci].length))));
        const total = weights.reduce((p, q) => p + q, 0);
        const widths = weights.map((w) => (w / total) * contentW);
        const xs = widths.map((_, i) => x0 + widths.slice(0, i).reduce((p, q) => p + q, 0));
        body.push(`\\fill[${c(P.tableHead)}] (${n(x0)},${n(-y)}) rectangle (${n(x0 + contentW)},${n(-(y + 22))});`);
        rows.forEach((r, ri) => {
          r.forEach((cell, ci) => {
            const maxChars = Math.floor((widths[ci] - 10) / 4.4);
            const txt = cell.length > maxChars ? cell.slice(0, Math.max(1, maxChars - 1)) + "\u2026" : cell;
            body.push(`\\node[anchor=west, inner sep=0pt, ${sf(8.5, P.text, ri === 0)}] at (${n(xs[ci] + 6)},${n(-(y + ri * 22 + 11))}) {${esc(txt)}};`);
          });
          body.push(`\\draw[${c(P.border)}, line width=0.5pt] (${n(x0)},${n(-(y + (ri + 1) * 22))}) -- (${n(x0 + contentW)},${n(-(y + (ri + 1) * 22))});`);
        });
        y += rows.length * 22 + 12;
        break;
      }
      case "list": {
        e.items.forEach((it, i) => body.push(node(x0, y + i * 16, `\\textbullet\\ \\ ${esc(it)}`, sf(9.5, P.text), contentW)));
        y += e.items.length * 16 + 8;
        break;
      }
      case "code": {
        const ls = e.text.split("\n");
        const h = ls.length * 11.5 + 12;
        body.push(`\\fill[${c(P.codeBg)}, rounded corners=3pt] (${n(x0)},${n(-y)}) rectangle (${n(x0 + contentW)},${n(-(y + h))});`);
        ls.forEach((l, i) => body.push(`\\node[anchor=base west, inner sep=0pt, font=\\ttfamily\\fontsize{8}{10}\\selectfont, text=${c(P.codeFg)}] at (${n(x0 + 8)},${n(-(y + 6 + (i + 0.8) * 11.5))}) {${esc(l).replace(/ /g, "~") || "\\strut"}};`));
        y += h + 10;
        break;
      }
      case "alert": {
        const tone = P[e.tone];
        const lines = wrapCount(e.text, contentW - 24, 4.9);
        const h = lines * 12.5 + 14;
        body.push(`\\fill[${c(tone)}, opacity=0.14] (${n(x0)},${n(-y)}) rectangle (${n(x0 + contentW)},${n(-(y + h))});`);
        body.push(`\\fill[${c(tone)}] (${n(x0)},${n(-y)}) rectangle (${n(x0 + 3)},${n(-(y + h))});`);
        body.push(node(x0 + 12, y + 7, esc(e.text), sf(9, P.text), contentW - 24));
        y += h + 10;
        break;
      }
    }
  };
  for (const e of b.content) add(e);
  const H = Math.max(y + pad, chromeH + 120);
  if (H > 560) warnings.push("A UI mockup is very tall; consider fewer elements.");

  // ----- window frame -----
  out.push(`\\begin{scope}\n\\clip[rounded corners=7pt] (0,0) rectangle (${W},${n(-H)});`);
  out.push(`\\fill[${c(P.window)}] (0,0) rectangle (${W},${n(-H)});`);
  out.push(`\\fill[${c(P.chrome)}] (0,0) rectangle (${W},${n(-tabH)});`);
  if (b.kind === "browser") {
    // active tab
    out.push(`\\fill[${c(P.window)}, rounded corners=6pt] (70,${n(-6)}) rectangle (240,${n(-tabH - 6)});`);
    out.push(`\\node[anchor=west, inner sep=0pt, text width=150pt, ${sf(8, P.chromeFg)}] at (82,${n(-tabH / 2 - 2)}) {${esc(b.title)}};`);
    ["FF5F57", "FEBC2E", "28C840"].forEach((h, i) => out.push(`\\fill[${c(h)}] (${12 + i * 17},${n(-tabH / 2)}) circle (4.6pt);`));
    out.push(`\\fill[${c(P.window)}] (0,${n(-tabH)}) rectangle (${W},${n(-chromeH)});`);
    out.push(`\\draw[${c(P.border)}, line width=0.6pt] (0,${n(-chromeH)}) -- (${W},${n(-chromeH)});`);
    // nav arrows + url pill
    out.push(`\\draw[${c(P.muted)}, line width=0.9pt] (20,${n(-tabH - 15)}) -- (14,${n(-tabH - 15)}) -- (17,${n(-tabH - 12)}) (14,${n(-tabH - 15)}) -- (17,${n(-tabH - 18)});`);
    out.push(`\\draw[${c(P.muted)}, line width=0.9pt] (36,${n(-tabH - 15)}) -- (42,${n(-tabH - 15)}) -- (39,${n(-tabH - 12)}) (42,${n(-tabH - 15)}) -- (39,${n(-tabH - 18)});`);
    out.push(`\\draw[${c(P.muted)}, line width=0.9pt] (64,${n(-tabH - 15)}) circle (4pt);`);
    out.push(`\\fill[${c(P.chrome)}, rounded corners=9pt] (80,${n(-tabH - 5)}) rectangle (${W - 14},${n(-tabH - 25)});`);
    out.push(`\\node[anchor=west, inner sep=0pt, ${sf(8.5, P.chromeFg)}] at (94,${n(-tabH - 15)}) {${esc(b.url ?? "")}};`);
  } else {
    out.push(`\\node[inner sep=0pt, ${sf(8.5, P.chromeFg)}] at (${W / 2},${n(-tabH / 2)}) {${esc(b.title)}};`);
    ["FF5F57", "FEBC2E", "28C840"].forEach((h, i) => out.push(`\\fill[${c(h)}] (${12 + i * 17},${n(-tabH / 2)}) circle (4.6pt);`));
    if (toolH) {
      out.push(`\\fill[${c(P.window)}] (0,${n(-tabH)}) rectangle (${W},${n(-chromeH)});`);
      out.push(`\\draw[${c(P.border)}, line width=0.6pt] (0,${n(-chromeH)}) -- (${W},${n(-chromeH)});`);
      let x = 12;
      for (const m of b.menu ?? []) {
        out.push(`\\node[anchor=west, inner sep=0pt, ${sf(8.5, P.text)}] at (${n(x)},${n(-(tabH + toolH / 2))}) {${esc(m)}};`);
        x += m.length * 5.2 + 18;
      }
    }
  }
  if (sideW) {
    out.push(`\\fill[${c(P.sidebar)}] (0,${n(-chromeH)}) rectangle (${sideW},${n(-H)});`);
    (b.sidebar ?? []).forEach((it, i) => {
      const top = chromeH + 10 + i * 26;
      if (i === (b.activeSidebar ?? 0)) out.push(`\\fill[${c(P.sidebarActive)}, rounded corners=4pt] (8,${n(-top)}) rectangle (${sideW - 8},${n(-(top + 22))});`);
      out.push(`\\node[anchor=west, inner sep=0pt, ${sf(9, P.text, i === (b.activeSidebar ?? 0))}] at (16,${n(-(top + 11))}) {${esc(it)}};`);
    });
    out.push(`\\draw[${c(P.border)}, line width=0.5pt] (${sideW},${n(-chromeH)}) -- (${sideW},${n(-H)});`);
  }
  out.push(...body);
  out.push("\\end{scope}");
  out.push(`\\draw[${c(P.border)}, rounded corners=7pt, line width=0.7pt] (0,0) rectangle (${W},${n(-H)});`);

  const tex = `\\begin{figure}[htbp]
\\centering
% alt: ${b.alt.replace(/[\r\n]+/g, " ")}
\\begin{adjustbox}{max width=\\linewidth}
\\begin{tikzpicture}[x=1pt,y=1pt]
${col.defs()}
${out.join("\n")}
\\end{tikzpicture}
\\end{adjustbox}
\\caption{${deps.caption}}
\\end{figure}
`;
  return { tex, warnings };
}

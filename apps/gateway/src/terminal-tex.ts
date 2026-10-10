import type { TerminalT } from "@classroompilot/shared";
import { buildTerminal, type Line, type TerminalModel } from "./terminal.js";

const FS = 9;
const LH = 11.6;
const PADX = 9;
const PADY = 7;

const n = (x: number) => (Math.round(x * 100) / 100).toString();

function segTex(line: Line, esc: (s: string) => string): string {
  if (!line.length || line.every((s) => !s.t)) return "\\strut";
  return line
    .filter((s) => s.t)
    .map((s) => {
      let t = esc(s.t).replace(/ /g, "~");
      if (s.b) t = `\\textbf{${t}}`;
      return s.c ? `\\textcolor[HTML]{${s.c}}{${t}}` : t;
    })
    .join("");
}

/** Named colours are defined once per figure: TikZ keys cannot take inline rgb specs without braces. */
class Colors {
  used = new Set<string>();
  name(hex: string) {
    this.used.add(hex);
    return `cp${hex}`;
  }
  defs() {
    return [...this.used].map((h) => `\\definecolor{cp${h}}{HTML}{${h}}`).join("\n");
  }
}

function chromeTex(m: TerminalModel, W: number, tb: number, col: Colors): string {
  const th = m.theme;
  const out: string[] = [];
  const title = (x: number, anchor: string, color = th.titleFg) =>
    m.title ? `\\node[anchor=${anchor}, inner sep=0pt, font=\\sffamily\\fontsize{8.5}{10}\\selectfont, text=${col.name(color)}] at (${n(x)},${n(-tb / 2)}) {TITLE};` : "";
  switch (th.chrome) {
    case "ubuntu":
      out.push(title(W / 2, "center"));
      [W - 14, W - 34, W - 54].forEach((x, i) => {
        out.push(`\\fill[${col.name(i === 2 ? "E95420" : "474747")}] (${n(x)},${n(-tb / 2)}) circle (6.2pt);`);
        const cy = -tb / 2;
        if (i === 2) out.push(`\\draw[white, line width=0.9pt] (${n(x - 2.4)},${n(cy - 2.4)}) -- (${n(x + 2.4)},${n(cy + 2.4)}) (${n(x - 2.4)},${n(cy + 2.4)}) -- (${n(x + 2.4)},${n(cy - 2.4)});`);
        else if (i === 1) out.push(`\\draw[white, line width=0.8pt] (${n(x - 2.4)},${n(cy - 2.4)}) rectangle (${n(x + 2.4)},${n(cy + 2.4)});`);
        else out.push(`\\draw[white, line width=0.9pt] (${n(x - 2.6)},${n(cy - 0.5)}) -- (${n(x + 2.6)},${n(cy - 0.5)});`);
      });
      break;
    case "macos":
      [["FF5F57", 14], ["FEBC2E", 34], ["28C840", 54]].forEach(([c, x]) => out.push(`\\fill[${col.name(c as string)}] (${x},${n(-tb / 2)}) circle (5.4pt);`));
      out.push(title(W / 2, "center"));
      break;
    case "windows": {
      out.push(`\\fill[${col.name("0078D4")}] (9,${n(-tb / 2 + 4)}) rectangle (17,${n(-tb / 2 - 4)});`);
      out.push(title(26, "west"));
      const cy = -tb / 2;
      out.push(`\\draw[black, line width=0.6pt] (${n(W - 112)},${n(cy)}) -- (${n(W - 104)},${n(cy)});`);
      out.push(`\\draw[black, line width=0.6pt] (${n(W - 76)},${n(cy - 4)}) rectangle (${n(W - 68)},${n(cy + 4)});`);
      out.push(`\\draw[black, line width=0.6pt] (${n(W - 34)},${n(cy - 4)}) -- (${n(W - 26)},${n(cy + 4)}) (${n(W - 34)},${n(cy + 4)}) -- (${n(W - 26)},${n(cy - 4)});`);
      break;
    }
    case "vscode": {
      const tabs = ["PROBLEMS", "OUTPUT", "DEBUG CONSOLE", "TERMINAL", "PORTS"];
      let x = 12;
      for (const t of tabs) {
        const w = t.length * 5.1;
        const active = t === "TERMINAL";
        out.push(`\\node[anchor=west, inner sep=0pt, font=\\sffamily\\fontsize{7.5}{9}\\selectfont, text=${col.name(active ? "FFFFFF" : "969696")}] at (${n(x)},${n(-tb / 2)}) {${t}};`);
        if (active) out.push(`\\draw[${col.name("0078D4")}, line width=1pt] (${n(x)},${n(-tb + 1)}) -- (${n(x + w)},${n(-tb + 1)});`);
        x += w + 16;
      }
      out.push(`\\node[anchor=east, inner sep=0pt, font=\\sffamily\\fontsize{7.5}{9}\\selectfont, text=${col.name("969696")}] at (${n(W - 10)},${n(-tb / 2)}) {powershell \\ \\ +};`);
      out.push(`\\draw[${col.name("3C3C3C")}, line width=0.4pt] (0,${n(-tb)}) -- (${n(W)},${n(-tb)});`);
      break;
    }
  }
  return out.filter(Boolean).join("\n");
}

/** A terminal "screenshot" drawn in TikZ: no image files needed. */
export function terminalFigure(
  b: TerminalT,
  deps: { esc: (s: string) => string; caption: string; mono: boolean },
): { tex: string; warnings: string[] } {
  const m = buildTerminal(b);
  const th = m.theme;
  const cw = FS * (deps.mono ? 0.525 : 0.602);
  const W = m.columns * cw + 2 * PADX;
  const tb = th.chrome === "vscode" ? 26 : th.chrome === "windows" ? 26 : 24;
  const bodyH = m.lines.length * LH + 2 * PADY;
  const H = tb + bodyH;
  const warnings: string[] = [];
  if (m.lines.length > 38) warnings.push(`A terminal figure has ${m.lines.length} lines; very tall figures may not fit on a page. Consider splitting it.`);

  const col = new Colors();
  for (const h of [th.bg, th.titleBg, th.border, th.fg]) col.name(h);
  const lines = m.lines
    .map((l, i) => `\\node[anchor=base west, inner sep=0pt, text=${col.name(th.fg)}] at (${n(PADX)},${n(-(tb + PADY + i * LH + LH * 0.78))}) {${segTex(l, deps.esc)}};`)
    .join("\n");
  let cursor = "";
  if (m.cursorAt !== undefined) {
    const i = m.lines.length - 1;
    const x = PADX + m.cursorAt * cw;
    const top = -(tb + PADY + i * LH) - 1;
    cursor = `\\fill[${col.name(th.fg)}, opacity=0.75] (${n(x)},${n(top)}) rectangle (${n(x + cw)},${n(top - LH + 2)});`;
  }
  const chrome = chromeTex(m, W, tb, col).replace("TITLE", deps.esc(m.title));
  const caption = deps.caption;
  const tex = `\\begin{figure}[htbp]
\\centering
% alt: ${b.alt.replace(/[\r\n]+/g, " ")}
\\begin{adjustbox}{max width=\\linewidth}
\\begin{tikzpicture}[x=1pt,y=1pt,font=\\fontsize{${FS}}{${LH}}\\selectfont\\ttfamily]
${col.defs()}
\\begin{scope}
\\clip[rounded corners=6pt] (0,0) rectangle (${n(W)},${n(-H)});
\\fill[${col.name(th.bg)}] (0,0) rectangle (${n(W)},${n(-H)});
\\fill[${col.name(th.titleBg)}] (0,0) rectangle (${n(W)},${n(-tb)});
\\end{scope}
${chrome}
${lines}
${cursor}
\\draw[${col.name(th.border)}, rounded corners=6pt, line width=0.6pt] (0,0) rectangle (${n(W)},${n(-H)});
\\end{tikzpicture}
\\end{adjustbox}
\\caption{${caption}}
\\end{figure}
`;
  return { tex, warnings };
}

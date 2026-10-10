import type { TerminalT } from "@classroompilot/shared";

export interface Seg {
  t: string;
  /** hex colour without # */
  c?: string;
  b?: boolean;
}
export type Line = Seg[];

export interface Theme {
  chrome: "ubuntu" | "macos" | "windows" | "vscode";
  bg: string;
  fg: string;
  titleBg: string;
  titleFg: string;
  border: string;
  err: string;
  warn: string;
  green: string;
  blue: string;
  defaultShell: "bash" | "zsh" | "powershell" | "cmd";
  defaultHost: string;
}

export const THEMES: Record<TerminalT["theme"], Theme> = {
  ubuntu: { chrome: "ubuntu", bg: "300A24", fg: "EEEEEC", titleBg: "2C2C2C", titleFg: "DDDDDD", border: "1A1A1A", err: "EF2929", warn: "FCE94F", green: "4E9A06", blue: "729FCF", defaultShell: "bash", defaultHost: "ubuntu" },
  "macos-dark": { chrome: "macos", bg: "1E1E1E", fg: "F2F2F2", titleBg: "323232", titleFg: "C8C8C8", border: "4A4A4A", err: "FF6B68", warn: "E5C07B", green: "5AF78E", blue: "57C7FF", defaultShell: "zsh", defaultHost: "MacBook-Air" },
  "macos-light": { chrome: "macos", bg: "FFFFFF", fg: "000000", titleBg: "E8E6E8", titleFg: "4D4D4D", border: "C0C0C0", err: "C91B00", warn: "A68100", green: "00A600", blue: "0225C7", defaultShell: "zsh", defaultHost: "MacBook-Air" },
  powershell: { chrome: "windows", bg: "012456", fg: "EEEDF0", titleBg: "FFFFFF", titleFg: "000000", border: "888888", err: "FF5555", warn: "F9F1A5", green: "13A10E", blue: "3B78FF", defaultShell: "powershell", defaultHost: "DESKTOP-4F2K9" },
  cmd: { chrome: "windows", bg: "0C0C0C", fg: "CCCCCC", titleBg: "FFFFFF", titleFg: "000000", border: "888888", err: "E74856", warn: "F9F1A5", green: "13A10E", blue: "3B78FF", defaultShell: "cmd", defaultHost: "DESKTOP-4F2K9" },
  vscode: { chrome: "vscode", bg: "1E1E1E", fg: "CCCCCC", titleBg: "1E1E1E", titleFg: "CCCCCC", border: "3C3C3C", err: "F14C4C", warn: "CCA700", green: "23D18B", blue: "3B8EEA", defaultShell: "powershell", defaultHost: "DESKTOP-4F2K9" },
};

const isWin = (cwd: string) => /^[A-Za-z]:[\\/]/.test(cwd) || cwd.includes("\\");
const base = (cwd: string) => (cwd === "~" ? "~" : cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || cwd);

export function resolveShell(b: TerminalT): "bash" | "zsh" | "powershell" | "cmd" {
  if (b.shell) return b.shell;
  const th = THEMES[b.theme];
  if (b.theme === "vscode") return isWin(b.entries.find((e) => e.cwd)?.cwd ?? "") || !b.entries.some((e) => e.cwd) ? "powershell" : "bash";
  return th.defaultShell;
}

function defaultCwd(shell: ReturnType<typeof resolveShell>, user: string) {
  return shell === "powershell" || shell === "cmd" ? `C:\\Users\\${user}` : "~";
}

function prompt(shell: ReturnType<typeof resolveShell>, th: Theme, user: string, host: string, cwd: string): Seg[] {
  switch (shell) {
    case "bash":
      return [{ t: `${user}@${host}`, c: th.green, b: true }, { t: ":" }, { t: cwd, c: th.blue, b: true }, { t: "$ " }];
    case "zsh":
      return [{ t: `${user}@${host} ${base(cwd)} % ` }];
    case "powershell":
      return [{ t: `PS ${cwd}> ` }];
    case "cmd":
      return [{ t: `${cwd}>` }];
  }
}

const ANSI: Record<number, string> = {
  30: "2E3436", 31: "CC0000", 32: "4E9A06", 33: "C4A000", 34: "3465A4", 35: "75507B", 36: "06989A", 37: "D3D7CF",
  90: "555753", 91: "EF2929", 92: "8AE234", 93: "FCE94F", 94: "729FCF", 95: "AD7FA8", 96: "34E2E2", 97: "EEEEEC",
};

/** Real terminals only colour what the program colours: parse SGR escape codes and drop other escapes. */
export function parseAnsi(raw: string, force?: string): Seg[] {
  const text = raw.replace(/\\(?:x1b|u001b|033|e)(?=\[)/gi, "\u001b");
  const segs: Seg[] = [];
  let color: string | undefined = force;
  let bold = false;
  let last = 0;
  const push = (t: string) => t && segs.push({ t, c: color, b: bold || undefined });
  for (const m of text.matchAll(/\u001b\[([0-9;]*)([A-Za-z])/g)) {
    push(text.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[2] !== "m") continue;
    for (const code of (m[1] || "0").split(";").map(Number)) {
      if (code === 0) (color = force), (bold = false);
      else if (code === 1) bold = true;
      else if (code === 22) bold = false;
      else if (code === 39) color = force;
      else if (ANSI[code]) color = ANSI[code];
    }
  }
  push(text.slice(last));
  return segs.length ? segs : [{ t: "" }];
}

/** Hard-wrap a styled line at `columns` characters, as a real terminal does. */
function wrap(line: Line, columns: number): Line[] {
  const out: Line[] = [];
  let cur: Line = [];
  let n = 0;
  for (const seg of line) {
    let rest = seg.t;
    while (rest.length) {
      const take = rest.slice(0, columns - n);
      cur.push({ ...seg, t: take });
      n += take.length;
      rest = rest.slice(take.length);
      if (n >= columns && rest.length) (out.push(cur), (cur = []), (n = 0));
    }
  }
  out.push(cur);
  return out;
}

export interface TerminalModel {
  lines: Line[];
  theme: Theme;
  title: string;
  columns: number;
  /** column index where the cursor block sits on the last line, if drawn */
  cursorAt?: number;
}

const expandTabs = (s: string) => s.replace(/\t/g, "    ").replace(/\r/g, "");

export function buildTerminal(b: TerminalT): TerminalModel {
  const th = THEMES[b.theme];
  const shell = resolveShell(b);
  const user = b.user ?? "user";
  const host = b.host ?? th.defaultHost;
  let cwd = defaultCwd(shell, user);
  const lines: Line[] = [];
  const push = (l: Line) => lines.push(...wrap(l, b.columns));

  for (const e of b.entries) {
    if (e.cwd) cwd = e.cwd;
    if (e.cmd !== undefined) {
      const parts = expandTabs(e.cmd).split("\n");
      parts.forEach((p, i) => push([...(i === 0 ? prompt(shell, th, user, host, cwd) : [{ t: shell === "powershell" ? ">> " : "> " }]), { t: p }]));
    }
    if (e.output !== undefined) {
      for (const raw of expandTabs(e.output).replace(/\n+$/, "").split("\n")) push(parseAnsi(raw, e.error ? th.err : undefined));
    }
  }
  let cursorAt: number | undefined;
  if (b.endPrompt) {
    const p = prompt(shell, th, user, host, cwd);
    cursorAt = p.reduce((n, s) => n + s.t.length, 0);
    lines.push(...wrap(p, b.columns));
  }

  const rows = Math.max(24, lines.length);
  const title =
    b.title ??
    (th.chrome === "ubuntu"
      ? `${user}@${host}: ${cwd}`
      : th.chrome === "macos"
        ? `${base(cwd)} \u2014 -${shell} \u2014 ${b.columns}\u00d7${rows}`
        : b.theme === "cmd"
          ? "Command Prompt"
          : b.theme === "powershell"
            ? "Windows PowerShell"
            : "");
  return { lines, theme: th, title, columns: b.columns, cursorAt };
}

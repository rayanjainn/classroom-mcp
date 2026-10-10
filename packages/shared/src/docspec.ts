import { z } from "zod";

const text = (max: number) => z.string().max(max);

export const Heading = z.object({ type: z.literal("heading"), level: z.number().int().min(1).max(3), text: text(300) });
export const Paragraph = z.object({
  type: z.literal("paragraph"),
  text: text(20_000).describe("Supports **bold**, *italic*, `code`, $inline math$ and [@citekey]"),
});
export const Equation = z.object({ type: z.literal("equation"), latex: text(1_000), label: text(40).optional() });
export const Table = z.object({
  type: z.literal("table"),
  caption: text(300).optional(),
  columns: z.array(text(200)).min(1).max(10),
  rows: z.array(z.array(text(1_000))).max(100),
  align: z.array(z.enum(["l", "c", "r"])).optional(),
});
export const Code = z.object({
  type: z.literal("code"),
  language: text(30).default("text"),
  caption: text(300).optional(),
  text: text(30_000),
});
export const List = z.object({ type: z.literal("list"), ordered: z.boolean(), items: z.array(text(2_000)).max(100) });
export const Quote = z.object({ type: z.literal("quote"), text: text(3_000) });
export const Abstract = z.object({ type: z.literal("abstract"), text: text(4_000) });
export const Algorithm = z.object({ type: z.literal("algorithm"), caption: text(300), steps: z.array(text(500)).max(60) });
export const Cover = z.object({
  type: z.literal("cover"),
  fields: z.record(z.string(), text(300)).describe("e.g. institution, department, subject, subjectCode, teacherName, fullName, rollNo, uid, branch, className, batch, semester, date"),
});
export const Simple = z.object({ type: z.enum(["toc", "pagebreak"]) });
export const Chart = z.object({
  type: z.literal("chart"),
  chartType: z.enum(["line", "bar", "scatter"]),
  title: text(200).optional(),
  caption: text(500).min(1),
  alt: text(500).min(1),
  xLabel: text(100).optional(),
  yLabel: text(100).optional(),
  categories: z.array(text(60)).max(30).optional().describe("x-axis labels for bar charts"),
  series: z
    .array(
      z.object({
        name: text(60),
        x: z.array(z.number()).max(300).optional().describe("numeric x values (line/scatter)"),
        y: z.array(z.number()).max(300),
      }),
    )
    .min(1)
    .max(6),
});
export const Diagram = z.object({
  type: z.literal("diagram"),
  caption: text(500).min(1),
  alt: text(500).min(1),
  direction: z.enum(["LR", "TB"]).default("LR"),
  nodes: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_]{1,20}$/), label: text(80), shape: z.enum(["box", "round", "diamond"]).default("box") })).min(1).max(24),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: text(40).optional() })).max(60),
});

const Source = z
  .enum(["captured", "illustrative"])
  .describe("'captured' only when the content is the real output of a real run the student did; otherwise 'illustrative' (the caption then notes it is simulated)");

export const TerminalEntry = z.object({
  cwd: text(200).optional().describe("working directory shown in the prompt from this entry on (e.g. ~/lab3 or C:\\Users\\user\\lab3)"),
  cmd: text(2000).optional().describe("the command typed after the prompt"),
  output: text(20_000).optional().describe("the lines printed by the command"),
  error: z.boolean().optional().describe("force the whole output red"),
});
export const Terminal = z.object({
  type: z.literal("terminal"),
  theme: z.enum(["ubuntu", "macos-dark", "macos-light", "powershell", "cmd", "vscode"]).default("ubuntu"),
  shell: z.enum(["bash", "zsh", "powershell", "cmd"]).optional().describe("defaults from the theme"),
  source: Source,
  caption: text(500).min(1),
  alt: text(500).min(1),
  user: text(40).optional(),
  host: text(60).optional(),
  columns: z.number().int().min(40).max(140).default(80),
  title: text(120).optional().describe("window title override"),
  entries: z.array(TerminalEntry).min(1).max(60),
  endPrompt: z.boolean().default(true).describe("finish with an empty prompt and cursor, as in a real session"),
});

export const UiElement = z.discriminatedUnion("t", [
  z.object({ t: z.literal("heading"), text: text(120) }),
  z.object({ t: z.literal("text"), text: text(600) }),
  z.object({ t: z.literal("button"), text: text(40), primary: z.boolean().optional() }),
  z.object({ t: z.literal("buttons"), labels: z.array(text(40)).min(1).max(5), primary: z.number().int().min(0).optional() }),
  z.object({ t: z.literal("input"), label: text(60), value: text(120).optional(), placeholder: text(120).optional() }),
  z.object({ t: z.literal("table"), columns: z.array(text(40)).min(1).max(6), rows: z.array(z.array(text(60))).max(15) }),
  z.object({ t: z.literal("list"), items: z.array(text(100)).max(12) }),
  z.object({ t: z.literal("code"), text: text(800) }),
  z.object({ t: z.literal("alert"), text: text(200), tone: z.enum(["info", "success", "warning", "error"]).default("info") }),
]);
export const Ui = z.object({
  type: z.literal("ui"),
  kind: z.enum(["browser", "window"]).default("browser"),
  theme: z.enum(["light", "dark"]).default("light"),
  source: Source,
  caption: text(500).min(1),
  alt: text(500).min(1),
  title: text(100).describe("browser tab title or window title"),
  url: text(200).optional().describe("address bar text (browser only)"),
  menu: z.array(text(30)).max(8).optional().describe("top menu items, e.g. File, Edit, View"),
  sidebar: z.array(text(40)).max(10).optional(),
  activeSidebar: z.number().int().min(0).optional(),
  content: z.array(UiElement).min(1).max(20),
});

export const Block = z.discriminatedUnion("type", [
  Heading, Paragraph, Equation, Table, Code, List, Quote, Abstract, Algorithm, Cover, Simple, Chart, Diagram, Terminal, Ui,
]);

export const BibEntry = z.object({
  key: z.string().regex(/^[A-Za-z0-9_:-]{1,40}$/),
  type: z.enum(["book", "article", "web", "other"]).default("other"),
  author: text(300).optional(),
  title: text(400),
  year: z.number().int().min(1000).max(2200).optional(),
  venue: text(300).optional().describe("journal / conference / website name"),
  publisher: text(200).optional(),
  url: text(500).optional(),
});

export const DocSpec = z.object({
  meta: z.object({
    title: text(300),
    subtitle: text(300).optional(),
    template: z.enum(["lab-report", "assignment-answers", "project-report", "minimal"]).default("minimal"),
    format: z.enum(["latex", "google-doc"]).default("latex"),
    paper: z.enum(["A4", "Letter"]).default("A4"),
    fontSize: z.union([z.literal(10), z.literal(11), z.literal(12)]).default(11),
    font: z.enum(["computer-modern", "times", "sans"]).default("computer-modern"),
    marginCm: z.number().min(1.5).max(3.5).default(2.5),
    lineSpacing: z.number().min(1).max(2).default(1.15),
    columns: z.union([z.literal(1), z.literal(2)]).default(1),
    header: text(120).optional(),
    pageNumbers: z.boolean().default(true),
    citationStyle: z.enum(["apa", "mla", "ieee", "harvard"]).default("ieee"),
    colorMode: z.enum(["color", "grayscale"]).default("color"),
    useProfile: z.boolean().default(true).describe("fill missing cover fields from the saved student profile"),
  }),
  blocks: z.array(Block).min(1).max(400),
  bibliography: z.array(BibEntry).max(60).default([]),
});

export type DocSpecT = z.infer<typeof DocSpec>;
export type BlockT = z.infer<typeof Block>;
export type TerminalT = z.infer<typeof Terminal>;
export type UiT = z.infer<typeof Ui>;
export type BibEntryT = z.infer<typeof BibEntry>;

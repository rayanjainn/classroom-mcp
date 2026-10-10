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

export const Block = z.discriminatedUnion("type", [
  Heading, Paragraph, Equation, Table, Code, List, Quote, Abstract, Algorithm, Cover, Simple, Chart, Diagram,
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
export type BibEntryT = z.infer<typeof BibEntry>;

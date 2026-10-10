import { z } from "zod";

const heading = z.object({ type: z.literal("heading"), level: z.number().int().min(1).max(4), text: z.string().max(300) });
const paragraph = z.object({ type: z.literal("paragraph"), text: z.string().max(20_000) });
const equation = z.object({ type: z.literal("equation"), latex: z.string().max(2_000), label: z.string().optional() });
const table = z.object({
  type: z.literal("table"),
  caption: z.string().max(300),
  columns: z.array(z.string()).min(1).max(12),
  rows: z.array(z.array(z.string())).max(200),
  align: z.array(z.enum(["l", "c", "r"])).optional(),
});
const figure = z.object({
  type: z.literal("figure"),
  ref: z.string(),
  caption: z.string().min(1).max(500),
  alt: z.string().min(1).max(500),
  width: z.string().optional(),
});
const code = z.object({
  type: z.literal("code"),
  language: z.string().max(30),
  caption: z.string().max(300).optional(),
  text: z.string().max(50_000),
});
const list = z.object({ type: z.literal("list"), ordered: z.boolean(), items: z.array(z.string()).max(100) });
const cover = z.object({ type: z.literal("cover"), fields: z.record(z.string(), z.string()) });
const simple = z.object({ type: z.enum(["toc", "pagebreak"]) });
const bibliographyBlock = z.object({ type: z.literal("bibliography"), style: z.enum(["apa", "mla", "ieee", "harvard"]) });

export const Block = z.discriminatedUnion("type", [
  heading, paragraph, equation, table, figure, code, list, cover, simple, bibliographyBlock,
]);

export const DocSpec = z.object({
  meta: z.object({
    title: z.string().max(300),
    template: z.enum(["lab-report", "assignment-answers", "project-report", "minimal"]),
    format: z.enum(["google-doc", "docx", "latex-pdf"]),
    locale: z.string().default("en-IN"),
  }),
  profile: z.object({ use: z.boolean() }).default({ use: true }),
  blocks: z.array(Block).max(500),
  bibliography: z
    .array(z.object({ key: z.string(), type: z.string(), title: z.string(), author: z.string().optional(), year: z.number().optional() }))
    .default([]),
});

export type DocSpecT = z.infer<typeof DocSpec>;

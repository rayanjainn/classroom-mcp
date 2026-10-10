import { z } from "zod";
import type { Env } from "./env.js";

export const PROFILE_FIELDS = [
  "fullName", "rollNo", "uid", "enrollmentNo", "branch", "programme", "className", "section",
  "batch", "semester", "institution", "department", "email", "defaultCitationStyle", "defaultFont", "defaultFormat",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export const ProfileSchema = z.object(
  Object.fromEntries(PROFILE_FIELDS.map((f) => [f, z.string().max(200).optional()])) as Record<ProfileField, z.ZodOptional<z.ZodString>>,
);
export type Profile = z.infer<typeof ProfileSchema>;

export const CourseSettingsSchema = z.object({
  subjectName: z.string().max(200).optional(),
  subjectCode: z.string().max(50).optional(),
  teacherName: z.string().max(200).optional(),
  preferredFormat: z.string().max(100).optional(),
  structureNotes: z.string().max(2000).optional().describe("Reusable template notes: sections, fonts, margins, citation style"),
});
export type CourseSettings = z.infer<typeof CourseSettingsSchema>;

// ---- encrypted KV storage (AES-GCM, key derived from the Google client secret) ----
const enc = new TextEncoder();
const dec = new TextDecoder();

async function key(env: Env) {
  const base = await crypto.subtle.importKey("raw", enc.encode(env.GOOGLE_CLIENT_SECRET), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("classroompilot-profile-v1"), info: new Uint8Array() },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function seal(env: Env, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(env), enc.encode(JSON.stringify(value))));
  return `${b64(iv)}.${b64(ct)}`;
}

async function open<T>(env: Env, sealed: string | null): Promise<T | null> {
  if (!sealed) return null;
  const [iv, ct] = sealed.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(env), unb64(ct));
  return JSON.parse(dec.decode(pt));
}

const pk = (userId: string) => `cp:profile:${userId}`;
const ck = (userId: string, courseId: string) => `cp:course:${userId}:${courseId}`;

export const getProfile = async (env: Env, userId: string): Promise<Profile> =>
  (await open<Profile>(env, await env.OAUTH_KV.get(pk(userId)))) ?? {};

export async function updateProfile(env: Env, userId: string, patch: Profile) {
  const merged = { ...(await getProfile(env, userId)), ...patch };
  for (const k of Object.keys(merged) as ProfileField[]) if (merged[k] === "") delete merged[k];
  await env.OAUTH_KV.put(pk(userId), await seal(env, merged));
  return merged;
}

export const getCourseSettings = async (env: Env, userId: string, courseId: string) =>
  (await open<CourseSettings>(env, await env.OAUTH_KV.get(ck(userId, courseId)))) ?? {};

export async function updateCourseSettings(env: Env, userId: string, courseId: string, patch: CourseSettings) {
  const merged = { ...(await getCourseSettings(env, userId, courseId)), ...patch };
  await env.OAUTH_KV.put(ck(userId, courseId), await seal(env, merged));
  return merged;
}

export async function deleteAll(env: Env, userId: string) {
  const { keys } = await env.OAUTH_KV.list({ prefix: `cp:course:${userId}:` });
  await Promise.all([env.OAUTH_KV.delete(pk(userId)), ...keys.map((k) => env.OAUTH_KV.delete(k.name))]);
  return keys.length + 1;
}

// ---- mapping a template's placeholders to profile fields ----
const SYNONYMS: [ProfileField, RegExp][] = [
  ["rollNo", /\broll\b|\broll\s*(no|number)\b/i],
  ["enrollmentNo", /enrol?l?ment/i],
  ["uid", /\buid\b|\bregistration\b|\breg\.?\s*no\b/i],
  ["fullName", /\bname\b|\bstudent\b/i],
  ["branch", /\bbranch\b|\bstream\b/i],
  ["programme", /\bprogram(me)?\b|\bdegree\b/i],
  ["section", /\bsection\b|\bsec\b/i],
  ["className", /\bclass\b/i],
  ["batch", /\bbatch\b|\bgroup\b/i],
  ["semester", /\bsem(ester)?\b/i],
  ["institution", /\b(college|university|institute|institution|school)\b/i],
  ["department", /\bdepartment\b|\bdept\b/i],
  ["email", /\be-?mail\b/i],
];

export function guessField(label: string): ProfileField | null {
  for (const [f, re] of SYNONYMS) if (re.test(label)) return f;
  return null;
}

export interface Placeholder {
  find: string;
  label: string;
  field: ProfileField | null;
}

/** Find fill-in spots in document text: [Your Name], {{rollNo}}, and "Label: ____" lines. */
export function scanPlaceholders(paragraphs: string[]): Placeholder[] {
  const out: Placeholder[] = [];
  const seen = new Set<string>();
  const add = (p: Placeholder) => {
    if (!seen.has(p.find)) (seen.add(p.find), out.push(p));
  };
  for (const raw of paragraphs) {
    const line = raw.replace(/\s+$/, "");
    for (const m of line.matchAll(/\[([^\]\n]{2,40})\]/g)) add({ find: m[0], label: m[1], field: guessField(m[1]) });
    for (const m of line.matchAll(/\{\{\s*([^}\n]{1,40}?)\s*\}\}/g)) add({ find: m[0], label: m[1], field: (PROFILE_FIELDS as readonly string[]).includes(m[1]) ? (m[1] as ProfileField) : guessField(m[1]) });
    const lab = /^([A-Za-z][A-Za-z .\/]{1,30}?)\s*[:\-]\s*(_{2,}|\.{3,}|\s*)$/.exec(line);
    if (lab && /[_.]|:\s*$/.test(line)) add({ find: line, label: lab[1].trim(), field: guessField(lab[1]) });
  }
  return out;
}

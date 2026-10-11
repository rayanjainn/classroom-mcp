import type { Env } from "./env.js";
import { open, seal } from "./profile.js";

export interface PickedFile {
  fileId: string;
  name: string;
  mime: string;
  text: string;
  pages?: number;
  truncated: boolean;
  extractedAt: string;
}

const ctxKey = (userId: string, fileId: string) => `cp:ctx:${userId}:${fileId}`;
const THIRTY_DAYS = 30 * 86_400;

export interface PickSession {
  userId: string;
  expectFileId?: string;
  name?: string;
}

export async function createPickSession(env: Env, s: PickSession): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  await env.OAUTH_KV.put(`cp:pick:${id}`, JSON.stringify(s), { expirationTtl: 1800 });
  return id;
}

export async function getPickSession(env: Env, id: string): Promise<PickSession | null> {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const raw = await env.OAUTH_KV.get(`cp:pick:${id}`);
  return raw ? (JSON.parse(raw) as PickSession) : null;
}

export async function putPicked(env: Env, userId: string, f: Omit<PickedFile, "extractedAt">) {
  const record: PickedFile = { ...f, extractedAt: new Date().toISOString() };
  await env.OAUTH_KV.put(ctxKey(userId, f.fileId), await seal(env, record), { expirationTtl: THIRTY_DAYS });
}

export async function getPicked(env: Env, userId: string, fileId: string): Promise<PickedFile | null> {
  return open<PickedFile>(env, await env.OAUTH_KV.get(ctxKey(userId, fileId)));
}

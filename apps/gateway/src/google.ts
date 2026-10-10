import type { Env } from "./env.js";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
  "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
  "https://www.googleapis.com/auth/classroom.announcements.readonly",
  "https://www.googleapis.com/auth/classroom.topics.readonly",
];

export function googleAuthUrl(env: Env, state: string, codeChallenge: string): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.PUBLIC_BASE_URL}/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

async function tokenRequest(env: Env, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      ...params,
    }),
  });
  if (!res.ok) throw new GoogleError(res.status, await res.text());
  return res.json();
}

export const exchangeCode = (env: Env, code: string, verifier: string) =>
  tokenRequest(env, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: `${env.PUBLIC_BASE_URL}/callback`,
  });

const accessCache = new Map<string, { token: string; exp: number }>();

export async function accessToken(env: Env, userId: string, refreshToken: string): Promise<string> {
  const hit = accessCache.get(userId);
  if (hit && hit.exp > Date.now() + 30_000) return hit.token;
  const t = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: refreshToken });
  accessCache.set(userId, { token: t.access_token, exp: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

export async function userInfo(token: string): Promise<{ sub: string; email: string; name?: string }> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new GoogleError(res.status, await res.text());
  return res.json();
}

export class GoogleError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Google API ${status}: ${body.slice(0, 300)}`);
  }
}

/** GET a Google API URL and return JSON. */
export async function gget<T>(token: string, url: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
  const res = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new GoogleError(res.status, await res.text());
  return res.json();
}

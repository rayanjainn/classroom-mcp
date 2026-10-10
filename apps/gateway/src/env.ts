import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  PUBLIC_BASE_URL: string;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

/** Stored (encrypted) with each MCP grant. */
export interface Props extends Record<string, unknown> {
  userId: string;
  email: string;
  googleRefreshToken: string;
  scopeVersion: number;
}

import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  PUBLIC_BASE_URL: string;
  /** Origin of the static site that hosts the file picker page. */
  WEB_ORIGIN: string;
  /** Google Picker developer key and Cloud project number; empty disables the picker flow. */
  PICKER_API_KEY?: string;
  GCP_PROJECT_NUMBER?: string;
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

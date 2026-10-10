import { AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import type { Env, Props } from "./env.js";
import { exchangeCode, googleAuthUrl, s256, SCOPE_VERSION, userInfo } from "./google.js";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const page = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect ClassroomPilot</title>
<style>body{font:16px system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5}
button{font:inherit;padding:.6rem 1.2rem;margin-right:.5rem;border-radius:.4rem;border:1px solid #888;cursor:pointer}
button.primary{background:#1a73e8;color:#fff;border-color:#1a73e8}</style></head><body>${body}</body></html>`;

const html = (body: string, headers?: Headers, status = 200) => {
  const h = new Headers(headers);
  h.set("content-type", "text/html; charset=utf-8");
  return new Response(page(body), { status, headers: h });
};

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("ClassroomPilot gateway"));
app.get("/healthz", (c) => c.json({ ok: true }));

app.get("/authorize", async (c) => {
  const oauth = c.env.OAUTH_PROVIDER;
  try {
    const req = await oauth.parseAuthRequest(c.req.raw);
    const d = await oauth.describeConsent(req);
    const t = await oauth.beginConsent(req);
    return html(
      `<h1>Connect ClassroomPilot</h1>
<p><strong>${esc(d.clientName)}</strong>${d.clientDomain ? ` (${esc(d.clientDomain)})` : ""} wants to use ClassroomPilot on your behalf.</p>
<p>Tokens will be sent to <strong>${esc(d.redirectHost)}</strong>.${d.redirectIsLoopback ? " <em>This is an app on your own computer.</em>" : ""}</p>
<p>Next you will sign in with Google and grant <strong>read-only</strong> access to your Classroom courses, classwork, materials, announcements and your own submissions. ClassroomPilot cannot send, delete or share anything.</p>
<form method="post" action="/authorize"><input type="hidden" name="handle" value="${esc(t.handle)}">
<button class="primary" name="decision" value="approve">Continue with Google</button>
<button name="decision" value="deny">Cancel</button></form>`,
      t.headers,
    );
  } catch (e) {
    return authError(e);
  }
});

app.post("/authorize", async (c) => {
  const oauth = c.env.OAUTH_PROVIDER;
  try {
    const form = await c.req.raw.formData();
    const handle = String(form.get("handle"));
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      denied.headers.set("Location", denied.redirectTo);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(c.req.raw, handle);
    const verifier = crypto.randomUUID() + crypto.randomUUID();
    const { state, headers } = await oauth.beginUpstream(approved.request, {
      data: { verifier },
      headers: approved.headers,
    });
    headers.set("Location", googleAuthUrl(c.env, state, await s256(verifier)));
    return new Response(null, { status: 302, headers });
  } catch (e) {
    return authError(e);
  }
});

app.get("/callback", async (c) => {
  const oauth = c.env.OAUTH_PROVIDER;
  try {
    const { request: original, data, headers } = await oauth.finishUpstream<{ verifier: string }>(c.req.raw);
    const url = new URL(c.req.url);
    if (url.searchParams.get("error")) {
      const { authorizationErrorRedirect } = await import("@cloudflare/workers-oauth-provider");
      headers.set("Location", authorizationErrorRedirect(original, "access_denied"));
      return new Response(null, { status: 302, headers });
    }
    const tokens = await exchangeCode(c.env, url.searchParams.get("code")!, data.verifier);
    if (!tokens.refresh_token) {
      return html(
        "<h1>Google did not return offline access</h1><p>Remove ClassroomPilot at myaccount.google.com/permissions, then try again.</p>",
        headers,
        400,
      );
    }
    const me = await userInfo(tokens.access_token);
    const props: Props = { userId: me.sub, email: me.email, googleRefreshToken: tokens.refresh_token, scopeVersion: SCOPE_VERSION };
    const { redirectTo } = await oauth.completeAuthorization({
      request: original,
      userId: me.sub,
      metadata: { email: me.email },
      scope: original.scope,
      props,
    });
    headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers });
  } catch (e) {
    return authError(e);
  }
});

function authError(e: unknown) {
  if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
  if (e instanceof AuthorizationError || e instanceof CimdFetchError) {
    const msg = e instanceof AuthorizationError ? e.description : "This app could not be verified.";
    return html(`<h1>Something went wrong</h1><p>${esc(String(msg))}</p><p>Go back to your AI app and try connecting again.</p>`, undefined, 400);
  }
  throw e;
}

export default app;

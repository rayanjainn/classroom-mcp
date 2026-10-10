import { AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import type { Env, Props } from "./env.js";
import { getPickSession, putPicked } from "./context.js";
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

const SAFE_ID = /^[a-f0-9]{32}$/;
const noStore = { "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" };

app.get("/open/:id", async (c) => {
  const id = c.req.param("id");
  const raw = SAFE_ID.test(id) ? await c.env.OAUTH_KV.get(`cp:tex:${id}`) : null;
  if (!raw) return html("<h1>Link expired</h1><p>Ask your assistant to render the document again.</p>", new Headers(noStore), 404);
  const { tex, engine, name } = JSON.parse(raw) as { tex: string; engine: string; name: string };
  const h = new Headers(noStore);
  h.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action https://www.overleaf.com; frame-ancestors 'none'");
  return html(
    `<h1>${esc(name)}</h1>
<p>Your document is ready as LaTeX (compiles with ${esc(engine)}). Open it in Overleaf to get the PDF, or download the <code>.tex</code> file.</p>
<form method="post" action="https://www.overleaf.com/docs">
<input type="hidden" name="encoded_snip" value="${esc(encodeURIComponent(tex))}">
<input type="hidden" name="snip_name" value="${esc(name)}">
<input type="hidden" name="engine" value="${esc(engine)}">
<button class="primary" type="submit">Open in Overleaf</button>
<a href="/open/${id}/download"><button type="button">Download .tex</button></a>
</form>
<p><small>This link works for one hour. Overleaf is a separate service with its own terms.</small></p>`,
    h,
  );
});

app.get("/open/:id/download", async (c) => {
  const id = c.req.param("id");
  const raw = SAFE_ID.test(id) ? await c.env.OAUTH_KV.get(`cp:tex:${id}`) : null;
  if (!raw) return c.text("Expired", 404);
  const { tex, name } = JSON.parse(raw) as { tex: string; name: string };
  return new Response(tex, {
    headers: {
      ...noStore,
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${name.replace(/[^A-Za-z0-9._ -]/g, "_")}.tex"`,
    },
  });
});

// ---- file picker support (the picker page itself lives on the static site) ----
const cors = (c: { env: Env }) => ({
  "access-control-allow-origin": c.env.WEB_ORIGIN,
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "600",
  vary: "origin",
  "cache-control": "no-store",
});

app.options("/pick/:id/*", (c) => new Response(null, { status: 204, headers: cors(c) }));
app.options("/pick/:id", (c) => new Response(null, { status: 204, headers: cors(c) }));

app.get("/pick/:id", async (c) => {
  const s = await getPickSession(c.env, c.req.param("id"));
  if (!s) return new Response(JSON.stringify({ error: "expired" }), { status: 404, headers: { ...cors(c), "content-type": "application/json" } });
  return new Response(
    JSON.stringify({
      expectFileId: s.expectFileId,
      name: s.name,
      clientId: c.env.GOOGLE_CLIENT_ID,
      apiKey: c.env.PICKER_API_KEY || undefined,
      appId: c.env.GCP_PROJECT_NUMBER || undefined,
    }),
    { headers: { ...cors(c), "content-type": "application/json" } },
  );
});

app.post("/pick/:id/submit", async (c) => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors(c), "content-type": "application/json" } });
  const s = await getPickSession(c.env, c.req.param("id"));
  if (!s) return json(404, { error: "expired" });
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return json(400, { error: "bad json" });
  }
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim() || text.length > 200_000) return json(400, { error: "text missing or too large" });
  if (typeof body.fileId !== "string" || !/^[A-Za-z0-9_-]{10,100}$/.test(body.fileId)) return json(400, { error: "bad fileId" });
  const record = {
    name: String(body.name ?? "").slice(0, 200),
    mime: String(body.mime ?? "").slice(0, 100),
    text,
    pages: typeof body.pages === "number" ? body.pages : undefined,
    truncated: Boolean(body.truncated),
  };
  await putPicked(c.env, s.userId, { ...record, fileId: body.fileId });
  // The student chose this file for the attachment the assistant asked about; make it readable under that id too
  // (for example when they pick their own copy of the teacher's file).
  const aliased = Boolean(s.expectFileId && s.expectFileId !== body.fileId);
  if (aliased) await putPicked(c.env, s.userId, { ...record, fileId: s.expectFileId! });
  return json(200, { ok: true, aliased });
});

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
<p>Next you will sign in with Google and let ClassroomPilot <strong>read</strong> your Classroom courses, classwork, materials, announcements and your own submissions, and the Google Docs, Slides and Sheets attached to them. Only when you approve a preview in your assistant can it edit your own submission Doc, and it can create new files (documents it makes for you) in your Drive. It never changes Classroom itself, and it cannot delete or share anything or turn work in for you.</p>
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

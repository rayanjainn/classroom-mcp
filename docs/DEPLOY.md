# Deploy (from your own machine)

Prereqs: Node 22+, `raycode.tech` on Cloudflare, a Google OAuth web client.

1. Clone and install:
   ```
   git clone https://github.com/rayanjainn/classroom-mcp && cd classroom-mcp && npm install
   cd apps/gateway && npx wrangler login
   ```
2. Deploy (first deploy also creates the `OAUTH_KV` namespace and the `mcp.classroom.raycode.tech` DNS record):
   ```
   npx wrangler deploy
   ```
   If it complains about the KV namespace: `npx wrangler kv namespace create OAUTH_KV`, then add `id = "<printed id>"` under `[[kv_namespaces]]` in `wrangler.toml` and deploy again.
3. Set the Google secrets (paste when prompted):
   ```
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
4. In Google Cloud > Auth Platform > Clients, add redirect URIs:
   `https://mcp.classroom.raycode.tech/callback` and `http://localhost:8787/callback`.
5. Verify:
   ```
   curl -i https://mcp.classroom.raycode.tech/healthz                       # {"ok":true}
   curl -i -X POST https://mcp.classroom.raycode.tech/mcp -d '{}'           # 401 + WWW-Authenticate
   curl https://mcp.classroom.raycode.tech/.well-known/oauth-authorization-server
   ```
6. Connect an AI client: add a custom connector with URL `https://mcp.classroom.raycode.tech/mcp`, sign in with a Google test account, then ask "list my Classroom courses".

Local dev: copy `.dev.vars.example` to `.dev.vars`, fill it, run `npm run dev` from the repo root.

Not needed yet: the D1 database (`migrations/0001_init.sql`) is unused until Phase 2.

## After pulling updates

1. Follow `docs/GOOGLE_SETUP.md` (new APIs, scopes, JavaScript origin).
2. `npx wrangler deploy` in `apps/gateway` **and** in `apps/web`.
3. Reconnect the connector (scopes changed: the old sign-in is rejected automatically within an hour, or add the connector again).
4. Optional: enable the file picker (`docs/PICKER.md`).

## Smoke test (ask your AI assistant, using only ClassroomPilot)

1. "List my assignments due this week." (`weekly_plan`)
2. "Get the bundle for <assignment> and show the template content."
3. "Save my profile: ..." then "Map my profile to the template."
4. "Fill in the placeholders and add an Aim section; show me the preview first." then approve.
5. "Render a lab report for this assignment as LaTeX." Open the Overleaf link.
6. "Check my draft against the requirements." then "Prepare my submission."
7. Open a teacher-attached PDF with "read_attachment" (needs the picker).

Free-plan Workers allow 10 ms CPU per request. If a tool call fails with error 1102 or "exceeded CPU", note which tool and tell me; the fix is smaller pages or Workers Paid (about $5/month).

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

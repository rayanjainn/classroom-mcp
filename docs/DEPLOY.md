# Deploy

One-time, from `apps/gateway` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set:

```
npx wrangler kv namespace create OAUTH_KV      # paste the id into wrangler.toml
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler deploy
```

Then uncomment the `routes` line in `wrangler.toml` so the Worker serves `mcp.classroom.raycode.tech`, and redeploy.

Google redirect URI to register: `https://mcp.classroom.raycode.tech/callback`
(local dev: `http://localhost:8787/callback`).

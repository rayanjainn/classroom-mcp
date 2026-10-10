# ClassroomPilot

A remote MCP server that connects a student's own AI assistant to Google Classroom, reads assignments and materials, builds documents, and prepares them for submission.

- `apps/gateway`: Cloudflare Worker serving the MCP endpoint (`/mcp`)
- `packages/shared`: shared schemas (DocSpec)
- `docs/SPIKES.md`: Phase 0 spike runbook

```
npm install
npm run dev        # http://localhost:8787/mcp
npm run typecheck
```

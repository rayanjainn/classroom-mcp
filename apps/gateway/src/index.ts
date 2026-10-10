import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerTools } from "./tools.js";

export interface Env {
  PUBLIC_BASE_URL: string;
  DB?: D1Database;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("ClassroomPilot gateway"));
app.get("/healthz", (c) => c.json({ ok: true }));

// Stateless MCP endpoint. OAuth (Phase 1) will gate this route.
app.all("/mcp", async (c) => {
  const server = new McpServer({ name: "classroompilot", version: "0.0.1" });
  registerTools(server);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

export default app;

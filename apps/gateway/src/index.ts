import { OAuthError, OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import authApp from "./auth.js";
import type { Env, Props } from "./env.js";
import { SCOPE_VERSION } from "./google.js";
import { registerTools } from "./tools.js";

const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext & { props: Props }) {
    const server = new McpServer({ name: "classroompilot", version: "0.0.1" });
    registerTools(server, env, ctx.props);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: mcpHandler as any,
  defaultHandler: authApp as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  clientIdMetadataDocumentEnabled: true,
  tokenExchangeCallback: (o) => {
    // Grants made before the Google scopes changed must sign in again.
    if (o.grantType === "refresh_token" && (o.props?.scopeVersion ?? 0) < SCOPE_VERSION) {
      throw new OAuthError("invalid_grant", { description: "ClassroomPilot permissions changed; please reconnect." });
    }
  },
  scopesSupported: ["mcp"],
  requiredScopes: ["mcp"],
  resourceMetadata: {
    resource: "https://mcp.classroom.raycode.tech/mcp",
    authorization_servers: ["https://mcp.classroom.raycode.tech"],
  },
});

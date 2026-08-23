#!/usr/bin/env node
/**
 * renshuu-mcp-server entry point.
 *
 * MULTI-TENANT BY DESIGN: buildServer() takes the API key as a parameter
 * rather than only reading a single fixed environment variable. This means
 * one deployed server can correctly serve many different renshuu accounts
 * at once — each request brings its own key, and nothing about one user's
 * request can leak into or interfere with another's.
 *
 *   - stdio mode (local CLI / Claude Desktop): single user by nature of the
 *     transport, so it reads RENSHUU_API_KEY from the environment/.env once.
 *   - HTTP mode (deployed server / Vercel): reads the key from an
 *     X-Renshuu-Api-Key request header on EVERY request, falling back to
 *     RENSHUU_API_KEY from the environment only if no header is sent (useful
 *     for your own single-tenant testing of a deployment).
 *
 * Critical fix vs. earlier versions of this file: buildServer() used to
 * call process.exit(1) if no key was found. In HTTP mode that meant one
 * request with a missing/bad key would crash the ENTIRE server process —
 * taking down every other user's connection with it. buildServer() now
 * throws instead, and each transport decides what to do with that: stdio
 * exits (correct for a misconfigured local process), HTTP returns a clean
 * 401 to just that one caller and keeps serving everyone else.
 */

import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { RenshuuClient } from "./renshuu/client.js";
import { RenshuuAuthError } from "./renshuu/errors.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerScheduleTools } from "./tools/schedules.js";
import { registerListTools } from "./tools/lists.js";
import { registerDictionaryTools } from "./tools/dictionary.js";
import { registerPresenceTools } from "./tools/presence.js";
import { registerJlptTools } from "./tools/jlpt.js";
import { registerMasteryTools } from "./tools/mastery.js";
import { createOAuthRouter, resolveAccessToken } from "./oauth/routes.js";
import { getBaseUrl } from "./oauth/baseUrl.js";

export const API_KEY_HEADER = "x-renshuu-api-key";

/**
 * Resolves the API key for one request: explicit param first (from a
 * request header in HTTP mode), then the environment variable as a
 * fallback. Throws RenshuuAuthError — never exits the process — if
 * neither is present, so callers can turn this into a clean per-request
 * error response instead of a server-wide crash.
 */
function resolveApiKey(explicitKey?: string): string {
  const key = explicitKey || process.env.RENSHUU_API_KEY;
  if (!key) {
    throw new RenshuuAuthError();
  }
  return key;
}

export function buildServer(apiKey?: string): McpServer {
  const resolvedKey = resolveApiKey(apiKey);
  const client = new RenshuuClient({ apiKey: resolvedKey });

  const server = new McpServer({
    name: "renshuu-mcp-server",
    version: "2.1.0",
  });

  registerProfileTools(server, client);
  registerScheduleTools(server, client);
  registerListTools(server, client);
  registerDictionaryTools(server, client);
  registerPresenceTools(server, client);
  registerJlptTools(server, client);
  registerMasteryTools(server, client);

  return server;
}

async function runStdio(): Promise<void> {
  let server: McpServer;
  try {
    server = buildServer(); // env-only: stdio is inherently single-user/local
  } catch (err) {
    console.error(
      "FATAL: could not start — " +
        (err instanceof Error ? err.message : String(err)) +
        "\nSet RENSHUU_API_KEY in your environment or .env file (see .env.example)."
    );
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("renshuu-mcp-server running on stdio");
}

/**
 * Resolves the per-request key. Checked in order:
 *   1. The X-Renshuu-Api-Key header, unchanged from how this always worked —
 *      still the fastest, simplest path for anyone calling this server
 *      directly (curl, a script, a client that supports custom headers).
 *   2. An `Authorization: Bearer <token>` header, where <token> is an
 *      access token this server itself issued via /token (see oauth/).
 *      This is what Claude's connector sends once a user has connected
 *      through the OAuth login flow — decrypting it recovers the same kind
 *      of renshuu API key the header path would have carried directly.
 *   3. Falls through to undefined (resolveApiKey then tries the
 *      RENSHUU_API_KEY env var, same as always).
 */
async function extractApiKeyFromRequest(req: Request): Promise<string | undefined> {
  const header = req.headers[API_KEY_HEADER];
  if (typeof header === "string" && header.trim()) return header.trim();
  if (Array.isArray(header) && header[0]?.trim()) return header[0].trim();

  const authHeader = req.headers["authorization"];
  const bearer = typeof authHeader === "string" ? authHeader : Array.isArray(authHeader) ? authHeader[0] : undefined;
  if (bearer?.startsWith("Bearer ")) {
    const token = bearer.slice("Bearer ".length).trim();
    if (token) {
      const key = await resolveAccessToken(token);
      if (key) return key;
    }
  }

  return undefined;
}

export function createHttpApp(): express.Express {
  const app = express();
  app.set("trust proxy", true); // so req.protocol respects x-forwarded-proto behind Vercel
  app.use(express.json());
  app.use(express.urlencoded({ extended: false })); // OAuth token endpoint uses form-encoded bodies

  app.use(createOAuthRouter());

  // Basic permissive CORS — this API authenticates via an explicit header
  // the caller must set deliberately (not an ambient credential like a
  // cookie), so a third-party page can't silently ride a victim's session;
  // it can only call this API if it already independently has that user's
  // key. Tighten `Access-Control-Allow-Origin` to a specific origin if you
  // deploy a dedicated frontend and want to lock this down further.
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", `Content-Type, Authorization, ${API_KEY_HEADER}`);
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    let server: McpServer;
    try {
      const apiKey = await extractApiKeyFromRequest(req);
      server = buildServer(apiKey);
    } catch (err) {
      if (err instanceof RenshuuAuthError) {
        res
          .status(401)
          .set(
            "WWW-Authenticate",
            `Bearer resource_metadata="${getBaseUrl(req)}/.well-known/oauth-protected-resource"`
          )
          .json({
            error: "missing_or_invalid_api_key",
            message: `No renshuu API key was provided. Send it in the '${API_KEY_HEADER}' request header, or connect via OAuth.`,
          });
        return;
      }
      console.error("Unexpected error building server:", err);
      res.status(500).json({ error: "internal_error" });
      return;
    }

    // A fresh server + transport per request: stateless, avoids request ID
    // collisions across concurrent callers, and — critically for multi-
    // tenant use — guarantees one user's server instance (and the key it
    // was built with) can never leak into another user's request.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("Unexpected error handling MCP request:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "internal_error" });
      }
    }
  });

  return app;
}

async function runHTTP(): Promise<void> {
  const app = createHttpApp();

  // A single bad request should never take the whole process down —
  // critical for a server multiple people depend on simultaneously.
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception (process kept alive):", err);
  });
  process.on("unhandledRejection", (err) => {
    console.error("Unhandled rejection (process kept alive):", err);
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.error(`renshuu-mcp-server running on http://localhost:${port}/mcp`);
    console.error(`Multi-tenant: send each caller's own key via the '${API_KEY_HEADER}' header.`);
  });
}

// Only auto-start when run directly (not when imported by tests or by
// the Vercel serverless handler, which reuses runHTTP's per-request logic
// without wanting app.listen()).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const transport = process.env.TRANSPORT || "stdio";
  if (transport === "http") {
    runHTTP().catch((error) => {
      console.error("Server error:", error);
      process.exit(1);
    });
  } else {
    runStdio().catch((error) => {
      console.error("Server error:", error);
      process.exit(1);
    });
  }
}

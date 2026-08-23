/**
 * OAuth layer for the MCP connector.
 *
 * Claude's custom connector UI doesn't support entering a per-user
 * `X-Renshuu-Api-Key` header directly. What it does support is standard
 * OAuth 2.1 + PKCE with Dynamic Client Registration (RFC 7591) — this file
 * implements exactly that, so each Claude user can paste their OWN renshuu
 * key into a login page once, and Claude handles the token after that.
 *
 * This does not change the existing `x-renshuu-api-key` header path at all
 * (see extractApiKeyFromRequest in index.ts) — that keeps working exactly
 * as before, for anyone calling this server directly. OAuth is purely
 * additive: it ends up producing a Bearer token that, once decrypted,
 * yields the same thing the header always did — a renshuu API key.
 *
 * Flow, end to end:
 *   1. Claude discovers this server needs auth (401 + WWW-Authenticate on
 *      POST /mcp — see index.ts), fetches /.well-known/oauth-protected-
 *      resource, then /.well-known/oauth-authorization-server.
 *   2. Claude POSTs to /register once, gets back a client_id.
 *   3. Claude sends the user's browser to GET /authorize. This server shows
 *      an HTML form asking for the renshuu API key (NOT an OAuth password —
 *      just the same key that's always been used), verifies it actually
 *      works against renshuu's API, and redirects back to Claude with a
 *      short-lived authorization code.
 *   4. Claude exchanges that code at POST /token (with PKCE) for an
 *      access_token + refresh_token.
 *   5. Claude sends `Authorization: Bearer <access_token>` on every /mcp
 *      call from then on.
 */

import { Router } from "express";
import type { Request, Response } from "express";

import { RenshuuClient } from "../renshuu/client.js";
import { getBaseUrl } from "./baseUrl.js";
import { decryptPayload, encryptPayload } from "./crypto.js";
import { verifyPkce } from "./pkce.js";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days
const AUTH_CODE_TTL_SECONDS = 120; // 2 minutes — just long enough for a redirect round trip
const CLIENT_ID_TTL_SECONDS = 60 * 60 * 24 * 365 * 10; // effectively permanent

interface ClientPayload extends Record<string, unknown> {
  type: "client";
  redirect_uris: string[];
}

interface CodePayload extends Record<string, unknown> {
  type: "code";
  renshuu_api_key: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
}

interface TokenPayload extends Record<string, unknown> {
  type: "access" | "refresh";
  renshuu_api_key: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderLoginPage(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
  error?: string;
}): string {
  const clientId = escapeHtml(params.clientId);
  const redirectUri = escapeHtml(params.redirectUri);
  const state = escapeHtml(params.state);
  const codeChallenge = escapeHtml(params.codeChallenge);
  const scope = escapeHtml(params.scope);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect renshuu</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 420px; margin: 80px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { font-size: 1.25rem; margin-bottom: 4px; }
  p { color: #555; font-size: 0.9rem; line-height: 1.45; }
  input[type=password] { width: 100%; padding: 10px; margin: 16px 0 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; box-sizing: border-box; }
  button { width: 100%; padding: 10px; background: #1a1a1a; color: white; border: none; border-radius: 6px; font-size: 1rem; cursor: pointer; }
  button:hover { background: #333; }
  .error { color: #c0392b; font-size: 0.85rem; margin: 4px 0 0; }
</style>
</head>
<body>
  <h1>Connect your renshuu account</h1>
  <p>Enter your renshuu API key to let Claude access your own study data. Find it in renshuu under <strong>Resources &rarr; renshuu API</strong>. A read-only key is enough unless you want Claude to add or remove terms.</p>
  <form method="POST" action="/authorize">
    <input type="hidden" name="client_id" value="${clientId}">
    <input type="hidden" name="redirect_uri" value="${redirectUri}">
    <input type="hidden" name="state" value="${state}">
    <input type="hidden" name="code_challenge" value="${codeChallenge}">
    <input type="hidden" name="scope" value="${scope}">
    <input type="password" name="renshuu_api_key" placeholder="renshuu API key" required autofocus>
    ${params.error ? `<p class="error">${escapeHtml(params.error)}</p>` : ""}
    <button type="submit">Connect</button>
  </form>
</body>
</html>`;
}

/** Decrypts a client_id and returns its registered redirect_uris, or null if invalid. */
async function resolveClient(clientId: string): Promise<string[] | null> {
  try {
    const payload = await decryptPayload<ClientPayload>(clientId);
    if (payload.type !== "client" || !Array.isArray(payload.redirect_uris)) return null;
    return payload.redirect_uris;
  } catch {
    return null;
  }
}

export function createOAuthRouter(): Router {
  const router = Router();

  // ---- Discovery metadata --------------------------------------------

  router.get("/.well-known/oauth-authorization-server", (req: Request, res: Response) => {
    const base = getBaseUrl(req);
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  router.get("/.well-known/oauth-protected-resource", (req: Request, res: Response) => {
    const base = getBaseUrl(req);
    res.json({
      resource: `${base}/mcp`,
      authorization_servers: [base],
    });
  });

  // ---- Dynamic Client Registration (RFC 7591) -------------------------

  router.post("/register", async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const redirectUris = body?.redirect_uris;

    if (
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0 ||
      !redirectUris.every((uri) => typeof uri === "string")
    ) {
      res.status(400).json({
        error: "invalid_client_metadata",
        error_description: "redirect_uris must be a non-empty array of strings",
      });
      return;
    }

    let clientId: string;
    try {
      clientId = await encryptPayload({ type: "client", redirect_uris: redirectUris }, CLIENT_ID_TTL_SECONDS);
    } catch (err) {
      res.status(500).json({ error: "server_error", error_description: (err as Error).message });
      return;
    }

    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  // ---- Authorization endpoint — GET shows the login form ---------------

  router.get("/authorize", async (req: Request, res: Response) => {
    const clientId = typeof req.query.client_id === "string" ? req.query.client_id : undefined;
    const redirectUri = typeof req.query.redirect_uri === "string" ? req.query.redirect_uri : undefined;
    const codeChallenge = typeof req.query.code_challenge === "string" ? req.query.code_challenge : undefined;
    const responseType = typeof req.query.response_type === "string" ? req.query.response_type : undefined;
    const codeChallengeMethod =
      typeof req.query.code_challenge_method === "string" ? req.query.code_challenge_method : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const scope = typeof req.query.scope === "string" ? req.query.scope : "";

    if (!clientId || !redirectUri || !codeChallenge) {
      res.status(400).send("Missing required parameters: client_id, redirect_uri, code_challenge.");
      return;
    }

    const registeredRedirectUris = await resolveClient(clientId);
    if (!registeredRedirectUris) {
      res.status(400).send("Unknown or expired client_id. Remove and re-add the connector to register again.");
      return;
    }
    if (!registeredRedirectUris.includes(redirectUri)) {
      res.status(400).send("redirect_uri does not match what was registered for this client.");
      return;
    }

    if (responseType !== "code" || codeChallengeMethod !== "S256") {
      const errorRedirect = new URL(redirectUri);
      errorRedirect.searchParams.set("error", "invalid_request");
      if (state) errorRedirect.searchParams.set("state", state);
      res.redirect(errorRedirect.toString());
      return;
    }

    res
      .set("Content-Type", "text/html; charset=utf-8")
      .send(
        renderLoginPage({
          clientId,
          redirectUri,
          state,
          codeChallenge,
          scope,
        })
      );
  });

  // ---- Authorization endpoint — POST handles the submitted API key -----

  router.post("/authorize", async (req: Request, res: Response) => {
    const body = req.body as Record<string, string | undefined>;
    const { client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge } = body;
    const state = body.state || "";
    const scope = body.scope || "";
    const apiKey = body.renshuu_api_key?.trim();

    if (!clientId || !redirectUri || !codeChallenge) {
      res.status(400).send("Missing required parameters.");
      return;
    }

    const registeredRedirectUris = await resolveClient(clientId);
    if (!registeredRedirectUris || !registeredRedirectUris.includes(redirectUri)) {
      res.status(400).send("Unknown client_id or redirect_uri mismatch.");
      return;
    }

    if (!apiKey) {
      res
        .set("Content-Type", "text/html; charset=utf-8")
        .send(
          renderLoginPage({
            clientId,
            redirectUri,
            state,
            codeChallenge,
            scope,
            error: "Enter your renshuu API key.",
          })
        );
      return;
    }

    try {
      await new RenshuuClient({ apiKey }).getProfile();
    } catch {
      res
        .set("Content-Type", "text/html; charset=utf-8")
        .send(
          renderLoginPage({
            clientId,
            redirectUri,
            state,
            codeChallenge,
            scope,
            error: "That key didn't work against renshuu's API. Double-check it and try again.",
          })
        );
      return;
    }

    const code = await encryptPayload(
      {
        type: "code",
        renshuu_api_key: apiKey,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
      },
      AUTH_CODE_TTL_SECONDS
    );

    const dest = new URL(redirectUri);
    dest.searchParams.set("code", code);
    if (state) dest.searchParams.set("state", state);
    res.redirect(dest.toString());
  });

  // ---- Token endpoint ---------------------------------------------------

  router.post("/token", async (req: Request, res: Response) => {
    const body = req.body as Record<string, string | undefined>;
    const grantType = body.grant_type;

    if (grantType === "authorization_code") {
      const { code, redirect_uri: redirectUri, client_id: clientId, code_verifier: codeVerifier } = body;
      if (!code || !redirectUri || !clientId || !codeVerifier) {
        res.status(400).json({ error: "invalid_request" });
        return;
      }

      let payload: CodePayload;
      try {
        payload = await decryptPayload<CodePayload>(code);
      } catch {
        res.status(400).json({ error: "invalid_grant", error_description: "code is invalid or expired" });
        return;
      }

      if (payload.type !== "code" || payload.client_id !== clientId || payload.redirect_uri !== redirectUri) {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      if (!verifyPkce(codeVerifier, payload.code_challenge)) {
        res.status(400).json({ error: "invalid_grant", error_description: "code_verifier mismatch" });
        return;
      }

      const accessToken = await encryptPayload(
        { type: "access", renshuu_api_key: payload.renshuu_api_key },
        ACCESS_TOKEN_TTL_SECONDS
      );
      const refreshToken = await encryptPayload(
        { type: "refresh", renshuu_api_key: payload.renshuu_api_key },
        REFRESH_TOKEN_TTL_SECONDS
      );

      res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: refreshToken,
        scope: "renshuu",
      });
      return;
    }

    if (grantType === "refresh_token") {
      const refreshToken = body.refresh_token;
      if (!refreshToken) {
        res.status(400).json({ error: "invalid_request" });
        return;
      }

      let payload: TokenPayload;
      try {
        payload = await decryptPayload<TokenPayload>(refreshToken);
      } catch {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      if (payload.type !== "refresh") {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }

      const accessToken = await encryptPayload(
        { type: "access", renshuu_api_key: payload.renshuu_api_key },
        ACCESS_TOKEN_TTL_SECONDS
      );
      const newRefreshToken = await encryptPayload(
        { type: "refresh", renshuu_api_key: payload.renshuu_api_key },
        REFRESH_TOKEN_TTL_SECONDS
      );

      res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: newRefreshToken,
        scope: "renshuu",
      });
      return;
    }

    res.status(400).json({ error: "unsupported_grant_type" });
  });

  return router;
}

/** Exported for index.ts's Bearer-token extraction path. */
export async function resolveAccessToken(token: string): Promise<string | undefined> {
  try {
    const payload = await decryptPayload<TokenPayload>(token);
    if (payload.type === "access" && payload.renshuu_api_key) {
      return payload.renshuu_api_key;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

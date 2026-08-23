/**
 * PKCE (RFC 7636) verification — required for OAuth 2.1 public clients,
 * which is what Claude's MCP connector registers as (no client_secret).
 * Only S256 is supported; "plain" is not accepted.
 */

import { createHash } from "node:crypto";

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  return computed === codeChallenge;
}

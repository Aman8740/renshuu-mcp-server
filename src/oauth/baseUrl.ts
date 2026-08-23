import type { Request } from "express";

/**
 * The public URL this server is reachable at, used to build absolute URLs
 * in OAuth metadata responses (issuer, authorization_endpoint, etc.) and in
 * the WWW-Authenticate header on 401s.
 *
 * Prefers OAUTH_ISSUER_URL if set (useful behind a proxy that doesn't
 * forward host/proto headers correctly); otherwise derives it from the
 * request. `app.set("trust proxy", true)` (set in createHttpApp) makes
 * req.protocol respect x-forwarded-proto, which Vercel always sends
 * correctly for its own domains.
 */
export function getBaseUrl(req: Request): string {
  if (process.env.OAUTH_ISSUER_URL) {
    return process.env.OAUTH_ISSUER_URL.replace(/\/+$/, "");
  }
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("host");
  return `${proto}://${host}`;
}

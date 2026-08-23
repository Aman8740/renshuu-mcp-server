/**
 * Stateless token helpers for the OAuth layer.
 *
 * Design choice worth understanding: this server has no database. Instead
 * of storing registered clients / auth codes / access tokens server-side,
 * each one IS the encrypted payload — a JWE (encrypted JWT) that only this
 * server can decrypt, using a single symmetric key from OAUTH_ENCRYPTION_KEY.
 *
 * This means:
 *   - client_id (from /register), the authorization `code`, the
 *     access_token, and the refresh_token are all opaque encrypted blobs
 *     containing whatever this server needs to remember about them
 *     (registered redirect_uris, or a user's renshuu API key).
 *   - Nothing is written to disk or an external store, which matters on
 *     Vercel: serverless functions don't share memory between invocations,
 *     so anything kept in a plain in-memory Map would silently break in
 *     production. This approach has no such gap.
 *   - The tradeoff: if OAUTH_ENCRYPTION_KEY is ever lost or rotated, every
 *     previously-issued client registration and token becomes invalid at
 *     once (decrypt fails) — everyone has to reconnect the connector.
 *     Rotate deliberately, not by accident.
 */

import { EncryptJWT, jwtDecrypt } from "jose";

let cachedKey: Uint8Array | undefined;

function getKey(): Uint8Array {
  if (cachedKey) return cachedKey;

  const raw = process.env.OAUTH_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "OAUTH_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` " +
        "and set it as an environment variable (see .env.example)."
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `OAUTH_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). ` +
        "Generate a valid one with: openssl rand -base64 32"
    );
  }

  cachedKey = key;
  return key;
}

/**
 * Encrypts an arbitrary JSON-serializable payload into a compact JWE string
 * that expires after `expiresInSeconds`. Uses direct symmetric encryption
 * (alg "dir", enc "A256GCM") — the env key IS the content-encryption key,
 * no key wrapping needed since this server is both issuer and verifier.
 */
export async function encryptPayload(
  payload: Record<string, unknown>,
  expiresInSeconds: number
): Promise<string> {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .encrypt(getKey());
}

/**
 * Decrypts and returns the payload. Throws if the token is malformed,
 * expired, or wasn't produced by this server (wrong/rotated key) — callers
 * should always wrap this in try/catch and treat any throw as "invalid
 * token", never inspect the error message to distinguish cases (that's not
 * meaningfully different for an OAuth client either way).
 */
export async function decryptPayload<T extends Record<string, unknown>>(
  token: string
): Promise<T> {
  const { payload } = await jwtDecrypt(token, getKey());
  return payload as unknown as T;
}

import { createHash } from "node:crypto";

/**
 * A stable, one-way, non-reversible identifier for analytics — the same
 * renshuu key always hashes to the same value, so the dashboard can show
 * "this user made 40 calls today" without this server ever storing or
 * displaying anyone's actual API key, including to the admin.
 */
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

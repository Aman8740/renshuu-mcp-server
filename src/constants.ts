/**
 * Shared constants for the renshuu API client and MCP tools.
 *
 * Confirmed live against https://api.renshuu.org/api-docs with a real API
 * key on 2026-07-12 — base URL and auth scheme below are verified, not
 * reconstructed guesses.
 */

export const RENSHUU_BASE_URL = "https://api.renshuu.org/v1";

/** Confirmed: renshuu uses standard HTTP Bearer auth. */
export const AUTH_HEADER_NAME = "Authorization";
export const AUTH_HEADER_SCHEME = "Bearer";

/** Confirmed via /profile response's api_usage field. */
export const DAILY_REQUEST_LIMIT = Number(process.env.RENSHUU_DAILY_LIMIT || 500);

/** Max characters returned in a single tool response before truncation. */
export const CHARACTER_LIMIT = 25000;

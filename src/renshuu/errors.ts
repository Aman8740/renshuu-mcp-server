/**
 * Error types for the renshuu client. Kept separate from MCP so this module
 * can be imported by any consumer (CLI script, another server, tests) without
 * pulling in MCP dependencies.
 */

export class RenshuuApiError extends Error {
  readonly status?: number;
  readonly endpoint: string;
  readonly body?: unknown;

  constructor(message: string, opts: { status?: number; endpoint: string; body?: unknown }) {
    super(message);
    this.name = "RenshuuApiError";
    this.status = opts.status;
    this.endpoint = opts.endpoint;
    this.body = opts.body;
  }
}

export class RenshuuRateLimitError extends Error {
  constructor(limit: number) {
    super(
      `Local daily request budget of ${limit} calls has been used up. ` +
        `renshuu enforces its own daily cap per key (roughly 500/day as of ` +
        `this writing) — this client-side guard stops you from hitting that ` +
        `wall unexpectedly. Wait for the next UTC day or raise ` +
        `RENSHUU_DAILY_LIMIT if you know your key allows more.`
    );
    this.name = "RenshuuRateLimitError";
  }
}

export class RenshuuAuthError extends Error {
  constructor() {
    super(
      "renshuu API key is missing or was rejected (401/403). Set the " +
        "RENSHUU_API_KEY environment variable to a valid key from " +
        "renshuu's site settings (confirmed format: 'Authorization: Bearer " +
        "<key>'). If the key is definitely correct, check " +
        "https://api.renshuu.org/api-docs for any changes to the auth scheme."
    );
    this.name = "RenshuuAuthError";
  }
}

/**
 * Separate file because RENSHUU_DAILY_LIMIT must be set BEFORE constants.ts
 * (and therefore client.ts) is first imported — module-level constants are
 * evaluated once at import time. Using dynamic import() after setting the
 * env var keeps this isolated from client.test.ts, which relies on the
 * real default of 500.
 */

import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

describe("RenshuuClient daily request budget (low limit)", () => {
  test("throws RenshuuRateLimitError after exceeding an overridden low limit", async () => {
    process.env.RENSHUU_DAILY_LIMIT = "3";

    const { RenshuuClient } = await import("../renshuu/client.js");
    const { RenshuuRateLimitError } = await import("../renshuu/errors.js");

    const fetchImpl = mock.fn(async () => new Response(JSON.stringify({ id: 1 }), { status: 200 }));
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.getProfile();
    await client.getProfile();
    await client.getProfile();
    assert.equal(client.requestsUsedToday, 3);

    await assert.rejects(() => client.getProfile(), RenshuuRateLimitError);

    delete process.env.RENSHUU_DAILY_LIMIT;
  });
});

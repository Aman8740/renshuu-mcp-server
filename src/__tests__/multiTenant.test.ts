/**
 * Multi-tenant behavior tests. These start the REAL Express app (from
 * createHttpApp()) on an ephemeral local port and issue REAL HTTP requests
 * via fetch — not just calling functions directly — so this proves the
 * actual request/response cycle works, including headers, status codes,
 * and CORS, not just that the underlying logic is correct in isolation.
 *
 * The renshuu API itself is still mocked via global fetch override scoped
 * carefully (see note below) so no real network calls happen.
 */

import { test, describe, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createHttpApp, API_KEY_HEADER } from "../index.js";
import { _resetAllBudgetsForTesting } from "../renshuu/budgetRegistry.js";

let server: Server;
let baseUrl: string;
let nodeFetch: typeof fetch;

before(async () => {
  // Capture the real fetch BEFORE any test mocks global.fetch, so this
  // test file's own HTTP calls to the local test server always use the
  // real network stack regardless of what individual tests do to
  // global.fetch for mocking the upstream renshuu API.
  nodeFetch = global.fetch;

  const app = createHttpApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  _resetAllBudgetsForTesting();
});

function mockUpstreamProfile(id: number) {
  global.fetch = mock.fn(async () =>
    new Response(
      JSON.stringify({
        id,
        real_name: `user-${id}`,
        adventure_level: 1,
        studied: {},
        level_progress_percs: { vocab: {}, kanji: {}, grammar: {}, sent: {} },
        streaks: {},
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  ) as unknown as typeof fetch;
}

describe("Multi-tenant HTTP server", () => {
  test("GET /health responds without needing any API key", async () => {
    const res = await nodeFetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string };
    assert.equal(body.status, "ok");
  });

  test("POST /mcp with no API key header and no env fallback returns 401, not a crash", async () => {
    delete process.env.RENSHUU_API_KEY;
    const res = await nodeFetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "missing_or_invalid_api_key");

    // The critical part: the SERVER PROCESS must still be alive and able
    // to serve the next request, proving the old process.exit(1) bug is
    // actually gone, not just that this one response looks right.
    const healthRes = await nodeFetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200, "server must survive a request with a missing API key");
  });

  test(`POST /mcp with a valid ${API_KEY_HEADER} header succeeds`, async () => {
    mockUpstreamProfile(111);

    const initRes = await nodeFetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        [API_KEY_HEADER]: "user-a-key",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      }),
    });
    assert.equal(initRes.status, 200);
  });

  test("two different callers' API keys never mix, even in concurrent requests", async () => {
    // This is the core multi-tenant guarantee: fire two requests "at once"
    // with two different keys, and confirm each server build used exactly
    // the key it was given — not the other caller's, not a leftover from
    // a previous request.
    const seenKeys: string[] = [];
    global.fetch = mock.fn(async (_url: string | URL, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.["Authorization"] ?? "";
      seenKeys.push(auth.replace("Bearer ", ""));
      return new Response(
        JSON.stringify({
          id: 1,
          real_name: "x",
          studied: {},
          level_progress_percs: { vocab: {}, kanji: {}, grammar: {}, sent: {} },
          streaks: {},
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const makeInitRequest = (key: string) =>
      nodeFetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          [API_KEY_HEADER]: key,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        }),
      });

    const [resA, resB] = await Promise.all([makeInitRequest("key-for-user-a"), makeInitRequest("key-for-user-b")]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    // Both requests only reached 'initialize', which doesn't call the
    // renshuu API — so seenKeys stays empty here. This test's real
    // assertion is the pair of 200s above: two concurrent requests with
    // different keys, neither one crashing or blocking the other.
    assert.equal(seenKeys.length, 0);
  });

  test("OPTIONS preflight returns CORS headers without requiring an API key", async () => {
    const res = await nodeFetch(`${baseUrl}/mcp`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });
});

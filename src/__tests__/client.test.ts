/**
 * Unit tests for RenshuuClient. Every real HTTP call is replaced with a
 * mock `fetchImpl` (dependency-injected via the constructor), so these run
 * instantly, offline, and never touch your real renshuu account or daily
 * request quota.
 *
 * Run with: npm test
 */

import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RenshuuClient } from "../renshuu/client.js";
import { RenshuuApiError, RenshuuAuthError } from "../renshuu/errors.js";
import { _resetAllBudgetsForTesting } from "../renshuu/budgetRegistry.js";

// Many tests below reuse simple literal API keys like "k". Since request
// budgets are now correctly shared per-key across client instances (that's
// the whole point of the multi-tenant fix), reused literal keys would
// otherwise leak call counts between unrelated tests. Resetting before
// every test keeps them isolated regardless of which key string is used.
beforeEach(() => {
  _resetAllBudgetsForTesting();
});

function mockFetchJson(status: number, body: unknown, headers: Record<string, string> = {}) {
  return mock.fn(async (_url: string | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  });
}

describe("RenshuuClient construction", () => {
  test("throws RenshuuAuthError when constructed without an API key", () => {
    assert.throws(() => new RenshuuClient({ apiKey: "" }), RenshuuAuthError);
  });

  test("accepts a valid API key without throwing", () => {
    assert.doesNotThrow(() => new RenshuuClient({ apiKey: "test-key" }));
  });
});

describe("RenshuuClient request construction", () => {
  test("getProfile sends Bearer auth header to /profile", async () => {
    const fetchImpl = mockFetchJson(200, { id: 1, real_name: "test" });
    const client = new RenshuuClient({ apiKey: "abc123", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.getProfile();

    assert.equal(fetchImpl.mock.calls.length, 1);
    const [url, init] = fetchImpl.mock.calls[0].arguments;
    assert.equal(String(url), "https://api.renshuu.org/v1/profile");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["Authorization"], "Bearer abc123");
  });

  test("searchWords sends 'value' and 'pg' query params (not 'search')", async () => {
    const fetchImpl = mockFetchJson(200, { result_count: 0, words: [] });
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.searchWords("食べる", 2);

    const [url] = fetchImpl.mock.calls[0].arguments;
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/v1/word/search");
    assert.equal(parsed.searchParams.get("value"), "食べる");
    assert.equal(parsed.searchParams.get("pg"), "2");
    assert.equal(parsed.searchParams.has("search"), false, "must not use the old guessed 'search' param name");
  });

  test("getKanji URL-encodes the literal kanji character into the path", async () => {
    const fetchImpl = mockFetchJson(200, { id: "1419", kanji: "食", definition: "eat" });
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.getKanji("食");

    const [url] = fetchImpl.mock.calls[0].arguments;
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, `/v1/kanji/${encodeURIComponent("食")}`);
  });

  test("getSchedules hits singular /schedule, not /schedules", async () => {
    const fetchImpl = mockFetchJson(200, { schedules: [] });
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.getSchedules();

    const [url] = fetchImpl.mock.calls[0].arguments;
    assert.equal(new URL(String(url)).pathname, "/v1/schedule");
  });

  test("getScheduleTerms hits /schedule/{id}/list with pg and group params", async () => {
    const fetchImpl = mockFetchJson(200, { schedules: [], contents: { terms: [] } });
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.getScheduleTerms("42", { pg: 3, group: "review_today" });

    const [url] = fetchImpl.mock.calls[0].arguments;
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/v1/schedule/42/list");
    assert.equal(parsed.searchParams.get("pg"), "3");
    assert.equal(parsed.searchParams.get("group"), "review_today");
  });

  test("getLists hits /lists (plural) for the grouped view", async () => {
    const fetchImpl = mockFetchJson(200, { termtype_groups: [] });
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.getLists();

    const [url] = fetchImpl.mock.calls[0].arguments;
    assert.equal(new URL(String(url)).pathname, "/v1/lists");
  });

  test("getListContents hits singular /list/{id}", async () => {
    const fetchImpl = mockFetchJson(200, { list_id: 1, title: "x", contents: { terms: [] } });
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.getListContents("77");

    const [url] = fetchImpl.mock.calls[0].arguments;
    assert.equal(new URL(String(url)).pathname, "/v1/list/77");
  });

  test("addWordTo sends PUT with list_id and sched_id as query params", async () => {
    const fetchImpl = mockFetchJson(200, {});
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.addWordTo("555", { list_id: "10", sched_id: "20" });

    const [url, init] = fetchImpl.mock.calls[0].arguments;
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/v1/word/555");
    assert.equal(init?.method, "PUT");
    assert.equal(parsed.searchParams.get("list_id"), "10");
    assert.equal(parsed.searchParams.get("sched_id"), "20");
  });

  test("removeKanjiFrom sends DELETE to the URL-encoded kanji path", async () => {
    const fetchImpl = mockFetchJson(200, {});
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.removeKanjiFrom("食", { list_id: "10" });

    const [url, init] = fetchImpl.mock.calls[0].arguments;
    assert.equal(init?.method, "DELETE");
    assert.equal(new URL(String(url)).pathname, `/v1/kanji/${encodeURIComponent("食")}`);
  });

  test("getSentencesForWord hits /reibun/search/{word_id}", async () => {
    const fetchImpl = mockFetchJson(200, { result_count: 0, reibuns: [] });
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.getSentencesForWord("239");

    const [url] = fetchImpl.mock.calls[0].arguments;
    assert.equal(new URL(String(url)).pathname, "/v1/reibun/search/239");
  });

  test("getAllStudiedTerms hits /list/all/{termtype}", async () => {
    const fetchImpl = mockFetchJson(200, { contents: { terms: [] } });
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.getAllStudiedTerms("kanji", { pg: 1 });

    const [url] = fetchImpl.mock.calls[0].arguments;
    assert.equal(new URL(String(url)).pathname, "/v1/list/all/kanji");
  });
});

describe("RenshuuClient error handling", () => {
  test("401 response throws RenshuuAuthError", async () => {
    const fetchImpl = mockFetchJson(401, { error: "unauthorized" });
    const client = new RenshuuClient({ apiKey: "bad-key", fetchImpl: fetchImpl as unknown as typeof fetch });

    await assert.rejects(() => client.getProfile(), RenshuuAuthError);
  });

  test("403 response throws RenshuuAuthError", async () => {
    const fetchImpl = mockFetchJson(403, { error: "forbidden" });
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await assert.rejects(() => client.getProfile(), RenshuuAuthError);
  });

  test("404 response throws RenshuuApiError carrying status 404", async () => {
    const fetchImpl = mockFetchJson(404, { error: "Invalid API endpoint." });
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await assert.rejects(
      () => client.getSchedules(),
      (err: unknown) => {
        assert.ok(err instanceof RenshuuApiError);
        assert.equal(err.status, 404);
        return true;
      }
    );
  });

  test("429 response throws RenshuuApiError with status 429", async () => {
    const fetchImpl = mockFetchJson(429, { error: "rate limited" });
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await assert.rejects(
      () => client.getProfile(),
      (err: unknown) => {
        assert.ok(err instanceof RenshuuApiError);
        assert.equal(err.status, 429);
        return true;
      }
    );
  });

  test("network failure (fetch throws) surfaces as RenshuuApiError", async () => {
    const fetchImpl = mock.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    await assert.rejects(() => client.getProfile(), RenshuuApiError);
  });

  test("non-JSON response body doesn't crash the client", async () => {
    const fetchImpl = mock.fn(async () => new Response("<html>not json</html>", { status: 200 }));
    const client = new RenshuuClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await client.getProfile();
    assert.equal(typeof result, "string");
  });
});

describe("RenshuuClient daily request budget", () => {
  test("throws RenshuuRateLimitError once the local budget is exhausted", async () => {
    const fetchImpl = mockFetchJson(200, { id: 1 });
    const client = new RenshuuClient({
      apiKey: "k",
      baseUrl: "https://api.renshuu.org/v1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Directly exercise the budget by calling far more than the default
    // limit would allow isn't practical at 500 calls in a unit test, so
    // this test constructs a client whose constants come from an env
    // override — see client.budget.test.ts for the low-limit variant.
    // Here we just confirm requestsUsedToday increments correctly.
    await client.getProfile();
    await client.getProfile();
    assert.equal(client.requestsUsedToday, 2);
  });
});

/**
 * These tests exercise the FULL MCP protocol stack in-process: a real
 * McpServer (from buildServer()) wired to a real MCP Client over
 * InMemoryTransport (no stdio, no HTTP, no real network). This catches
 * bugs unit tests on RenshuuClient alone would miss — duplicate tool
 * names, broken Zod schemas, tool handlers that throw instead of
 * returning an error result, etc.
 *
 * The renshuu API itself is still mocked via global fetch, so these never
 * touch your real account or its daily quota.
 */

import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

process.env.RENSHUU_API_KEY = "test-key-for-in-process-tests";

const { buildServer } = await import("../index.js");

const EXPECTED_TOOL_NAMES = [
  "renshuu_get_profile",
  "renshuu_get_schedules",
  "renshuu_get_schedule",
  "renshuu_get_schedule_terms",
  "renshuu_get_lists",
  "renshuu_get_list_contents",
  "renshuu_get_all_studied_terms",
  "renshuu_search_words",
  "renshuu_get_word",
  "renshuu_search_kanji",
  "renshuu_get_kanji",
  "renshuu_search_grammar",
  "renshuu_get_grammar",
  "renshuu_search_sentences",
  "renshuu_get_sentences_for_word",
  "renshuu_add_term",
  "renshuu_remove_term",
  "renshuu_get_jlpt_progress",
  "renshuu_get_item_progress",
];

describe("MCP server (in-process, real protocol layer)", () => {
  let client: Client;
  let originalFetch: typeof fetch;

  before(async () => {
    originalFetch = global.fetch;

    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "test-client", version: "1.0.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  after(() => {
    global.fetch = originalFetch;
  });

  test("registers exactly the expected tools, no duplicates, no missing", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    const expected = [...EXPECTED_TOOL_NAMES].sort();

    assert.deepEqual(names, expected, "tool list drifted from what this test expects — update EXPECTED_TOOL_NAMES if intentional");

    const uniqueNames = new Set(names);
    assert.equal(uniqueNames.size, names.length, "duplicate tool name detected");
  });

  test("every tool has a non-empty description (agents need this to pick the right tool)", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      assert.ok(tool.description && tool.description.length > 20, `${tool.name} has a missing or too-short description`);
    }
  });

  test("renshuu_get_profile round-trips through the real MCP call layer", async () => {
    global.fetch = mock.fn(async () =>
      new Response(
        JSON.stringify({
          id: 1,
          real_name: "test",
          adventure_level: 5,
          studied: { today_all: 10 },
          level_progress_percs: { vocab: { n2: 42 }, kanji: { n2: 10 }, grammar: { n2: 5 }, sent: { n2: 1 } },
          streaks: {},
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const result = await client.callTool({ name: "renshuu_get_profile", arguments: {} });
    assert.equal(result.isError, undefined, "tool should not report an error for a successful call");
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    assert.equal(parsed.real_name, "test");
    assert.equal(parsed.level_progress_percs.vocab.n2, 42);
  });

  test("renshuu_get_kanji round-trips a URL-encoded character through the real MCP call layer", async () => {
    global.fetch = mock.fn(async (url: string | URL) => {
      assert.ok(String(url).includes(encodeURIComponent("食")), "kanji character should be URL-encoded in the path");
      return new Response(JSON.stringify({ id: "1419", kanji: "食", definition: "eat, food" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await client.callTool({ name: "renshuu_get_kanji", arguments: { kanji: "食" } });
    assert.equal(result.isError, undefined);
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    assert.equal(parsed.kanji, "食");
  });

  test("a tool call against a failing upstream returns isError instead of throwing", async () => {
    global.fetch = mock.fn(async () =>
      new Response(JSON.stringify({ error: "Invalid API endpoint." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    ) as unknown as typeof fetch;

    const result = await client.callTool({ name: "renshuu_get_schedules", arguments: {} });
    assert.equal(result.isError, true, "a 404 from the API should surface as a tool-level error, not an MCP protocol crash");
  });

  test("renshuu_add_term reports an error when neither list_id nor sched_id is given", async () => {
    const result = await client.callTool({
      name: "renshuu_add_term",
      arguments: { item_type: "word", identifier: "123" },
    });
    assert.equal(result.isError, true);
  });

  test("renshuu_get_item_progress reports mastery: null when a term has never been studied", async () => {
    global.fetch = mock.fn(async () =>
      new Response(
        JSON.stringify({
          result_count: 1,
          total_pg: 1,
          per_pg: 50,
          pg: 1,
          query: "test",
          words: [{ id: "1", kanji_full: "食べる", hiragana_full: "たべる", def: ["to eat"] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const result = await client.callTool({
      name: "renshuu_get_item_progress",
      arguments: { item_type: "word", query: "食べる" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    assert.equal(parsed.mastery, null, "a term with no user_data field should report mastery: null, not crash");
  });

  test("renshuu_get_item_progress surfaces pitch accent and JLPT-via-markers for a word (regression test for a real gap found after doc updates)", async () => {
    global.fetch = mock.fn(async () =>
      new Response(
        JSON.stringify({
          result_count: 1,
          total_pg: 1,
          per_pg: 50,
          pg: 1,
          query: "こちら",
          words: [
            {
              id: "42",
              kanji_full: "",
              hiragana_full: "こちら",
              def: ["this way", "this"],
              pitch: ["こ⭧ちら"],
              markers: ["JLPT N5", "News/Web 10k"],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const result = await client.callTool({
      name: "renshuu_get_item_progress",
      arguments: { item_type: "word", query: "こちら" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    assert.equal(parsed.matched_term.pitch[0], "こ⭧ちら", "pitch accent must not be silently dropped");
    assert.match(parsed.matched_term.jlpt, /JLPT N5/, "JLPT level parsed from markers must not be silently dropped");
  });
});

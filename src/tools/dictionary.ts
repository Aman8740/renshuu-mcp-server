import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RenshuuClient } from "../renshuu/client.js";
import { errorResult, jsonResult } from "../services/formatting.js";

export function registerDictionaryTools(server: McpServer, client: RenshuuClient): void {
  // ---- Words ----
  server.registerTool(
    "renshuu_search_words",
    {
      title: "Search renshuu Word Dictionary",
      description:
        "Search renshuu's vocabulary dictionary by English meaning, romaji, hiragana, or kanji. " +
        "Each returned word includes embedded 'user_data' (your personal mastery: " +
        "correct_count, missed_count, mastery_avg_perc, per-quiz-mode study_vectors) and " +
        "'presence' (which of your schedules/lists it's already in) — no separate lookup " +
        "needed to check what you know. Also includes 'pitch' (real pitch-accent notation, " +
        "e.g. \"こ⭧ちら\", when available) and 'markers' (tags that may include JLPT level, " +
        "e.g. \"JLPT N5\", plus frequency-corpus tags — check this array for level info since " +
        "there's no separate dedicated jlpt field on words the way there is on kanji).\n\n" +
        "Args:\n  - value (string): required, e.g. 'to eat', 'taberu', '食べる'\n  - pg (number): default 1\n\n" +
        "Returns: { result_count, total_pg, per_pg, pg, query, words: [Word] }",
      inputSchema: z.object({ value: z.string().min(1), pg: z.number().int().min(1).default(1) }).strict().shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        return jsonResult(await client.searchWords(params.value, params.pg));
      } catch (err) {
        return errorResult(err, "Searching renshuu words");
      }
    }
  );

  server.registerTool(
    "renshuu_get_word",
    {
      title: "Get renshuu Word by ID",
      description:
        "Fetch a single word by its renshuu ID (from a prior search). Includes the same " +
        "embedded user_data/presence mastery fields as search results, plus 'pitch' " +
        "(pitch-accent notation) and 'markers' (which may include JLPT level tags) — " +
        "see renshuu_search_words for detail on those two fields.\n\n" +
        "Args:\n  - word_id (string): required\n\n" +
        "Don't use when: you don't have an ID yet — use renshuu_search_words first.",
      inputSchema: z.object({ word_id: z.string().min(1) }).strict().shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        return jsonResult(await client.getWord(params.word_id));
      } catch (err) {
        return errorResult(err, "Fetching renshuu word");
      }
    }
  );

  // ---- Kanji (looked up by the character itself) ----
  server.registerTool(
    "renshuu_search_kanji",
    {
      title: "Search renshuu Kanji Dictionary",
      description:
        "Search renshuu's kanji dictionary by meaning or reading. Returns a lightweight " +
        "summary list — use renshuu_get_kanji on a specific character for full detail " +
        "including your personal mastery data.\n\n" +
        "Args:\n  - value (string): required, e.g. 'eat', 'たべる'\n\n" +
        "Returns: { result_count, kanjis: [{ id, kanji, definition }] }",
      inputSchema: z.object({ value: z.string().min(1) }).strict().shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        return jsonResult(await client.searchKanji(params.value));
      } catch (err) {
        return errorResult(err, "Searching renshuu kanji");
      }
    }
  );

  server.registerTool(
    "renshuu_get_kanji",
    {
      title: "Get renshuu Kanji Detail",
      description:
        "Fetch full detail for one kanji, looked up by the LITERAL CHARACTER (not a numeric " +
        "ID — e.g. pass '食', not its internal id). Includes onyomi/kunyomi readings, radical, " +
        "JLPT level, related words, and your personal user_data mastery fields.\n\n" +
        "Args:\n  - kanji (string): required, the kanji character itself, e.g. '食'\n\n" +
        "Returns: full Kanji object with onyomi, kunyomi, radical, jlpt, rwords, parts, " +
        "presence, user_data.",
      inputSchema: z.object({ kanji: z.string().min(1) }).strict().shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        return jsonResult(await client.getKanji(params.kanji));
      } catch (err) {
        return errorResult(err, "Fetching renshuu kanji");
      }
    }
  );

  // ---- Grammar ----
  server.registerTool(
    "renshuu_search_grammar",
    {
      title: "Search renshuu Grammar Dictionary",
      description:
        "Search renshuu's grammar dictionary by meaning or Japanese pattern.\n\n" +
        "Args:\n  - value (string): required, e.g. 'while', 'ながら'\n  - pg (number): default 1\n\n" +
        "Returns: { result_count, total_pg, per_pg, pg, grammar: [Grammar] } — each entry " +
        "includes title_english, title_japanese, meaning, example models, and (if the " +
        "point is in one of your lists/schedules) embedded user_data mastery info.",
      inputSchema: z.object({ value: z.string().min(1), pg: z.number().int().min(1).default(1) }).strict().shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        return jsonResult(await client.searchGrammar(params.value, params.pg));
      } catch (err) {
        return errorResult(err, "Searching renshuu grammar");
      }
    }
  );

  server.registerTool(
    "renshuu_get_grammar",
    {
      title: "Get renshuu Grammar Entry",
      description:
        "Fetch full detail for one grammar point by its renshuu ID.\n\n" +
        "Args:\n  - grammar_id (string): required\n\n" +
        "Returns: full Grammar object including meaning_long, example models, and a " +
        "construct diagram image URL.",
      inputSchema: z.object({ grammar_id: z.string().min(1) }).strict().shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        return jsonResult(await client.getGrammar(params.grammar_id));
      } catch (err) {
        return errorResult(err, "Fetching renshuu grammar entry");
      }
    }
  );

  // ---- Example sentences (reibun) ----
  server.registerTool(
    "renshuu_search_sentences",
    {
      title: "Search renshuu Example Sentences",
      description:
        "Search renshuu's example sentence library by meaning or Japanese text.\n\n" +
        "Args:\n  - value (string): required\n\n" +
        "Returns: { result_count, pg, perPage, reibuns: [{ id, japanese, hiragana, meaning }] }",
      inputSchema: z.object({ value: z.string().min(1) }).strict().shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        return jsonResult(await client.searchSentences(params.value));
      } catch (err) {
        return errorResult(err, "Searching renshuu sentences");
      }
    }
  );

  server.registerTool(
    "renshuu_get_sentences_for_word",
    {
      title: "Get Example Sentences for a renshuu Word",
      description:
        "Fetch example sentences that use a specific word, given its word ID.\n\n" +
        "Args:\n  - word_id (string): required, from renshuu_search_words\n\n" +
        "Returns: { result_count, pg, perPage, reibuns: [...] }",
      inputSchema: z.object({ word_id: z.string().min(1) }).strict().shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        return jsonResult(await client.getSentencesForWord(params.word_id));
      } catch (err) {
        return errorResult(err, "Fetching example sentences for word");
      }
    }
  );
}

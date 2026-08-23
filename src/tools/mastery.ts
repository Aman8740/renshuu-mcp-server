import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RenshuuClient } from "../renshuu/client.js";
import { errorResult, jsonResult } from "../services/formatting.js";
import type { Grammar, Kanji, Word } from "../types.js";

/**
 * MASSIVELY simplified from the original version. That version had to make
 * several calls (search + scan every schedule + scan every list) to find a
 * term's personal mastery data, because the reconstructed API had no known
 * way to get it directly. The REAL API returns 'user_data' (mastery_avg_perc,
 * correct_count, missed_count, per-mode study_vectors) and 'presence'
 * (which schedules/lists it's in) embedded directly on every word/kanji/
 * grammar object from a single search or get call. So this is now one or
 * two calls total, not a multi-collection sweep.
 */

const ItemTypeSchema = z.enum(["word", "kanji", "grammar"]);

export function registerMasteryTools(server: McpServer, client: RenshuuClient): void {
  server.registerTool(
    "renshuu_get_item_progress",
    {
      title: "Get Personal Mastery for One Specific Term",
      description:
        "Answers 'how well do I actually know this word/kanji/grammar point'. Looks the " +
        "term up (search or direct get) and returns its embedded personal mastery data — " +
        "no separate schedule/list scanning needed, the API returns this directly on the " +
        "term object.\n\n" +
        "Args:\n" +
        "  - item_type ('word'|'kanji'|'grammar'): required\n" +
        "  - query (string): required — search term (English, romaji, kanji, hiragana), " +
        "OR for item_type 'kanji' you may pass the literal character directly\n\n" +
        "Returns:\n" +
        "{\n" +
        "  matched_term: { id/kanji, display, meaning, pitch (word only, null if unavailable), " +
        "jlpt (kanji: dedicated field; word: parsed from markers; grammar: omitted — not " +
        "confirmed available) },\n" +
        "  mastery: { correct_count, missed_count, mastery_avg_perc, study_vectors } | null,\n" +
        "  in_schedules: [{ sched_id, name, hasWord }],\n" +
        "  in_lists: [{ list_id, name, hasWord }]\n" +
        "}\n\n" +
        "mastery is null if you've never added this term to any list/schedule — that's a " +
        "real 'you haven't studied this yet', not an error.\n\n" +
        "Use when: 'do I actually know 「〜てみる」', 'have I mastered 食べる'.",
      inputSchema: z.object({ item_type: ItemTypeSchema, query: z.string().min(1) }).strict().shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        let term: Word | Kanji | Grammar | undefined;

        if (params.item_type === "word") {
          const results = await client.searchWords(params.query, 1);
          term = results.words?.[0];
        } else if (params.item_type === "kanji") {
          // Kanji search returns lightweight summaries only; do a direct
          // get on the character for full detail including user_data.
          term = await client.getKanji(params.query).catch(() => undefined);
          if (!term) {
            const results = await client.searchKanji(params.query);
            const first = results.kanjis?.[0];
            if (first) term = await client.getKanji(first.kanji);
          }
        } else {
          const results = await client.searchGrammar(params.query, 1);
          term = results.grammar?.[0];
        }

        if (!term) {
          return jsonResult({
            matched_term: null,
            mastery: null,
            in_schedules: [],
            in_lists: [],
            note: `No ${params.item_type} matched "${params.query}".`,
          });
        }

        const display =
          params.item_type === "word"
            ? (term as Word).kanji_full || (term as Word).hiragana_full
            : params.item_type === "kanji"
            ? (term as Kanji).kanji
            : (term as Grammar).title_japanese;

        const meaning =
          params.item_type === "word"
            ? (term as Word).def
            : params.item_type === "kanji"
            ? (term as Kanji).definition
            : (term as Grammar).meaning;

        return jsonResult({
          matched_term: {
            id: (term as Word | Grammar).id ?? (term as Kanji).kanji,
            display,
            meaning,
            pitch: params.item_type === "word" ? (term as Word).pitch ?? null : undefined,
            jlpt:
              params.item_type === "kanji"
                ? (term as Kanji).jlpt ?? null
                : params.item_type === "word"
                ? (term as Word).markers?.find((m) => /jlpt/i.test(m)) ?? null
                : undefined, // not confirmed available for grammar — omitted rather than guessed
          },
          mastery: term.user_data ?? null,
          in_schedules: term.presence?.scheds ?? [],
          in_lists: term.presence?.lists ?? [],
          note: term.user_data
            ? undefined
            : "This term isn't in any of your lists/schedules yet, so renshuu has no mastery data for it.",
        });
      } catch (err) {
        return errorResult(err, "Checking item progress");
      }
    }
  );
}

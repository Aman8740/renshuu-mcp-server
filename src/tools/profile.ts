import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RenshuuClient } from "../renshuu/client.js";
import { errorResult, jsonResult } from "../services/formatting.js";

export function registerProfileTools(server: McpServer, client: RenshuuClient): void {
  server.registerTool(
    "renshuu_get_profile",
    {
      title: "Get renshuu Profile and Study Stats",
      description:
        "Fetch the authenticated user's full profile. There is no separate /stats " +
        "endpoint in renshuu's API — this single call carries everything: today's/total " +
        "study counts, JLPT-level progress percentages per category, and study streaks.\n\n" +
        "Returns:\n" +
        "  - real_name, adventure_level, user_length\n" +
        "  - studied: { today_all, today_vocab, today_grammar, today_kanji, today_sent, " +
        "today_conj, today_aconj, total, total_vocab, total_kanji, total_grammar, total_sent }\n" +
        "  - level_progress_percs: { vocab, kanji, grammar, sent } — each an object like " +
        "{ n1, n2, n3, n4, n5 } giving PERCENT COMPLETE of that JLPT level's material. " +
        "This is the single best number for 'am I ready for N2' — e.g. " +
        "level_progress_percs.vocab.n2 = 65 means 65% of N2 vocabulary is done.\n" +
        "  - streaks: { vocab, kanji, grammar, sent, conj, aconj } — each with " +
        "correct_in_a_row, days_studied_in_a_row, and all-time variants\n\n" +
        "Use when: 'how close am I to N2', 'what's my current streak', 'how much have I studied today'.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return jsonResult(await client.getProfile());
      } catch (err) {
        return errorResult(err, "Fetching renshuu profile");
      }
    }
  );
}

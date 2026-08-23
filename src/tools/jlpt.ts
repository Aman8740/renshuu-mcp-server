import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RenshuuClient } from "../renshuu/client.js";
import { errorResult, jsonResult } from "../services/formatting.js";

/**
 * Composite workflow tool. Corrected against the real API: JLPT-level
 * progress lives directly on /profile's level_progress_percs field (no
 * separate /stats call needed), so this now just reads that plus schedule
 * names matching the requested level.
 */

function matchesLevel(name: string, level: string): boolean {
  return name.toLowerCase().includes(level.toLowerCase());
}

export function registerJlptTools(server: McpServer, client: RenshuuClient): void {
  server.registerTool(
    "renshuu_get_jlpt_progress",
    {
      title: "Get JLPT Level Progress Summary",
      description:
        "Composite view for judging JLPT readiness at a given level. Pulls " +
        "level_progress_percs directly from the profile (percent complete for that level, " +
        "per category: vocab/kanji/grammar/sent) and cross-references schedules whose name " +
        "matches the level string.\n\n" +
        "Args:\n" +
        "  - level ('n1'|'n2'|'n3'|'n4'|'n5'|'n6'): required, lowercase\n\n" +
        "Returns:\n" +
        "{\n" +
        "  level: string,\n" +
        "  percent_complete: { vocab, kanji, grammar, sent },  // 0-100 each\n" +
        "  matching_schedules: [{ id, name, today: {review, new}, terms: {...} }],\n" +
        "  total_review_due_today: number,\n" +
        "  total_new_due_today: number\n" +
        "}\n\n" +
        "Use when: 'how close am I to N2', 'what's my N2 grammar completion'.\n" +
        "Don't use when: you need item-level detail — use renshuu_get_schedule_terms.",
      inputSchema: z.object({ level: z.enum(["n1", "n2", "n3", "n4", "n5", "n6"]) }).strict().shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const [profile, schedules] = await Promise.all([client.getProfile(), client.getSchedules()]);

        const percentComplete = {
          vocab: profile.level_progress_percs.vocab[params.level] ?? null,
          kanji: profile.level_progress_percs.kanji[params.level] ?? null,
          grammar: profile.level_progress_percs.grammar[params.level] ?? null,
          sent: profile.level_progress_percs.sent[params.level] ?? null,
        };

        const matchingSchedules = schedules.schedules.filter((s) => matchesLevel(s.name, params.level));
        const totalReviewDue = matchingSchedules.reduce((sum, s) => sum + (s.today?.review ?? 0), 0);
        const totalNewDue = matchingSchedules.reduce((sum, s) => sum + (s.today?.new ?? 0), 0);

        return jsonResult({
          level: params.level,
          percent_complete: percentComplete,
          matching_schedules: matchingSchedules,
          total_review_due_today: totalReviewDue,
          total_new_due_today: totalNewDue,
          note:
            matchingSchedules.length === 0
              ? `No schedules matched "${params.level}" by name — percent_complete above ` +
                `still reflects your real progress (it comes from your profile, not schedule ` +
                `names), but you have no schedule specifically named for this level.`
              : undefined,
        });
      } catch (err) {
        return errorResult(err, "Building JLPT progress summary");
      }
    }
  );
}

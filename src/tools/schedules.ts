import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RenshuuClient } from "../renshuu/client.js";
import { errorResult, jsonResult } from "../services/formatting.js";

const GROUP_VALUES = [
  "all", "blocked", "studied", "notyetstudied", "cannot_study", "review_today",
  "mastery_1", "mastery_2", "mastery_3", "mastery_4", "mastery_5",
  "mastery_6", "mastery_7", "mastery_8", "mastery_9",
] as const;

export function registerScheduleTools(server: McpServer, client: RenshuuClient): void {
  server.registerTool(
    "renshuu_get_schedules",
    {
      title: "List renshuu Schedules",
      description:
        "List all of the user's study schedules (e.g. 'N2 Vocabulary'), each with today's " +
        "review/new counts, upcoming review load, and overall term completion stats.\n\n" +
        "Returns: { schedules: [{ id, name, is_frozen, today: {review, new}, " +
        "upcoming: [{days_in_future, terms_to_review}], " +
        "terms: {total_count, studied_count, unstudied_count, hidden_count}, " +
        "new_terms: {today_count, rolling_week_count} }] }\n\n" +
        "Use when: 'what am I currently studying', 'how much is left to learn'.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return jsonResult(await client.getSchedules());
      } catch (err) {
        return errorResult(err, "Fetching renshuu schedules");
      }
    }
  );

  server.registerTool(
    "renshuu_get_schedule",
    {
      title: "Get One renshuu Schedule",
      description:
        "Fetch metadata for a single schedule by ID (same shape as one entry from " +
        "renshuu_get_schedules, just scoped to one).\n\n" +
        "Args:\n  - schedule_id (string): required, from renshuu_get_schedules\n\n" +
        "Don't use when: you want the actual terms inside it — use renshuu_get_schedule_terms.",
      inputSchema: z.object({ schedule_id: z.string().min(1) }).strict().shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        return jsonResult(await client.getSchedule(params.schedule_id));
      } catch (err) {
        return errorResult(err, "Fetching renshuu schedule");
      }
    }
  );

  server.registerTool(
    "renshuu_get_schedule_terms",
    {
      title: "Get Terms Inside a renshuu Schedule",
      description:
        "Fetch the actual word/kanji/grammar/sentence items inside a schedule, optionally " +
        "filtered to a group like 'review_today' or a specific mastery band.\n\n" +
        "Args:\n" +
        "  - schedule_id (string): required, from renshuu_get_schedules\n" +
        "  - pg (number): optional page number\n" +
        "  - group: optional, one of 'all'|'blocked'|'studied'|'notyetstudied'|" +
        "'cannot_study'|'review_today'|'mastery_1'..'mastery_9' (mastery bands run low to high)\n\n" +
        "Returns: { schedules: [...], contents: { result_count, total_pg, per_pg, pg, group, " +
        "terms: [Word|Kanji|Grammar|SimpleSentence, each with embedded user_data mastery info] } }\n\n" +
        "Use when: 'what's due for review today in my N2 schedule', 'show me terms I've mastered'.",
      inputSchema: z
        .object({
          schedule_id: z.string().min(1),
          pg: z.number().int().min(1).optional(),
          group: z.enum(GROUP_VALUES).optional(),
        })
        .strict().shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data = await client.getScheduleTerms(params.schedule_id, {
          pg: params.pg,
          group: params.group,
        });
        return jsonResult(data);
      } catch (err) {
        return errorResult(err, "Fetching renshuu schedule terms");
      }
    }
  );
}

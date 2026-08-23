import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RenshuuClient } from "../renshuu/client.js";
import { errorResult, jsonResult } from "../services/formatting.js";

export function registerListTools(server: McpServer, client: RenshuuClient): void {
  server.registerTool(
    "renshuu_get_lists",
    {
      title: "List renshuu Personal Lists (Grouped)",
      description:
        "List the user's personal lists, grouped by term type (vocab/kanji/grammar/sent) " +
        "and then by group/folder.\n\n" +
        "Returns: { termtype_groups: [{ termtype, list_count, groups: [{ list_count, " +
        "group_title, lists: [{ list_id, title, description, termtype, num_terms, privacy }] }] }] }\n\n" +
        "Use when: 'what custom lists do I have', before adding/removing items via the " +
        "add/remove tools.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return jsonResult(await client.getLists());
      } catch (err) {
        return errorResult(err, "Fetching renshuu lists");
      }
    }
  );

  server.registerTool(
    "renshuu_get_list_contents",
    {
      title: "Get renshuu List Contents",
      description:
        "Fetch the items inside a specific personal list, including its own metadata.\n\n" +
        "Args:\n  - list_id (string): required, from renshuu_get_lists\n  - pg (number): optional page\n\n" +
        "Returns: { list_id, title, description, termtype, num_terms, privacy, " +
        "contents: { result_count, total_pg, per_pg, pg, terms: [...] } }",
      inputSchema: z.object({ list_id: z.string().min(1), pg: z.number().int().min(1).optional() }).strict().shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        return jsonResult(await client.getListContents(params.list_id, { pg: params.pg }));
      } catch (err) {
        return errorResult(err, "Fetching renshuu list contents");
      }
    }
  );

  server.registerTool(
    "renshuu_get_all_studied_terms",
    {
      title: "Get All Studied Terms of a Type",
      description:
        "Fetch every term of a given type (vocab/kanji/grammar/sent) the user has EVER " +
        "studied across renshuu, not scoped to one list or schedule. Useful for a full " +
        "account-wide sweep rather than a single collection.\n\n" +
        "Args:\n  - termtype ('vocab'|'kanji'|'grammar'|'semt'): required — 'semt' is a real 4th " +
        "category in renshuu's own termtype enum (confirmed against the live API), meaning " +
        "distinct from vocab/kanji/grammar. Its exact content isn't fully characterized — a " +
        "prior investigation flagged it as possibly idioms/set phrases, unconfirmed. Call " +
        "this tool with termtype='semt' to see actual returned content if you need to find out.\n" +
        "  - pg (number): optional page\n\n" +
        "Returns: { contents: { result_count, total_pg, per_pg, pg, terms: [...] } }\n\n" +
        "Don't use when: you only care about one specific list or schedule — that's cheaper " +
        "via renshuu_get_list_contents or renshuu_get_schedule_terms.",
      inputSchema: z
        .object({
          termtype: z.enum(["vocab", "kanji", "grammar", "semt"]),
          pg: z.number().int().min(1).optional(),
        })
        .strict().shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        return jsonResult(await client.getAllStudiedTerms(params.termtype, { pg: params.pg }));
      } catch (err) {
        return errorResult(err, "Fetching all studied terms");
      }
    }
  );
}

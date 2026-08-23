import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RenshuuClient } from "../renshuu/client.js";
import { errorResult, jsonResult } from "../services/formatting.js";

/**
 * Corrected against the real API: there is no generic "presence/adjust"
 * endpoint. Each term type has its own PUT (add) / DELETE (remove) on its
 * own resource path — /word/{id}, /kanji/{character}, /grammar/{id} — each
 * accepting optional list_id and/or sched_id query params. This file
 * dispatches to the right client method based on item_type while keeping
 * one consistent tool surface.
 *
 * Note on validation: the MCP inputSchema needs a plain ZodObject (for its
 * .shape to generate JSON Schema), so the "at least one of list_id/sched_id"
 * cross-field rule can't live in a .refine() there — it's checked manually
 * at the top of each handler instead.
 */

const ItemTypeSchema = z.enum(["word", "kanji", "grammar"]);

const PresenceInputShape = {
  item_type: ItemTypeSchema,
  identifier: z.string().min(1),
  list_id: z.string().optional(),
  sched_id: z.string().optional(),
};

function validateTarget(params: { list_id?: string; sched_id?: string }): string | null {
  if (!params.list_id && !params.sched_id) {
    return "At least one of list_id or sched_id must be provided.";
  }
  return null;
}

export function registerPresenceTools(server: McpServer, client: RenshuuClient): void {
  server.registerTool(
    "renshuu_add_term",
    {
      title: "Add a Word/Kanji/Grammar to a List or Schedule",
      description:
        "Add a term to a personal list and/or a study schedule. MUTATES the user's " +
        "renshuu account data.\n\n" +
        "Args:\n" +
        "  - item_type ('word'|'kanji'|'grammar'): required\n" +
        "  - identifier (string): required — word/grammar ID, OR the literal kanji " +
        "character itself if item_type is 'kanji' (e.g. '食', not a numeric id)\n" +
        "  - list_id (string, optional): target list, from renshuu_get_lists\n" +
        "  - sched_id (string, optional): target schedule, from renshuu_get_schedules\n" +
        "  (at least one of list_id / sched_id is required)\n\n" +
        "Returns success confirmation, or a 409 error if it's already present.",
      inputSchema: PresenceInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      const validationError = validateTarget(params);
      if (validationError) {
        return { content: [{ type: "text" as const, text: `Error: ${validationError}` }], isError: true };
      }
      try {
        const target = { list_id: params.list_id, sched_id: params.sched_id };
        let data: unknown;
        if (params.item_type === "word") data = await client.addWordTo(params.identifier, target);
        else if (params.item_type === "kanji") data = await client.addKanjiTo(params.identifier, target);
        else data = await client.addGrammarTo(params.identifier, target);
        return jsonResult(data ?? { success: true });
      } catch (err) {
        return errorResult(err, "Adding term to list/schedule");
      }
    }
  );

  server.registerTool(
    "renshuu_remove_term",
    {
      title: "Remove a Word/Kanji/Grammar from a List or Schedule",
      description:
        "Remove a term from a personal list and/or a study schedule. MUTATES the user's " +
        "renshuu account data.\n\n" +
        "Args: same as renshuu_add_term — item_type, identifier, and at least one of " +
        "list_id / sched_id.\n\n" +
        "Returns success confirmation, or a 409 error if it wasn't present.",
      inputSchema: PresenceInputShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      const validationError = validateTarget(params);
      if (validationError) {
        return { content: [{ type: "text" as const, text: `Error: ${validationError}` }], isError: true };
      }
      try {
        const target = { list_id: params.list_id, sched_id: params.sched_id };
        let data: unknown;
        if (params.item_type === "word") data = await client.removeWordFrom(params.identifier, target);
        else if (params.item_type === "kanji") data = await client.removeKanjiFrom(params.identifier, target);
        else data = await client.removeGrammarFrom(params.identifier, target);
        return jsonResult(data ?? { success: true });
      } catch (err) {
        return errorResult(err, "Removing term from list/schedule");
      }
    }
  );
}

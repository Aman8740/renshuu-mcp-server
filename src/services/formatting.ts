/**
 * Shared helpers for turning API data into MCP tool responses, and for
 * consistent error-to-text conversion. Centralized here so no tool file
 * duplicates this logic (per MCP best practices).
 */

import { CHARACTER_LIMIT } from "../constants.js";
import { RenshuuApiError, RenshuuAuthError, RenshuuRateLimitError } from "../renshuu/errors.js";

export interface ToolTextResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Wraps a JSON-serializable payload as a tool result, truncating if huge. */
export function jsonResult(data: unknown): ToolTextResult {
  let text = JSON.stringify(data, null, 2);
  if (text.length > CHARACTER_LIMIT) {
    text =
      text.slice(0, CHARACTER_LIMIT) +
      `\n\n[Truncated: response exceeded ${CHARACTER_LIMIT} characters. ` +
      `Narrow your query (e.g. add a page or filter parameter) for full detail.]`;
  }
  return {
    content: [{ type: "text", text }],
    structuredContent: typeof data === "object" && data !== null ? (data as Record<string, unknown>) : undefined,
  };
}

/** Converts a thrown error into an actionable tool error result. */
export function errorResult(err: unknown, context: string): ToolTextResult {
  let message: string;

  if (err instanceof RenshuuAuthError) {
    message = err.message;
  } else if (err instanceof RenshuuRateLimitError) {
    message = err.message;
  } else if (err instanceof RenshuuApiError) {
    message = `${context} failed (status ${err.status ?? "unknown"}): ${err.message}`;
  } else if (err instanceof Error) {
    message = `${context} failed: ${err.message}`;
  } else {
    message = `${context} failed with an unknown error: ${String(err)}`;
  }

  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Redis key layout (all under the same Upstash instance, no separate DB
 * needed — key prefixes keep things organized):
 *
 *   events:recent            LIST, capped to 2000 — JSON per MCP request, newest first
 *   errors:recent            LIST, capped to 500  — JSON per FAILED MCP request only
 *   oauth:events             LIST, capped to 1000 — JSON per OAuth funnel step
 *
 *   stats:alltime            HASH — total, errors, tool:<name> (all-time counters)
 *   stats:daily:<YYYY-MM-DD> HASH — same fields, one per calendar day (UTC)
 *   stats:hourly:<YYYY-MM-DDTHH> HASH — same fields, one per hour, TTL'd after 72h
 *
 *   users:all                 SET  — every userHash ever seen
 *   users:daily:<YYYY-MM-DD>  SET  — userHashes seen that day (for unique-users-today)
 *   users:meta:<userHash>     HASH — first_seen, last_seen, total_calls
 *
 * Every write in this file goes through a single Redis pipeline per event
 * (one HTTP round trip to Upstash, not N), and every exported function
 * swallows its own errors — see redis.ts for why that matters here.
 */

import { getRedis, withTimeout } from "./redis.js";

const REDIS_TIMEOUT_MS = 1500;
const RECENT_EVENTS_CAP = 2000;
const RECENT_ERRORS_CAP = 500;
const OAUTH_EVENTS_CAP = 1000;
const HOURLY_BUCKET_TTL_SECONDS = 60 * 60 * 72; // 72h — hourly detail isn't needed longer than that

export type AuthMethod = "header" | "oauth" | "env_fallback";

export interface McpEvent {
  ts: number;
  method: string; // e.g. "initialize", "tools/list", "tools/call"
  toolName?: string; // present when method === "tools/call"
  userHash?: string; // absent if no key could be resolved at all
  authMethod: AuthMethod | "none";
  success: boolean; // HTTP status + a heuristic scan of the response body for a JSON-RPC error
  durationMs: number;
}

export type OAuthEventType =
  | "client_registered"
  | "authorize_shown"
  | "login_success"
  | "login_failed"
  | "token_issued"
  | "token_refreshed"
  | "token_exchange_failed";

export interface OAuthEvent {
  ts: number;
  type: OAuthEventType;
  clientIdPrefix?: string; // first 12 chars only — enough to correlate, not enough to be the real client_id
}

function dateKeyUTC(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD
}

function hourKeyUTC(ts: number): string {
  return new Date(ts).toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

export async function logMcpEvent(event: McpEvent): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  await withTimeout(
    (async () => {
      const day = dateKeyUTC(event.ts);
      const hour = hourKeyUTC(event.ts);
      const toolField = event.toolName ? `tool:${event.toolName}` : undefined;

      const pipeline = redis.pipeline();

      pipeline.lpush("events:recent", JSON.stringify(event));
      pipeline.ltrim("events:recent", 0, RECENT_EVENTS_CAP - 1);

      pipeline.hincrby("stats:alltime", "total", 1);
      pipeline.hincrby(`stats:daily:${day}`, "total", 1);
      pipeline.hincrby(`stats:hourly:${hour}`, "total", 1);
      pipeline.expire(`stats:hourly:${hour}`, HOURLY_BUCKET_TTL_SECONDS);

      pipeline.hincrby("stats:alltime", "duration_sum_ms", Math.round(event.durationMs));
      pipeline.hincrby(`stats:daily:${day}`, "duration_sum_ms", Math.round(event.durationMs));

      if (!event.success) {
        pipeline.hincrby("stats:alltime", "errors", 1);
        pipeline.hincrby(`stats:daily:${day}`, "errors", 1);
        pipeline.hincrby(`stats:hourly:${hour}`, "errors", 1);
        pipeline.lpush("errors:recent", JSON.stringify(event));
        pipeline.ltrim("errors:recent", 0, RECENT_ERRORS_CAP - 1);
      }

      if (toolField) {
        pipeline.hincrby("stats:alltime", toolField, 1);
        pipeline.hincrby(`stats:daily:${day}`, toolField, 1);
      }

      pipeline.hincrby(`stats:daily:${day}`, `auth:${event.authMethod}`, 1);
      pipeline.hincrby("stats:alltime", `auth:${event.authMethod}`, 1);

      if (event.userHash) {
        pipeline.sadd("users:all", event.userHash);
        pipeline.sadd(`users:daily:${day}`, event.userHash);
        pipeline.hset(`users:meta:${event.userHash}`, { last_seen: event.ts });
        pipeline.hsetnx(`users:meta:${event.userHash}`, "first_seen", event.ts);
        pipeline.hincrby(`users:meta:${event.userHash}`, "total_calls", 1);
      }

      await pipeline.exec();
    })(),
    REDIS_TIMEOUT_MS
  );
}

export async function logOAuthEvent(event: OAuthEvent): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  await withTimeout(
    (async () => {
      const pipeline = redis.pipeline();
      pipeline.lpush("oauth:events", JSON.stringify(event));
      pipeline.ltrim("oauth:events", 0, OAUTH_EVENTS_CAP - 1);
      pipeline.hincrby("stats:oauth_funnel", event.type, 1);
      await pipeline.exec();
    })(),
    REDIS_TIMEOUT_MS
  );
}

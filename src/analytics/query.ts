/**
 * Read side for the admin dashboard. Every function here returns a sane
 * empty/zeroed shape (never throws) if Redis isn't configured or a call
 * fails — the dashboard should render "no data yet", not crash, on a fresh
 * deployment that hasn't had UPSTASH_* set yet.
 */

import { getRedis, withTimeout } from "./redis.js";
import type { McpEvent, OAuthEvent, OAuthEventType } from "./log.js";

const REDIS_TIMEOUT_MS = 3000;

function dateKeyUTC(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
function hourKeyUTC(ts: number): string {
  return new Date(ts).toISOString().slice(0, 13);
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

interface StatsHash {
  total: number;
  errors: number;
  duration_sum_ms: number;
  tools: Record<string, number>;
  auth: Record<string, number>;
}

function parseStatsHash(raw: Record<string, unknown> | null): StatsHash {
  const out: StatsHash = { total: 0, errors: 0, duration_sum_ms: 0, tools: {}, auth: {} };
  if (!raw) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (key === "total") out.total = toNumber(value);
    else if (key === "errors") out.errors = toNumber(value);
    else if (key === "duration_sum_ms") out.duration_sum_ms = toNumber(value);
    else if (key.startsWith("tool:")) out.tools[key.slice("tool:".length)] = toNumber(value);
    else if (key.startsWith("auth:")) out.auth[key.slice("auth:".length)] = toNumber(value);
  }
  return out;
}

export interface Overview {
  configured: boolean;
  totalRequestsAllTime: number;
  totalErrorsAllTime: number;
  errorRateAllTime: number; // 0-1
  avgDurationMsAllTime: number;
  requestsToday: number;
  errorsToday: number;
  errorRateToday: number;
  uniqueUsersAllTime: number;
  uniqueUsersToday: number;
}

export async function getOverview(): Promise<Overview> {
  const empty: Overview = {
    configured: false,
    totalRequestsAllTime: 0,
    totalErrorsAllTime: 0,
    errorRateAllTime: 0,
    avgDurationMsAllTime: 0,
    requestsToday: 0,
    errorsToday: 0,
    errorRateToday: 0,
    uniqueUsersAllTime: 0,
    uniqueUsersToday: 0,
  };

  const redis = getRedis();
  if (!redis) return empty;

  const result = await withTimeout(
    (async () => {
      const today = dateKeyUTC(Date.now());
      const [alltimeRaw, dailyRaw, uniqueAllTime, uniqueToday] = await Promise.all([
        redis.hgetall<Record<string, unknown>>("stats:alltime"),
        redis.hgetall<Record<string, unknown>>(`stats:daily:${today}`),
        redis.scard("users:all"),
        redis.scard(`users:daily:${today}`),
      ]);

      const alltime = parseStatsHash(alltimeRaw);
      const daily = parseStatsHash(dailyRaw);

      return {
        configured: true,
        totalRequestsAllTime: alltime.total,
        totalErrorsAllTime: alltime.errors,
        errorRateAllTime: alltime.total > 0 ? alltime.errors / alltime.total : 0,
        avgDurationMsAllTime: alltime.total > 0 ? Math.round(alltime.duration_sum_ms / alltime.total) : 0,
        requestsToday: daily.total,
        errorsToday: daily.errors,
        errorRateToday: daily.total > 0 ? daily.errors / daily.total : 0,
        uniqueUsersAllTime: toNumber(uniqueAllTime),
        uniqueUsersToday: toNumber(uniqueToday),
      };
    })(),
    REDIS_TIMEOUT_MS
  );

  return result ?? empty;
}

export interface TimeseriesPoint {
  bucket: string; // ISO date or ISO date+hour
  total: number;
  errors: number;
}

/** range: "24h" gives hourly points for the last 24 hours; "30d" gives daily points for the last 30 days. */
export async function getTimeseries(range: "24h" | "30d"): Promise<TimeseriesPoint[]> {
  const redis = getRedis();
  if (!redis) return [];

  const result = await withTimeout(
    (async () => {
      const now = Date.now();
      const points: TimeseriesPoint[] = [];

      if (range === "24h") {
        const keys: string[] = [];
        const labels: string[] = [];
        for (let i = 23; i >= 0; i--) {
          const t = now - i * 60 * 60 * 1000;
          keys.push(`stats:hourly:${hourKeyUTC(t)}`);
          labels.push(hourKeyUTC(t));
        }
        const raws = await Promise.all(keys.map((k) => redis.hgetall<Record<string, unknown>>(k)));
        raws.forEach((raw, i) => {
          const parsed = parseStatsHash(raw ?? null);
          points.push({ bucket: labels[i], total: parsed.total, errors: parsed.errors });
        });
      } else {
        const keys: string[] = [];
        const labels: string[] = [];
        for (let i = 29; i >= 0; i--) {
          const t = now - i * 24 * 60 * 60 * 1000;
          keys.push(`stats:daily:${dateKeyUTC(t)}`);
          labels.push(dateKeyUTC(t));
        }
        const raws = await Promise.all(keys.map((k) => redis.hgetall<Record<string, unknown>>(k)));
        raws.forEach((raw, i) => {
          const parsed = parseStatsHash(raw ?? null);
          points.push({ bucket: labels[i], total: parsed.total, errors: parsed.errors });
        });
      }

      return points;
    })(),
    REDIS_TIMEOUT_MS
  );

  return result ?? [];
}

export interface ToolBreakdownEntry {
  tool: string;
  callsAllTime: number;
  callsToday: number;
}

export async function getToolBreakdown(): Promise<ToolBreakdownEntry[]> {
  const redis = getRedis();
  if (!redis) return [];

  const result = await withTimeout(
    (async () => {
      const today = dateKeyUTC(Date.now());
      const [alltimeRaw, dailyRaw] = await Promise.all([
        redis.hgetall<Record<string, unknown>>("stats:alltime"),
        redis.hgetall<Record<string, unknown>>(`stats:daily:${today}`),
      ]);
      const alltime = parseStatsHash(alltimeRaw);
      const daily = parseStatsHash(dailyRaw);

      const names = new Set([...Object.keys(alltime.tools), ...Object.keys(daily.tools)]);
      return Array.from(names)
        .map((tool) => ({
          tool,
          callsAllTime: alltime.tools[tool] ?? 0,
          callsToday: daily.tools[tool] ?? 0,
        }))
        .sort((a, b) => b.callsAllTime - a.callsAllTime);
    })(),
    REDIS_TIMEOUT_MS
  );

  return result ?? [];
}

export async function getAuthMethodBreakdown(): Promise<Record<string, number>> {
  const redis = getRedis();
  if (!redis) return {};

  const result = await withTimeout(
    redis.hgetall<Record<string, unknown>>("stats:alltime"),
    REDIS_TIMEOUT_MS
  );

  return parseStatsHash(result ?? null).auth;
}

export async function getRecentEvents(limit = 100): Promise<McpEvent[]> {
  const redis = getRedis();
  if (!redis) return [];

  const result = await withTimeout(redis.lrange("events:recent", 0, limit - 1), REDIS_TIMEOUT_MS);
  if (!result) return [];
  return result
    .map((raw) => {
      try {
        return typeof raw === "string" ? (JSON.parse(raw) as McpEvent) : (raw as McpEvent);
      } catch {
        return null;
      }
    })
    .filter((e): e is McpEvent => e !== null);
}

export async function getRecentErrors(limit = 50): Promise<McpEvent[]> {
  const redis = getRedis();
  if (!redis) return [];

  const result = await withTimeout(redis.lrange("errors:recent", 0, limit - 1), REDIS_TIMEOUT_MS);
  if (!result) return [];
  return result
    .map((raw) => {
      try {
        return typeof raw === "string" ? (JSON.parse(raw) as McpEvent) : (raw as McpEvent);
      } catch {
        return null;
      }
    })
    .filter((e): e is McpEvent => e !== null);
}

export interface UserRow {
  userHash: string;
  firstSeen: number;
  lastSeen: number;
  totalCalls: number;
}

export async function getUsers(limit = 200): Promise<UserRow[]> {
  const redis = getRedis();
  if (!redis) return [];

  const result = await withTimeout(
    (async () => {
      const userHashes = await redis.smembers("users:all");
      const capped = userHashes.slice(0, limit);
      const metas = await Promise.all(
        capped.map((h) => redis.hgetall<Record<string, unknown>>(`users:meta:${h}`))
      );
      return capped
        .map((userHash, i) => {
          const meta = metas[i];
          if (!meta) return null;
          return {
            userHash,
            firstSeen: toNumber(meta.first_seen),
            lastSeen: toNumber(meta.last_seen),
            totalCalls: toNumber(meta.total_calls),
          };
        })
        .filter((r): r is UserRow => r !== null)
        .sort((a, b) => b.lastSeen - a.lastSeen);
    })(),
    REDIS_TIMEOUT_MS
  );

  return result ?? [];
}

export async function getOAuthFunnel(): Promise<Record<OAuthEventType, number>> {
  const empty: Record<OAuthEventType, number> = {
    client_registered: 0,
    authorize_shown: 0,
    login_success: 0,
    login_failed: 0,
    token_issued: 0,
    token_refreshed: 0,
    token_exchange_failed: 0,
  };

  const redis = getRedis();
  if (!redis) return empty;

  const result = await withTimeout(
    redis.hgetall<Record<string, unknown>>("stats:oauth_funnel"),
    REDIS_TIMEOUT_MS
  );
  if (!result) return empty;

  for (const key of Object.keys(empty) as OAuthEventType[]) {
    empty[key] = toNumber(result[key]);
  }
  return empty;
}

export async function getRecentOAuthEvents(limit = 100): Promise<OAuthEvent[]> {
  const redis = getRedis();
  if (!redis) return [];

  const result = await withTimeout(redis.lrange("oauth:events", 0, limit - 1), REDIS_TIMEOUT_MS);
  if (!result) return [];
  return result
    .map((raw) => {
      try {
        return typeof raw === "string" ? (JSON.parse(raw) as OAuthEvent) : (raw as OAuthEvent);
      } catch {
        return null;
      }
    })
    .filter((e): e is OAuthEvent => e !== null);
}

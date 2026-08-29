/**
 * Analytics storage. Uses Upstash Redis specifically because it's REST-based
 * (a plain HTTP call per command) rather than a persistent TCP connection —
 * that matters on Vercel, where a serverless function can't keep a normal
 * Redis connection alive between invocations the way a long-running server
 * could.
 *
 * Analytics are explicitly best-effort and MUST NEVER break the actual MCP
 * server. If UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN aren't set,
 * every function in this module degrades to a no-op — tool calls keep
 * working exactly as before, you just get an empty dashboard until storage
 * is configured. Nothing here throws in a way that reaches the /mcp
 * response path.
 */

import { Redis } from "@upstash/redis";

let cachedClient: Redis | null | undefined; // undefined = not checked yet, null = confirmed unconfigured

export function getRedis(): Redis | null {
  if (cachedClient !== undefined) return cachedClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    cachedClient = null;
    return null;
  }

  cachedClient = new Redis({ url, token });
  return cachedClient;
}

export function isAnalyticsConfigured(): boolean {
  return getRedis() !== null;
}

/** Races a promise against a timeout so a slow/hanging Redis call can never stall the real response. */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(undefined);
      });
  });
}

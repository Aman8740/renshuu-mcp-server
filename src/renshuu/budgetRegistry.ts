/**
 * Per-API-key daily request budget, shared across RenshuuClient instances
 * within the same process.
 *
 * Why this exists: in multi-tenant HTTP mode, a fresh RenshuuClient is
 * built for every incoming request (so different users' requests never
 * share state by accident). If the request-budget counter lived on the
 * client instance itself, it would reset on every single request and
 * never actually track anything. This registry keys the counter by a
 * hash of the API key instead, so repeated requests from the SAME user
 * share one running count, while different users' counts stay isolated
 * from each other.
 *
 * Honesty about limits: this is an in-memory, process-local, best-effort
 * guard — not authoritative. It resets on process restart and does NOT
 * share state across multiple server instances (e.g. several Vercel
 * function invocations, or a horizontally-scaled deployment). Renshuu's
 * own server-side 429 response is the real enforcement; this just avoids
 * some wasted round-trips in the common case of a single long-lived
 * process (stdio mode, or a traditional persistent HTTP host).
 */

import { createHash } from "node:crypto";
import { RenshuuRateLimitError } from "./errors.js";

class DailyBudget {
  private count = 0;
  private day = new Date().toISOString().slice(0, 10);

  consume(limit: number): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
    }
    if (this.count >= limit) {
      throw new RenshuuRateLimitError(limit);
    }
    this.count += 1;
  }

  get used(): number {
    return this.count;
  }
}

/** Never index the registry by the raw key — only by an irreversible hash of it. */
function hashKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

const registry = new Map<string, DailyBudget>();

export function getBudgetFor(apiKey: string): DailyBudget {
  const hashed = hashKey(apiKey);
  let budget = registry.get(hashed);
  if (!budget) {
    budget = new DailyBudget();
    registry.set(hashed, budget);
  }
  return budget;
}

/** Exposed for tests only — clears all tracked budgets between test cases. */
export function _resetAllBudgetsForTesting(): void {
  registry.clear();
}

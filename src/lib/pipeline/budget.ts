/**
 * Daily generation budget.
 *
 * Gemini's free tier is a per-model, per-day quota — verified from a real 429,
 * whose payload named it `GenerateRequestsPerDayPerProjectPerModel-FreeTier`.
 * Once it's gone it's gone until midnight Pacific, so the interesting question
 * isn't how to avoid hitting it but what the site does when it does.
 *
 * Answer: serve everything already cached and say plainly that live analysis is
 * paused. A visitor reading a cached teardown never notices; someone asking for
 * a brand-new one gets an explanation rather than a stack trace.
 */

/** Deliberately below the real ceiling, so the fallback chain keeps headroom. */
export const DAILY_GENERATION_BUDGET = 800;

/**
 * Google's quotas reset at midnight Pacific, not UTC. Resetting our own count
 * at UTC midnight would leave a window where we think we have budget and the
 * API disagrees.
 */
export function pacificDayStart(now: Date = new Date()): Date {
  const pacificNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const offsetMs = now.getTime() - pacificNow.getTime();

  const midnightPacific = new Date(pacificNow);
  midnightPacific.setHours(0, 0, 0, 0);

  return new Date(midnightPacific.getTime() + offsetMs);
}

/**
 * Share of the day reserved for people actually using the site.
 *
 * Background work and visitor requests draw on the same quota, so without a
 * reserve a busy day of scheduled analysis could spend the budget before
 * anyone opened the page — the background job starving the interactive path,
 * which is the one that matters. Scheduled callers stop at 75%; visitors keep
 * the rest.
 */
export const INTERACTIVE_RESERVE = 0.25;

/** Who is asking. Scheduled work yields to visitors, not the other way round. */
export type BudgetCaller = "interactive" | "scheduled";

export interface BudgetState {
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
  resetsAt: string;
}

export function budgetState(
  used: number,
  now: Date = new Date(),
  caller: BudgetCaller = "interactive",
): BudgetState {
  const ceiling =
    caller === "scheduled"
      ? Math.floor(DAILY_GENERATION_BUDGET * (1 - INTERACTIVE_RESERVE))
      : DAILY_GENERATION_BUDGET;

  const remaining = Math.max(0, ceiling - used);

  const reset = pacificDayStart(now);
  reset.setDate(reset.getDate() + 1);

  return {
    used,
    limit: ceiling,
    remaining,
    exhausted: remaining === 0,
    resetsAt: reset.toISOString(),
  };
}

/**
 * Per-IP throttle, so one visitor holding down a key can't spend the day's
 * budget in a minute.
 *
 * In-memory, which on serverless means per-instance rather than global. That's
 * a real limitation and it's deliberate: a shared counter would need another
 * round trip to Postgres on every request, and the daily budget above is the
 * guarantee that actually matters. This just stops the obvious abuse.
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 8;

const hits = new Map<string, number[]>();

export function rateLimit(
  key: string,
  now = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const window = (hits.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (window.length >= RATE_LIMIT_MAX) {
    const oldest = window[0];
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000),
    };
  }

  window.push(now);
  hits.set(key, window);

  // Opportunistic cleanup so the map can't grow without bound on a long-lived
  // instance.
  if (hits.size > 5_000) {
    for (const [k, times] of hits) {
      if (times.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) hits.delete(k);
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Exposed for tests, which must not inherit counts from each other. */
export function resetRateLimits(): void {
  hits.clear();
}

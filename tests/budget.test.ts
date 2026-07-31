import { beforeEach, describe, expect, it } from "vitest";
import {
  budgetState,
  DAILY_GENERATION_BUDGET,
  pacificDayStart,
  rateLimit,
  resetRateLimits,
} from "@/lib/pipeline/budget";

describe("budgetState", () => {
  it("reports remaining headroom", () => {
    const s = budgetState(100);
    expect(s.limit).toBe(DAILY_GENERATION_BUDGET);
    expect(s.remaining).toBe(DAILY_GENERATION_BUDGET - 100);
    expect(s.exhausted).toBe(false);
  });

  it("flags exhaustion at the ceiling", () => {
    expect(budgetState(DAILY_GENERATION_BUDGET).exhausted).toBe(true);
  });

  it("never reports negative remaining when the count overshoots", () => {
    // Concurrent requests can push the stored count past the limit.
    const s = budgetState(DAILY_GENERATION_BUDGET + 25);
    expect(s.remaining).toBe(0);
    expect(s.exhausted).toBe(true);
  });

  it("sits below the real free-tier ceiling so the fallback chain keeps headroom", () => {
    expect(DAILY_GENERATION_BUDGET).toBeLessThan(1000);
  });

  it("reports a reset time in the future", () => {
    const now = new Date("2026-07-31T12:00:00Z");
    expect(new Date(budgetState(0, now).resetsAt).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("pacificDayStart", () => {
  it("resets on Pacific midnight, not UTC midnight", () => {
    // 03:00 UTC on the 31st is still the 30th in Los Angeles. Using UTC would
    // reset our counter while Google's quota had not.
    const start = pacificDayStart(new Date("2026-07-31T03:00:00Z"));
    const pacificDate = start.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" });
    expect(pacificDate).toBe("7/30/2026");
  });

  it("is never in the future", () => {
    const now = new Date("2026-07-31T12:00:00Z");
    expect(pacificDayStart(now).getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows a normal burst", () => {
    for (let i = 0; i < 8; i++) {
      expect(rateLimit("1.2.3.4").allowed).toBe(true);
    }
  });

  it("blocks once the window is full", () => {
    for (let i = 0; i < 8; i++) rateLimit("1.2.3.4");
    const blocked = rateLimit("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps callers isolated from each other", () => {
    for (let i = 0; i < 8; i++) rateLimit("1.2.3.4");
    expect(rateLimit("5.6.7.8").allowed).toBe(true);
  });

  it("lets a caller back in once the window rolls past", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 8; i++) rateLimit("1.2.3.4", t0);
    expect(rateLimit("1.2.3.4", t0 + 59_000).allowed).toBe(false);
    expect(rateLimit("1.2.3.4", t0 + 61_000).allowed).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { budgetState, DAILY_GENERATION_BUDGET, INTERACTIVE_RESERVE } from "@/lib/pipeline/budget";

const SCHEDULED_CEILING = Math.floor(DAILY_GENERATION_BUDGET * (1 - INTERACTIVE_RESERVE));

describe("interactive reserve", () => {
  it("gives visitors the whole budget", () => {
    expect(budgetState(0, new Date(), "interactive").limit).toBe(DAILY_GENERATION_BUDGET);
  });

  it("caps scheduled work below the full budget", () => {
    expect(budgetState(0, new Date(), "scheduled").limit).toBe(SCHEDULED_CEILING);
    expect(SCHEDULED_CEILING).toBeLessThan(DAILY_GENERATION_BUDGET);
  });

  it("stops scheduled work while visitors still have budget left", () => {
    // The whole point: a busy background day must not lock out the page.
    const used = SCHEDULED_CEILING;
    expect(budgetState(used, new Date(), "scheduled").exhausted).toBe(true);
    expect(budgetState(used, new Date(), "interactive").exhausted).toBe(false);
    expect(budgetState(used, new Date(), "interactive").remaining).toBe(
      DAILY_GENERATION_BUDGET - SCHEDULED_CEILING,
    );
  });

  it("still exhausts interactive requests at the real ceiling", () => {
    expect(budgetState(DAILY_GENERATION_BUDGET, new Date(), "interactive").exhausted).toBe(true);
  });

  it("defaults to the interactive ceiling when no caller is given", () => {
    // Defaulting the other way would silently throttle visitors.
    expect(budgetState(0).limit).toBe(DAILY_GENERATION_BUDGET);
  });
});

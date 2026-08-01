import { describe, expect, it } from "vitest";
import { buildHistory, lastCheckedAt, newestUnanalyzed } from "@/lib/pipeline/history";
import { makeTriage } from "./fakes";
import type { FlankerEventWithApp, ObservedRelease } from "@/lib/storage/types";

function release(version: string, releaseDate: string | null, notes = "notes"): ObservedRelease {
  return {
    itunesTrackId: 1,
    version,
    releaseNotes: notes,
    releaseDate,
    firstSeenAt: "2026-07-31T00:00:00.000Z",
  };
}

function event(version: string, releaseDate: string | null, detectedAt = "2026-07-31T00:00:00.000Z"): FlankerEventWithApp {
  return {
    id: `e-${version}`,
    appId: "app-1",
    version,
    releaseNotes: "notes",
    releaseDate,
    llmOutput: makeTriage(),
    signalLevel: "high",
    model: "test",
    detectedAt,
    app: { id: "app-1", name: "Test", itunesTrackId: 1 },
  };
}

describe("buildHistory", () => {
  it("shows observed versions that were never analysed", async () => {
    // The whole point of the split: history is as long as what the sweep saw.
    const entries = buildHistory(
      [release("3.0", "2026-07-30T00:00:00Z"), release("2.0", "2026-07-10T00:00:00Z")],
      [],
    );
    expect(entries.map((e) => e.kind)).toEqual(["detected", "detected"]);
    expect(entries.map((e) => e.version)).toEqual(["3.0", "2.0"]);
  });

  it("prefers the analysis over the bare observation of the same version", () => {
    const entries = buildHistory([release("3.0", "2026-07-30T00:00:00Z")], [event("3.0", "2026-07-30T00:00:00Z")]);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("analyzed");
  });

  it("interleaves analysed and detected versions by release date", () => {
    const entries = buildHistory(
      [
        release("3.0", "2026-07-30T00:00:00Z"),
        release("2.0", "2026-07-20T00:00:00Z"),
        release("1.0", "2026-07-10T00:00:00Z"),
      ],
      [event("2.0", "2026-07-20T00:00:00Z")],
    );
    expect(entries.map((e) => `${e.version}:${e.kind}`)).toEqual([
      "3.0:detected",
      "2.0:analyzed",
      "1.0:detected",
    ]);
  });

  it("keeps an analysed version the sweep never recorded", () => {
    // Apps analysed before joining the watch set have events with no matching
    // release row; dropping them would erase their own first analysis.
    const entries = buildHistory([release("3.0", "2026-07-30T00:00:00Z")], [event("1.0", "2026-01-01T00:00:00Z")]);
    expect(entries.map((e) => e.version)).toEqual(["3.0", "1.0"]);
    expect(entries[1].kind).toBe("analyzed");
  });

  it("matches versions across case and padding differences", () => {
    const entries = buildHistory([release(" 3.0-RC1 ", "2026-07-30T00:00:00Z")], [event("3.0-rc1", "2026-07-30T00:00:00Z")]);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("analyzed");
  });

  it("does not duplicate a version observed twice", () => {
    const entries = buildHistory(
      [release("3.0", "2026-07-30T00:00:00Z"), release("3.0", "2026-07-30T00:00:00Z")],
      [],
    );
    expect(entries).toHaveLength(1);
  });

  it("sorts undated releases last rather than first", () => {
    const entries = buildHistory(
      [release("2.0", null), release("3.0", "2026-07-30T00:00:00Z")],
      [],
    );
    expect(entries.map((e) => e.version)).toEqual(["3.0", "2.0"]);
  });

  it("returns nothing when there is nothing to show", () => {
    expect(buildHistory([], [])).toEqual([]);
  });
});

describe("newestUnanalyzed", () => {
  it("finds the newest version lacking an analysis", () => {
    const entries = buildHistory(
      [release("3.0", "2026-07-30T00:00:00Z"), release("2.0", "2026-07-20T00:00:00Z")],
      [event("2.0", "2026-07-20T00:00:00Z")],
    );
    expect(newestUnanalyzed(entries)).toBe("3.0");
  });

  it("returns null when everything is analysed", () => {
    const entries = buildHistory([release("3.0", "2026-07-30T00:00:00Z")], [event("3.0", "2026-07-30T00:00:00Z")]);
    expect(newestUnanalyzed(entries)).toBeNull();
  });

  it("skips older gaps and only offers the newest", () => {
    // Auto-analysis should spend one call on the top of the list, not
    // backfill every gap in the history.
    const entries = buildHistory(
      [
        release("3.0", "2026-07-30T00:00:00Z"),
        release("2.0", "2026-07-20T00:00:00Z"),
        release("1.0", "2026-07-10T00:00:00Z"),
      ],
      [event("2.0", "2026-07-20T00:00:00Z")],
    );
    expect(newestUnanalyzed(entries)).toBe("3.0");
  });
});

describe("lastCheckedAt", () => {
  const SWEEP = "2026-08-01T12:00:00.000Z";

  it("reports the sweep time for a monitored app, not its newest analysis", () => {
    // The bug this exists to prevent: an app checked an hour ago reading as
    // "17h ago" because that's when its last analysis ran.
    const result = lastCheckedAt(
      [release("3.0", "2026-07-30T00:00:00Z")],
      [event("3.0", "2026-07-30T00:00:00Z", "2026-07-31T19:00:00.000Z")],
      SWEEP,
    );
    expect(result).toEqual({ at: SWEEP, monitored: true });
  });

  it("reports the sweep time even when nothing has ever been analysed", () => {
    const result = lastCheckedAt([release("3.0", "2026-07-30T00:00:00Z")], [], SWEEP);
    expect(result).toEqual({ at: SWEEP, monitored: true });
  });

  it("falls back to the newest analysis for an app outside the watch set", () => {
    // No release rows means the sweep never touched it, so claiming the
    // sweep's timestamp would be a lie about coverage.
    const result = lastCheckedAt([], [event("1.0", null, "2026-07-31T19:00:00.000Z")], SWEEP);
    expect(result).toEqual({ at: "2026-07-31T19:00:00.000Z", monitored: false });
  });

  it("reports nothing when the app has never been checked at all", () => {
    expect(lastCheckedAt([], [], SWEEP)).toEqual({ at: null, monitored: false });
  });

  it("reports nothing for a monitored app before the first sweep is recorded", () => {
    // Deploying this ahead of the first sweep must read as "never", not as a
    // stale analysis timestamp dressed up as a check.
    expect(lastCheckedAt([release("3.0", null)], [event("3.0", null)], null)).toEqual({
      at: null,
      monitored: true,
    });
  });
});

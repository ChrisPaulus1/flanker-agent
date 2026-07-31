import { describe, expect, it } from "vitest";
import { buildHistory, newestUnanalyzed } from "@/lib/pipeline/history";
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
    hnSummary: null,
    hnStoryRefs: [],
    llmOutput: makeTriage(),
    signalLevel: "high",
    model: "test",
    detectedAt,
    emailSentAt: null,
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

import { describe, expect, it } from "vitest";
import { chunkTrackIds, mapBatchLookupResponse, ITUNES_LOOKUP_BATCH_SIZE } from "@/lib/sources/itunes";

describe("chunkTrackIds", () => {
  it("splits into batches of the documented size", () => {
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);
    const batches = chunkTrackIds(ids);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(200);
    expect(batches[1]).toHaveLength(200);
    expect(batches[2]).toHaveLength(50);
  });

  it("keeps every id exactly once, in order", () => {
    const ids = Array.from({ length: 205 }, (_, i) => i + 1);
    expect(chunkTrackIds(ids).flat()).toEqual(ids);
  });

  it("returns nothing for an empty list rather than one empty batch", () => {
    // An empty batch would still cost a request and come back with resultCount 0.
    expect(chunkTrackIds([])).toEqual([]);
  });

  it("handles a list exactly one batch long without emitting a trailing empty batch", () => {
    const ids = Array.from({ length: ITUNES_LOOKUP_BATCH_SIZE }, (_, i) => i + 1);
    expect(chunkTrackIds(ids)).toHaveLength(1);
  });

  it("drops duplicate ids, which would waste slots in a capped batch", () => {
    expect(chunkTrackIds([5, 5, 7, 5])).toEqual([[5, 7]]);
  });
});

describe("mapBatchLookupResponse", () => {
  const payload = {
    resultCount: 2,
    results: [
      {
        trackId: 1,
        trackName: "Alpha",
        version: "2.0.0",
        releaseNotes: "Added widgets.",
        currentVersionReleaseDate: "2026-07-30T10:00:00Z",
        primaryGenreName: "Productivity",
        sellerName: "Alpha Inc",
        artworkUrl100: "https://ex.test/a.png",
      },
      {
        trackId: 2,
        trackName: "Beta",
        version: "1.4",
        currentVersionReleaseDate: "2026-07-29T10:00:00Z",
        primaryGenreName: "Games",
      },
    ],
  };

  it("maps every result, keyed by track id", () => {
    const out = mapBatchLookupResponse(payload);
    expect(out.size).toBe(2);
    expect(out.get(1)?.version).toBe("2.0.0");
    expect(out.get(2)?.appName).toBe("Beta");
  });

  it("normalises missing release notes to null", () => {
    expect(mapBatchLookupResponse(payload).get(2)?.releaseNotes).toBeNull();
  });

  it("skips results with no usable version instead of recording a blank one", () => {
    // A blank version would be stored as a distinct release and never match
    // again, producing a permanent phantom entry in the history.
    const withBlank = {
      resultCount: 2,
      results: [payload.results[0], { trackId: 3, trackName: "Gamma", version: "  " }],
    };
    const out = mapBatchLookupResponse(withBlank);
    expect(out.has(3)).toBe(false);
    expect(out.size).toBe(1);
  });

  it("skips entries with no track id", () => {
    const noId = { resultCount: 1, results: [{ trackName: "X", version: "1.0" }] };
    expect(mapBatchLookupResponse(noId).size).toBe(0);
  });

  it("returns an empty map for an empty payload rather than throwing", () => {
    // Unlike the single lookup, a batch legitimately returns nothing when every
    // id in it has been delisted — that isn't an error.
    expect(mapBatchLookupResponse({ resultCount: 0, results: [] }).size).toBe(0);
  });

  it("tolerates a malformed payload", () => {
    expect(mapBatchLookupResponse(null).size).toBe(0);
    expect(mapBatchLookupResponse({}).size).toBe(0);
  });
});

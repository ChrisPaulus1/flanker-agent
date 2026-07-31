import { describe, expect, it } from "vitest";
import {
  chunkIds,
  dedupeCandidates,
  LOOKUP_BATCH_SIZE,
  parseBulkLookup,
  parseChartFeed,
  parseSearchResults,
} from "@/lib/sources/catalog-source";

// Trimmed from a real itunes.apple.com/us/rss/topfreeapplications response.
const chartFeed = {
  feed: {
    entry: [
      {
        id: { attributes: { "im:id": "6448311069" } },
        "im:name": { label: "ChatGPT" },
        "im:artist": { label: "OpenAI" },
        "im:image": [{ label: "https://ex.test/53.png" }, { label: "https://ex.test/100.png" }],
        category: { attributes: { label: "Productivity" } },
      },
      {
        id: { attributes: { "im:id": "407558537" } },
        "im:name": { label: "Capital One Mobile" },
        "im:artist": { label: "Capital One" },
        "im:image": [{ label: "https://ex.test/a.png" }],
        category: { attributes: { label: "Finance" } },
      },
    ],
  },
};

describe("parseChartFeed", () => {
  it("maps entries and assigns chart position as popularity rank", () => {
    const apps = parseChartFeed(chartFeed);
    expect(apps).toHaveLength(2);
    expect(apps[0]).toEqual({
      itunesTrackId: 6448311069,
      name: "ChatGPT",
      developer: "OpenAI",
      genre: "Productivity",
      iconUrl: "https://ex.test/100.png", // largest image wins
      popularityRank: 1,
    });
    expect(apps[1].popularityRank).toBe(2);
  });

  it("drops entries with no usable id", () => {
    const broken = { feed: { entry: [{ "im:name": { label: "No id" } }] } };
    expect(parseChartFeed(broken)).toEqual([]);
  });

  it("returns empty for a malformed payload rather than throwing", () => {
    // The feed 500s and redirects periodically; a bad response must not kill
    // a catalog build that is otherwise 40 requests in.
    expect(parseChartFeed(null)).toEqual([]);
    expect(parseChartFeed({})).toEqual([]);
    expect(parseChartFeed({ feed: { entry: "nope" } })).toEqual([]);
  });
});

describe("parseSearchResults", () => {
  it("maps hits with no rank, since search order is not popularity", () => {
    const apps = parseSearchResults({
      results: [
        {
          trackId: 389801252,
          trackName: "Instagram",
          artistName: "Instagram, Inc.",
          primaryGenreName: "Photo & Video",
          artworkUrl512: "https://ex.test/512.png",
        },
      ],
    });
    expect(apps[0].popularityRank).toBeNull();
    expect(apps[0].iconUrl).toBe("https://ex.test/512.png");
  });

  it("skips hits with no track id or name", () => {
    expect(parseSearchResults({ results: [{ trackName: "x" }, { trackId: 1 }] })).toEqual([]);
  });
});

describe("parseBulkLookup", () => {
  const hit = {
    trackId: 836215269,
    trackName: "Chime",
    artistName: "Chime Financial, Inc.",
    primaryGenreName: "Finance",
    artworkUrl100: "https://ex.test/100.png",
    version: "5.337.0",
    releaseNotes: "Added instant transfers.",
    currentVersionReleaseDate: "2026-07-28T20:10:14Z",
  };

  it("carries version and release notes through", () => {
    const [app] = parseBulkLookup({ results: [hit] });
    expect(app.version).toBe("5.337.0");
    expect(app.releaseNotes).toBe("Added instant transfers.");
    expect(app.releaseDate).toBe("2026-07-28T20:10:14Z");
  });

  it("drops rows with no version", () => {
    // Without a version there is nothing to diff, so the app can never produce
    // a detection — storing it would just be dead weight.
    expect(parseBulkLookup({ results: [{ ...hit, version: undefined }] })).toEqual([]);
  });

  it("normalises absent release notes to null", () => {
    const [app] = parseBulkLookup({ results: [{ ...hit, releaseNotes: "   " }] });
    expect(app.releaseNotes).toBeNull();
  });

  it("dedupes ids within one response", () => {
    // A lookup of 200 ids containing repeats returns 200 rows; we want 1 each.
    expect(parseBulkLookup({ results: [hit, hit, hit] })).toHaveLength(1);
  });
});

describe("chunkIds", () => {
  it("batches at Apple's 200-id lookup ceiling", () => {
    expect(LOOKUP_BATCH_SIZE).toBe(200);
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);
    const chunks = chunkIds(ids);
    expect(chunks.map((c) => c.length)).toEqual([200, 200, 50]);
  });

  it("handles an empty list", () => {
    expect(chunkIds([])).toEqual([]);
  });

  it("means 10,000 apps refresh in 50 requests, not 10,000", () => {
    expect(chunkIds(Array.from({ length: 10_000 }, (_, i) => i))).toHaveLength(50);
  });
});

describe("dedupeCandidates", () => {
  const ranked = { itunesTrackId: 1, name: "A", developer: null, genre: null, iconUrl: null, popularityRank: 3 };
  const unranked = { ...ranked, popularityRank: null };
  const better = { ...ranked, popularityRank: 1 };

  it("keeps a chart-ranked entry over an unranked duplicate", () => {
    expect(dedupeCandidates([unranked, ranked])[0].popularityRank).toBe(3);
    expect(dedupeCandidates([ranked, unranked])[0].popularityRank).toBe(3);
  });

  it("keeps the best rank when an app charts in several feeds", () => {
    expect(dedupeCandidates([ranked, better])[0].popularityRank).toBe(1);
  });

  it("collapses to one row per track id", () => {
    expect(dedupeCandidates([ranked, unranked, better])).toHaveLength(1);
  });
});

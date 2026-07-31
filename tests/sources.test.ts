import { describe, expect, it } from "vitest";
import { mapLookupResponse } from "@/lib/sources/itunes";
import {
  extractRequiredPhrases,
  rankStories,
  stripHtml,
  toAlgoliaQuery,
} from "@/lib/sources/hn";
import { SEED_APPS } from "@/lib/tracked-apps";

// Shape captured from a real itunes.apple.com/lookup response, trimmed to the
// fields we actually consume.
const chimeLookup = {
  resultCount: 1,
  results: [
    {
      trackId: 836215269,
      trackName: "Chime® – Mobile Banking",
      version: "5.337.0",
      releaseNotes: "Here's a fun fact: the smoothest things in life...",
      currentVersionReleaseDate: "2026-07-28T20:10:14Z",
      trackViewUrl: "https://apps.apple.com/us/app/id836215269",
      artworkUrl100: "https://example.test/artwork.png",
      sellerName: "Chime Financial, Inc.",
    },
  ],
};

describe("mapLookupResponse", () => {
  it("maps a real lookup payload onto an AppRelease", () => {
    const release = mapLookupResponse(chimeLookup, 836215269);
    expect(release).toEqual({
      trackId: 836215269,
      appName: "Chime® – Mobile Banking",
      version: "5.337.0",
      releaseNotes: "Here's a fun fact: the smoothest things in life...",
      releaseDate: "2026-07-28T20:10:14Z",
      trackViewUrl: "https://apps.apple.com/us/app/id836215269",
      artworkUrl: "https://example.test/artwork.png",
      sellerName: "Chime Financial, Inc.",
    });
  });

  it("treats an empty result set as a hard error rather than a silent null", () => {
    // Swallowing this would look identical to "no new version" and would
    // quietly stall tracking for that app forever.
    expect(() => mapLookupResponse({ resultCount: 0, results: [] }, 836215269)).toThrow(
      /no result/i,
    );
  });

  it("rejects a payload whose trackId does not match what we asked for", () => {
    expect(() => mapLookupResponse(chimeLookup, 999)).toThrow(/trackId/i);
  });

  it("rejects a result with no version string", () => {
    const noVersion = { resultCount: 1, results: [{ ...chimeLookup.results[0], version: "" }] };
    expect(() => mapLookupResponse(noVersion, 836215269)).toThrow(/version/i);
  });

  it("normalises missing release notes to null instead of an empty string", () => {
    // Apple omits the field entirely for some apps; downstream code branches on
    // null, so an empty string here would read as "notes exist but are blank".
    const noNotes = { resultCount: 1, results: [{ ...chimeLookup.results[0], releaseNotes: undefined }] };
    expect(mapLookupResponse(noNotes, 836215269).releaseNotes).toBeNull();
  });

  it("trims surrounding whitespace off the version string", () => {
    const padded = { resultCount: 1, results: [{ ...chimeLookup.results[0], version: " 5.337.0\n" }] };
    expect(mapLookupResponse(padded, 836215269).version).toBe("5.337.0");
  });
});

describe("stripHtml", () => {
  it("unwraps the HTML and entities Algolia returns in comment_text", () => {
    expect(stripHtml("It&#x27;s the same with <i>Trading212</i> in the UK")).toBe(
      "It's the same with Trading212 in the UK",
    );
  });

  it("turns paragraph breaks into blank lines rather than jamming words together", () => {
    expect(stripHtml("first point<p>second point")).toBe("first point\n\nsecond point");
  });

  it("collapses runaway whitespace", () => {
    expect(stripHtml("a   \n\n\n\n  b")).toBe("a\n\nb");
  });
});

describe("extractRequiredPhrases", () => {
  it("pulls the quoted phrases out of an Algolia query", () => {
    expect(extractRequiredPhrases('"Chime" AND (bank OR banking OR fintech)')).toEqual(["Chime"]);
  });

  it("handles multiple alternative phrases", () => {
    expect(extractRequiredPhrases('"Cash App" OR "CashApp"')).toEqual(["Cash App", "CashApp"]);
  });

  it("falls back to the whole query when nothing is quoted", () => {
    expect(extractRequiredPhrases("Robinhood")).toEqual(["Robinhood"]);
  });
});

describe("toAlgoliaQuery", () => {
  it("quotes a bare phrase so Algolia does phrase matching", () => {
    expect(toAlgoliaQuery("Cash App")).toBe('"Cash App"');
  });

  it("leaves an already-quoted query alone", () => {
    expect(toAlgoliaQuery('"Revolut"')).toBe('"Revolut"');
  });
});

describe("SEED_APPS", () => {
  // Algolia's HN index has no boolean operators: a query containing AND/OR/
  // parens matches them as literal words and returns zero hits. This was a real
  // bug caught by a live check, so it gets a guard.
  it("never configures an hnQuery with boolean operators", () => {
    for (const app of SEED_APPS) {
      if (app.hnQuery) expect(app.hnQuery, `${app.name} hnQuery`).not.toMatch(/\b(AND|OR|NOT)\b|[()]/);
    }
  });

  it("pins a distinct iTunes track ID per app", () => {
    const ids = SEED_APPS.map((a) => a.itunesTrackId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("rankStories", () => {
  // Algolia's relevance ranking is loose enough that a query for "Chime"
  // returns a Tokyo soundscape project. Requiring the phrase in the title is
  // what keeps unrelated stories out of the LLM prompt.
  const hits = [
    { objectID: "1", title: "Chime CEO: Pursuing bank charter is 'a when, not if'", points: 2, num_comments: 3, created_at: "2026-07-01T00:00:00Z", url: "https://ex.test/a" },
    { objectID: "2", title: "Show HN: Yamanote.fun – A complete soundscape for Tokyo's line", points: 238, num_comments: 90, created_at: "2026-07-02T00:00:00Z", url: "https://ex.test/b" },
    { objectID: "3", title: "Chime layoffs hit engineering", points: 40, num_comments: 55, created_at: "2026-06-01T00:00:00Z", url: null },
  ];

  it("drops hits that do not mention the required phrase in the title", () => {
    const ranked = rankStories(hits, ["Chime"], 10);
    expect(ranked.map((s) => s.objectId)).toEqual(["3", "1"]);
  });

  it("ranks by engagement, not recency, so the loudest discussion wins", () => {
    expect(rankStories(hits, ["Chime"], 10)[0].objectId).toBe("3");
  });

  it("matches the phrase case-insensitively", () => {
    expect(rankStories([{ ...hits[0], title: "CHIME raises a round" }], ["Chime"], 10)).toHaveLength(1);
  });

  it("does not match a phrase embedded in a larger word", () => {
    // "revolution" must not satisfy a "Revolut" requirement.
    const revolution = [{ ...hits[0], title: "The French revolution, revisited" }];
    expect(rankStories(revolution, ["Revolut"], 10)).toHaveLength(0);
  });

  it("respects the story limit", () => {
    expect(rankStories(hits, ["Chime"], 1)).toHaveLength(1);
  });

  it("returns an empty array when nothing is relevant, rather than falling back to noise", () => {
    expect(rankStories(hits, ["Monzo"], 10)).toEqual([]);
  });
});

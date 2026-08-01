import { describe, expect, it } from "vitest";
import { mapLookupResponse } from "@/lib/sources/itunes";

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
      primaryGenreName: "Finance",
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
      genre: "Finance",
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








/**
 * iTunes Search API adapter.
 *
 * Free, keyless, rate limited to roughly 20 requests/minute per IP. We use the
 * `/lookup` endpoint with pinned track IDs rather than `/search`, because
 * `/search` is fuzzy and its top hit for a given term drifts over time — not
 * something you want deciding which app you're tracking.
 */

const LOOKUP_ENDPOINT = "https://itunes.apple.com/lookup";

export interface AppRelease {
  trackId: number;
  appName: string;
  version: string;
  releaseNotes: string | null;
  /** ISO 8601, the date this specific version went live. */
  releaseDate: string;
  trackViewUrl: string;
  artworkUrl: string | null;
  sellerName: string | null;
  /** App Store category, e.g. "Finance". Used to judge whether the reader's
   *  product actually competes with this one. */
  genre: string | null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Pure mapper, separated from the fetch so the response contract can be tested
 * without a network call. Throws rather than returning null on a malformed
 * payload: an unreadable response must not be indistinguishable from
 * "no new version", or we'd silently stop tracking an app.
 */
export function mapLookupResponse(payload: unknown, expectedTrackId: number): AppRelease {
  const results = (payload as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`iTunes lookup returned no result for trackId ${expectedTrackId}`);
  }

  const result = results[0] as Record<string, unknown>;

  if (result.trackId !== expectedTrackId) {
    throw new Error(
      `iTunes lookup returned trackId ${String(result.trackId)}, expected ${expectedTrackId}`,
    );
  }

  const version = asString(result.version);
  if (!version) {
    throw new Error(`iTunes lookup returned no version for trackId ${expectedTrackId}`);
  }

  return {
    trackId: expectedTrackId,
    appName: asString(result.trackName) ?? `App ${expectedTrackId}`,
    version,
    releaseNotes: asString(result.releaseNotes),
    releaseDate: asString(result.currentVersionReleaseDate) ?? new Date().toISOString(),
    trackViewUrl:
      asString(result.trackViewUrl) ?? `https://apps.apple.com/us/app/id${expectedTrackId}`,
    artworkUrl: asString(result.artworkUrl100) ?? asString(result.artworkUrl512),
    sellerName: asString(result.sellerName),
    genre: asString(result.primaryGenreName),
  };
}

export async function fetchLatestRelease(
  trackId: number,
  { country = "us", signal }: { country?: string; signal?: AbortSignal } = {},
): Promise<AppRelease> {
  const url = `${LOOKUP_ENDPOINT}?id=${encodeURIComponent(trackId)}&country=${encodeURIComponent(country)}&entity=software`;

  const response = await fetch(url, {
    signal,
    headers: { accept: "application/json" },
    // Apple caches aggressively at the edge; we want the current version.
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`iTunes lookup failed for trackId ${trackId}: HTTP ${response.status}`);
  }

  // The endpoint answers with `text/javascript`, so response.json() is unreliable.
  const payload = JSON.parse(await response.text()) as unknown;
  return mapLookupResponse(payload, trackId);
}

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

// ---------------------------------------------------------------------------
// Batched lookup.
//
// `/lookup` accepts a comma-separated list of ids, which is what makes watching
// a large catalogue affordable: 2,000 apps cost 10 requests rather than 2,000,
// and none of them cost an LLM call. Detection and analysis are separate
// budgets, and this is the cheap one.
// ---------------------------------------------------------------------------

/** Apple accepts more, but 200 keeps the URL well inside safe length limits. */
export const ITUNES_LOOKUP_BATCH_SIZE = 200;

export function chunkTrackIds(
  trackIds: number[],
  size: number = ITUNES_LOOKUP_BATCH_SIZE,
): number[][] {
  // Duplicates would consume slots in a capped batch and return one merged
  // result anyway, so they're collapsed before chunking.
  const unique = [...new Set(trackIds)];
  const batches: number[][] = [];
  for (let i = 0; i < unique.length; i += size) {
    batches.push(unique.slice(i, i + size));
  }
  return batches;
}

/**
 * Map a multi-id lookup payload to releases, keyed by track id.
 *
 * Unlike the single lookup this never throws on an empty result: a batch
 * legitimately comes back short when ids in it have been delisted from the
 * store, and one dead app must not fail the other 199.
 */
export function mapBatchLookupResponse(payload: unknown): Map<number, AppRelease> {
  const out = new Map<number, AppRelease>();
  const results = (payload as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return out;

  for (const raw of results) {
    const result = raw as Record<string, unknown>;
    const trackId = typeof result.trackId === "number" ? result.trackId : null;
    if (trackId === null) continue;

    // A blank version would be stored as its own release and never match
    // again, leaving a permanent phantom entry in that app's history.
    const version = asString(result.version);
    if (!version) continue;

    out.set(trackId, {
      trackId,
      appName: asString(result.trackName) ?? `App ${trackId}`,
      version,
      releaseNotes: asString(result.releaseNotes),
      releaseDate: asString(result.currentVersionReleaseDate) ?? new Date().toISOString(),
      trackViewUrl:
        asString(result.trackViewUrl) ?? `https://apps.apple.com/us/app/id${trackId}`,
      artworkUrl: asString(result.artworkUrl100) ?? asString(result.artworkUrl512),
      sellerName: asString(result.sellerName),
      genre: asString(result.primaryGenreName),
    });
  }

  return out;
}

export async function fetchReleasesForBatch(
  trackIds: number[],
  { country = "us", signal }: { country?: string; signal?: AbortSignal } = {},
): Promise<Map<number, AppRelease>> {
  if (trackIds.length === 0) return new Map();

  const url =
    `${LOOKUP_ENDPOINT}?id=${trackIds.join(",")}` +
    `&country=${encodeURIComponent(country)}&entity=software&limit=${trackIds.length}`;

  const response = await fetch(url, {
    signal,
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`iTunes batch lookup failed: HTTP ${response.status}`);
  }

  // The endpoint answers with text/javascript, so response.json() is unreliable.
  return mapBatchLookupResponse(JSON.parse(await response.text()));
}

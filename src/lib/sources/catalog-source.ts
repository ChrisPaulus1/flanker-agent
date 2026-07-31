/**
 * Catalog discovery against the iTunes APIs.
 *
 * Two sources, for different reasons:
 *
 *  - RSS top-charts give ranked, genuinely popular apps. That ranking is what
 *    makes type-ahead useful ("s" should surface Spotify, not a dead app whose
 *    name happens to start with s) and it decides what's worth precomputing.
 *  - Search across many terms fills out the long tail, which is where most of
 *    the 10k comes from.
 *
 * Neither needs a key. The rate limit is ~20 requests/minute per IP, which is
 * the binding constraint on how fast a catalog can be built.
 */

export interface CatalogCandidate {
  itunesTrackId: number;
  name: string;
  developer: string | null;
  genre: string | null;
  iconUrl: string | null;
  /** Chart position where known; null for search-discovered apps. */
  popularityRank: number | null;
}

export interface AppDetail extends CatalogCandidate {
  version: string;
  releaseNotes: string | null;
  releaseDate: string | null;
}

/** Apple's chart feeds. `genre` narrows to a category id when supplied. */
export function chartFeedUrl(
  kind: "topfreeapplications" | "toppaidapplications" | "topgrossingapplications",
  { limit = 200, genre }: { limit?: number; genre?: number } = {},
): string {
  const genrePart = genre ? `/genre=${genre}` : "";
  return `https://itunes.apple.com/us/rss/${kind}${genrePart}/limit=${limit}/json`;
}

interface RssEntry {
  id?: { attributes?: { "im:id"?: string } };
  "im:name"?: { label?: string };
  "im:artist"?: { label?: string };
  "im:image"?: Array<{ label?: string }>;
  category?: { attributes?: { label?: string } };
}

/** Pure parser, so the feed's awkward shape is testable without a network call. */
export function parseChartFeed(payload: unknown): CatalogCandidate[] {
  const entries = (payload as { feed?: { entry?: RssEntry[] } } | null)?.feed?.entry;
  if (!Array.isArray(entries)) return [];

  const out: CatalogCandidate[] = [];

  entries.forEach((entry, index) => {
    const id = Number(entry.id?.attributes?.["im:id"]);
    const name = entry["im:name"]?.label?.trim();
    if (!Number.isFinite(id) || id <= 0 || !name) return;

    const images = entry["im:image"] ?? [];
    out.push({
      itunesTrackId: id,
      name,
      developer: entry["im:artist"]?.label?.trim() ?? null,
      genre: entry.category?.attributes?.label?.trim() ?? null,
      // Last image is the largest Apple provides in the feed.
      iconUrl: images[images.length - 1]?.label ?? null,
      popularityRank: index + 1,
    });
  });

  return out;
}

interface SearchHit {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  primaryGenreName?: string;
  artworkUrl100?: string;
  artworkUrl512?: string;
  version?: string;
  releaseNotes?: string;
  currentVersionReleaseDate?: string;
}

export function parseSearchResults(payload: unknown): CatalogCandidate[] {
  const results = (payload as { results?: SearchHit[] } | null)?.results;
  if (!Array.isArray(results)) return [];

  return results.flatMap((hit) => {
    const id = Number(hit.trackId);
    const name = hit.trackName?.trim();
    if (!Number.isFinite(id) || id <= 0 || !name) return [];

    return [
      {
        itunesTrackId: id,
        name,
        developer: hit.artistName?.trim() ?? null,
        genre: hit.primaryGenreName?.trim() ?? null,
        iconUrl: hit.artworkUrl512 ?? hit.artworkUrl100 ?? null,
        popularityRank: null,
      },
    ];
  });
}

/**
 * Map a bulk lookup response back onto candidates.
 *
 * The lookup endpoint accepts up to 200 comma-separated IDs in one request and
 * returns full metadata for all of them — which is the difference between
 * refreshing 10,000 apps in 50 requests and doing it in 10,000.
 */
export function parseBulkLookup(payload: unknown): AppDetail[] {
  const results = (payload as { results?: SearchHit[] } | null)?.results;
  if (!Array.isArray(results)) return [];

  const seen = new Set<number>();

  return results.flatMap((hit) => {
    const id = Number(hit.trackId);
    const name = hit.trackName?.trim();
    const version = hit.version?.trim();

    // A missing version means we can't do change detection, which is the whole
    // point — drop rather than store something undetectable.
    if (!Number.isFinite(id) || !name || !version) return [];
    if (seen.has(id)) return [];
    seen.add(id);

    const notes = hit.releaseNotes?.trim();

    return [
      {
        itunesTrackId: id,
        name,
        developer: hit.artistName?.trim() ?? null,
        genre: hit.primaryGenreName?.trim() ?? null,
        iconUrl: hit.artworkUrl512 ?? hit.artworkUrl100 ?? null,
        popularityRank: null,
        version,
        releaseNotes: notes && notes.length > 0 ? notes : null,
        releaseDate: hit.currentVersionReleaseDate ?? null,
      },
    ];
  });
}

/** Apple caps a lookup at 200 ids per request. */
export const LOOKUP_BATCH_SIZE = 200;

export function chunkIds(ids: number[], size = LOOKUP_BATCH_SIZE): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Deduplicate by track id, keeping the best-ranked occurrence. */
export function dedupeCandidates(candidates: CatalogCandidate[]): CatalogCandidate[] {
  const byId = new Map<number, CatalogCandidate>();

  for (const candidate of candidates) {
    const existing = byId.get(candidate.itunesTrackId);
    if (!existing) {
      byId.set(candidate.itunesTrackId, candidate);
      continue;
    }
    // A chart rank beats no rank; a better rank beats a worse one.
    const existingRank = existing.popularityRank ?? Number.MAX_SAFE_INTEGER;
    const incomingRank = candidate.popularityRank ?? Number.MAX_SAFE_INTEGER;
    if (incomingRank < existingRank) byId.set(candidate.itunesTrackId, candidate);
  }

  return [...byId.values()];
}

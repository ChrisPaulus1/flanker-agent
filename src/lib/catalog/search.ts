import type { CatalogApp, FlankerRepo } from "@/lib/storage/types";

/**
 * Catalog search.
 *
 * Two shapes for two jobs. Type-ahead is a prefix match capped at three, which
 * is what the user asked for and also what keeps the dropdown from becoming a
 * wall — typing "s" should offer a decision, not a directory. Full search is a
 * substring match for the results page.
 *
 * Both are pure database reads. No LLM anywhere in this path: browsing has to
 * stay instant and free, or a visitor flicking through apps burns the daily
 * generation quota before reading anything.
 */

/** The user asked for exactly three suggestions under the search bar. */
export const TYPEAHEAD_LIMIT = 3;
export const SEARCH_LIMIT = 24;

export interface Suggestion {
  itunesTrackId: number;
  name: string;
  developer: string | null;
  genre: string | null;
  iconUrl: string | null;
  version: string | null;
}

export function toSuggestion(app: CatalogApp): Suggestion {
  return {
    itunesTrackId: app.itunesTrackId,
    name: app.name,
    developer: app.developer,
    genre: app.genre,
    iconUrl: app.iconUrl,
    version: app.version,
  };
}

/**
 * A query is only worth running once there's something to match on. Firing on
 * an empty string would return the whole catalog ordered by popularity, which
 * is a different feature (a chart) and a much bigger response.
 */
export function isSearchable(query: string): boolean {
  return query.trim().length >= 1;
}

export async function suggest(repo: FlankerRepo, query: string): Promise<Suggestion[]> {
  if (!isSearchable(query)) return [];

  const prefix = await repo.searchCatalogPrefix(query, TYPEAHEAD_LIMIT);
  if (prefix.length >= TYPEAHEAD_LIMIT) return prefix.map(toSuggestion);

  // Prefix matching alone is unhelpful for apps whose brand isn't the first
  // word — "cash" should still reach "Block: Cash App". Top up from a
  // substring match, keeping prefix hits first because they're what the user
  // is most likely typing towards.
  const seen = new Set(prefix.map((a) => a.itunesTrackId));
  const contains = await repo.searchCatalog(query, TYPEAHEAD_LIMIT * 3);

  const topUp = contains.filter((a) => !seen.has(a.itunesTrackId));

  return [...prefix, ...topUp].slice(0, TYPEAHEAD_LIMIT).map(toSuggestion);
}

export async function search(repo: FlankerRepo, query: string): Promise<Suggestion[]> {
  if (!isSearchable(query)) return [];
  const results = await repo.searchCatalog(query, SEARCH_LIMIT);
  return results.map(toSuggestion);
}

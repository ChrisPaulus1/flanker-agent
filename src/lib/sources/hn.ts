/**
 * Hacker News (Algolia) adapter.
 *
 * Keyless and free. Two things learned from probing it against real competitor
 * names, both of which shape this module:
 *
 *  1. Relevance is loose. An unquoted `Revolut` query matches "revolution" and
 *     "revolutionaries"; a `Chime` query returns a Tokyo soundscape project. So
 *     we query with quoted phrases AND re-filter client-side on the title.
 *  2. Volume is low — single-digit to low-double-digit relevant stories per app
 *     per 180 days, and almost none discuss a specific release. Returning
 *     nothing is the normal case, and callers must render that honestly rather
 *     than feeding the LLM noise to summarise.
 */

const SEARCH_ENDPOINT = "https://hn.algolia.com/api/v1/search";
const ITEM_ENDPOINT = "https://hn.algolia.com/api/v1/items";

export interface HnStory {
  objectId: string;
  title: string;
  /** The linked article, if the story wasn't a text post. */
  url: string | null;
  hnUrl: string;
  points: number;
  numComments: number;
  createdAt: string;
}

export interface HnReaction {
  query: string;
  stories: HnStory[];
  /** Flattened top-level-ish comment text, already stripped of HTML. */
  comments: string[];
}

interface AlgoliaHit {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  url?: string | null;
  points?: number | null;
  num_comments?: number | null;
  created_at?: string;
}

const ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

/** Algolia returns comment bodies as HTML with escaped entities. */
export function stripHtml(input: string): string {
  return input
    .replace(/<\s*\/?\s*(p|br)\s*\/?\s*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:quot|#x27|#39|amp|lt|gt|nbsp);/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The phrases a story title must contain to count as relevant. Quoted phrases
 * in the Algolia query double as the client-side relevance requirement, so a
 * tracked app only has to configure one string.
 */
export function extractRequiredPhrases(query: string): string[] {
  const quoted = [...query.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter(Boolean);
  return quoted.length > 0 ? quoted : [query.trim()];
}

/**
 * Algolia only does phrase matching if the phrase is quoted — an unquoted
 * `Cash App` matches either word anywhere, which is how you end up
 * summarising a thread about cash registers.
 */
export function toAlgoliaQuery(query: string): string {
  const trimmed = query.trim();
  return trimmed.includes('"') ? trimmed : `"${trimmed}"`;
}

function containsPhrase(title: string, phrase: string): boolean {
  // Word-boundary anchored so "Revolut" doesn't match "revolution".
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, "iu").test(title);
}

/**
 * Filter Algolia's hits down to genuinely relevant stories, ranked by
 * engagement. We rank on discussion volume rather than recency because the
 * point is to capture *reaction* — a 3-point story with no comments tells us
 * nothing regardless of how fresh it is.
 */
export function rankStories(hits: AlgoliaHit[], requiredPhrases: string[], limit: number): HnStory[] {
  return hits
    .filter((hit) => {
      const title = hit.title ?? hit.story_title ?? "";
      return title.length > 0 && requiredPhrases.some((phrase) => containsPhrase(title, phrase));
    })
    .map((hit) => ({
      objectId: hit.objectID,
      title: (hit.title ?? hit.story_title ?? "").trim(),
      url: hit.url ?? null,
      hnUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      points: hit.points ?? 0,
      numComments: hit.num_comments ?? 0,
      createdAt: hit.created_at ?? "",
    }))
    .sort((a, b) => b.numComments + b.points - (a.numComments + a.points))
    .slice(0, limit);
}

function collectComments(node: unknown, out: string[], limit: number): void {
  const children = (node as { children?: unknown[] } | null)?.children;
  if (!Array.isArray(children)) return;

  for (const child of children) {
    if (out.length >= limit) return;
    const text = (child as { text?: string | null }).text;
    if (typeof text === "string" && text.trim()) {
      const cleaned = stripHtml(text);
      // Very short comments ("+1", "same") add tokens without adding signal.
      if (cleaned.length >= 80) out.push(cleaned);
    }
    collectComments(child, out, limit);
  }
}

/**
 * Fetch community reaction for a tracked app.
 *
 * Returns `stories: []` and `comments: []` when nothing relevant exists — that
 * is a legitimate result, not a failure. Network errors are the caller's to
 * handle; the pipeline treats them as non-fatal.
 */
export async function fetchReaction(
  query: string,
  {
    sinceDaysAgo = 180,
    maxStories = 4,
    maxComments = 25,
    signal,
  }: { sinceDaysAgo?: number; maxStories?: number; maxComments?: number; signal?: AbortSignal } = {},
): Promise<HnReaction> {
  const since = Math.floor(Date.now() / 1000) - sinceDaysAgo * 86_400;

  const params = new URLSearchParams({
    query: toAlgoliaQuery(query),
    tags: "story",
    numericFilters: `created_at_i>${since}`,
    advancedSyntax: "true",
    hitsPerPage: "20",
  });

  const response = await fetch(`${SEARCH_ENDPOINT}?${params}`, { signal, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HN search failed for ${JSON.stringify(query)}: HTTP ${response.status}`);
  }

  const { hits = [] } = (await response.json()) as { hits?: AlgoliaHit[] };
  const stories = rankStories(hits, extractRequiredPhrases(query), maxStories);

  const comments: string[] = [];
  for (const story of stories) {
    if (comments.length >= maxComments || story.numComments === 0) continue;
    try {
      const itemResponse = await fetch(`${ITEM_ENDPOINT}/${story.objectId}`, {
        signal,
        cache: "no-store",
      });
      if (!itemResponse.ok) continue;
      collectComments(await itemResponse.json(), comments, maxComments);
    } catch {
      // One unreadable thread shouldn't cost us the other stories' reaction.
      continue;
    }
  }

  return { query, stories, comments };
}

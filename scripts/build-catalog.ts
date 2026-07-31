/**
 * Builds the searchable app catalog.
 *
 * Two passes:
 *   1. DISCOVER — chart feeds (ranked, popular) plus search across many terms
 *      (the long tail). Gives ids and basic metadata.
 *   2. HYDRATE  — bulk lookup in batches of 200 to attach version and release
 *      notes. This is the step that makes 10k apps affordable: Apple accepts
 *      200 comma-separated ids per request, so 10,000 apps costs 50 requests
 *      rather than 10,000.
 *
 * Everything is keyless. The binding constraint is ~20 requests/minute per IP,
 * so the whole thing is self-throttled and takes a few minutes.
 *
 *   npx tsx scripts/build-catalog.ts              # full build
 *   npx tsx scripts/build-catalog.ts --charts     # charts only, much faster
 *   npx tsx scripts/build-catalog.ts --from-cache # re-upload, no API calls
 *
 * Hydrated output is written to .catalog-cache.json before anything touches
 * the database. The first run of this script spent twenty minutes fetching
 * 16,730 apps and then lost all of it to a failed write, which is a bad way to
 * find out the target table didn't exist.
 */
import "./load-env";
import fs from "node:fs";
import path from "node:path";
import { SupabaseFlankerRepo } from "../src/lib/storage/repo";
import {
  chartFeedUrl,
  chunkIds,
  dedupeCandidates,
  parseBulkLookup,
  parseChartFeed,
  parseSearchResults,
  type CatalogCandidate,
} from "../src/lib/sources/catalog-source";
import type { CatalogApp } from "../src/lib/storage/types";

/** Apple's App Store category ids. */
const GENRES = [
  6018, 6000, 6022, 6017, 6016, 6015, 6023, 6014, 6013, 6012, 6020, 6011, 6010,
  6009, 6008, 6007, 6006, 6024, 6005, 6004, 6003, 6002, 6001, 6021,
];

/**
 * Long-tail search terms. Deliberately broad and category-spanning — the point
 * is coverage, not precision, since every hit is validated on hydrate anyway.
 */
const SEARCH_TERMS = [
  "banking", "budget", "invest", "crypto", "payments", "insurance", "tax", "loan",
  "fitness", "workout", "running", "yoga", "meditation", "sleep", "diet", "nutrition",
  "photo editor", "video editor", "camera", "collage", "filters", "design",
  "music", "podcast", "radio", "streaming", "movies", "tv shows", "anime",
  "game", "puzzle", "rpg", "strategy game", "racing", "sports game", "card game",
  "messaging", "social network", "dating", "video call", "email", "calendar",
  "notes", "todo", "productivity", "password manager", "vpn", "cloud storage",
  "shopping", "food delivery", "grocery", "recipes", "restaurant", "coffee",
  "travel", "flights", "hotels", "maps", "rideshare", "parking", "transit",
  "news", "weather", "reading", "books", "audiobooks", "language learning",
  "education", "kids", "parenting", "pets", "health", "medical", "therapy",
  "real estate", "jobs", "resume", "freelance", "accounting", "crm", "hr",
  "ai assistant", "chatbot", "translate", "scanner", "pdf", "spreadsheet",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ~20 req/min is the documented ceiling; 3.2s between calls keeps us under. */
const THROTTLE_MS = 3200;

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) {
      console.warn(`  ! HTTP ${res.status} for ${url.slice(0, 90)}`);
      return null;
    }
    // Apple serves text/javascript on some endpoints, so parse the body text.
    return JSON.parse(await res.text());
  } catch (error) {
    console.warn(`  ! ${String(error).slice(0, 90)}`);
    return null;
  }
}

async function discoverFromCharts(): Promise<CatalogCandidate[]> {
  const found: CatalogCandidate[] = [];
  const feeds: string[] = [
    chartFeedUrl("topfreeapplications", { limit: 200 }),
    chartFeedUrl("toppaidapplications", { limit: 200 }),
    chartFeedUrl("topgrossingapplications", { limit: 200 }),
    ...GENRES.flatMap((genre) => [
      chartFeedUrl("topfreeapplications", { limit: 200, genre }),
      chartFeedUrl("topgrossingapplications", { limit: 100, genre }),
    ]),
  ];

  console.log(`Charts: ${feeds.length} feeds`);
  for (const [i, url] of feeds.entries()) {
    const apps = parseChartFeed(await getJson(url));
    found.push(...apps);
    if ((i + 1) % 10 === 0) {
      console.log(`  ${i + 1}/${feeds.length} feeds, ${found.length} rows so far`);
    }
    await sleep(THROTTLE_MS);
  }
  return found;
}

async function discoverFromSearch(): Promise<CatalogCandidate[]> {
  const found: CatalogCandidate[] = [];

  console.log(`\nSearch: ${SEARCH_TERMS.length} terms`);
  for (const [i, term] of SEARCH_TERMS.entries()) {
    const params = new URLSearchParams({
      term,
      entity: "software",
      country: "us",
      limit: "200",
    });
    const apps = parseSearchResults(await getJson(`https://itunes.apple.com/search?${params}`));
    found.push(...apps);
    if ((i + 1) % 10 === 0) {
      console.log(`  ${i + 1}/${SEARCH_TERMS.length} terms, ${found.length} rows so far`);
    }
    await sleep(THROTTLE_MS);
  }
  return found;
}

async function hydrate(candidates: CatalogCandidate[]): Promise<CatalogApp[]> {
  const byId = new Map(candidates.map((c) => [c.itunesTrackId, c]));
  const batches = chunkIds([...byId.keys()]);

  console.log(`\nHydrate: ${byId.size} apps in ${batches.length} lookup requests (200 per request)`);

  const out: CatalogApp[] = [];

  for (const [i, batch] of batches.entries()) {
    const url = `https://itunes.apple.com/lookup?id=${batch.join(",")}&country=us&entity=software`;
    const details = parseBulkLookup(await getJson(url));

    for (const detail of details) {
      const discovered = byId.get(detail.itunesTrackId);
      out.push({
        itunesTrackId: detail.itunesTrackId,
        name: detail.name,
        developer: detail.developer,
        genre: detail.genre,
        iconUrl: detail.iconUrl ?? discovered?.iconUrl ?? null,
        version: detail.version,
        releaseNotes: detail.releaseNotes,
        releaseDate: detail.releaseDate,
        // Rank comes from discovery — lookup responses carry no chart position.
        popularityRank: discovered?.popularityRank ?? null,
      });
    }

    console.log(`  ${i + 1}/${batches.length} batches, ${out.length} hydrated`);
    await sleep(THROTTLE_MS);
  }

  return out;
}

const CACHE_PATH = path.join(process.cwd(), ".catalog-cache.json");

async function main() {
  const chartsOnly = process.argv.includes("--charts");
  const fromCache = process.argv.includes("--from-cache");
  const startedAt = Date.now();

  if (fromCache) {
    const cached = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as CatalogApp[];
    console.log(`Loaded ${cached.length} apps from ${CACHE_PATH}`);
    const repo = new SupabaseFlankerRepo();
    const written = await repo.upsertCatalogApps(cached);
    console.log(`upserted ${written}, catalog total ${await repo.countCatalogApps()}`);
    return;
  }

  const discovered = [
    ...(await discoverFromCharts()),
    ...(chartsOnly ? [] : await discoverFromSearch()),
  ];

  const unique = dedupeCandidates(discovered);
  console.log(`\nDiscovered ${discovered.length} rows -> ${unique.length} unique apps`);

  const hydrated = await hydrate(unique);
  console.log(`Hydrated ${hydrated.length} (dropped ${unique.length - hydrated.length} with no version)`);

  // Persist before writing. Twenty minutes of rate-limited fetching should
  // never be thrown away by a database error.
  fs.writeFileSync(CACHE_PATH, JSON.stringify(hydrated));
  console.log(`Cached to ${CACHE_PATH} — re-upload with --from-cache`);

  const repo = new SupabaseFlankerRepo();
  const written = await repo.upsertCatalogApps(hydrated);
  const total = await repo.countCatalogApps();

  const withNotes = hydrated.filter((a) => a.releaseNotes).length;
  const ranked = hydrated.filter((a) => a.popularityRank !== null).length;
  const genres = new Set(hydrated.map((a) => a.genre).filter(Boolean)).size;

  console.log(`\n${"=".repeat(64)}`);
  console.log(`upserted        ${written}`);
  console.log(`catalog total   ${total}`);
  console.log(`with notes      ${withNotes} (${Math.round((withNotes / hydrated.length) * 100)}%)`);
  console.log(`chart-ranked    ${ranked}`);
  console.log(`distinct genres ${genres}`);
  console.log(`elapsed         ${((Date.now() - startedAt) / 1000 / 60).toFixed(1)} min`);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});

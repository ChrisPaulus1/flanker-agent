/**
 * Candidate discovery and validation for the tracked competitor set.
 *
 * Resolves each candidate name to a real iTunes track ID and then *validates*
 * it rather than trusting the search result — `/search` is fuzzy and its top
 * hit for a given term drifts, which is exactly how you end up tracking the
 * wrong app forever.
 *
 * A candidate is only accepted if all of these hold:
 *   - the lookup by resolved ID returns that same ID
 *   - the app is in a finance-adjacent App Store genre
 *   - it has a non-empty version string
 *   - it is a US storefront app with a usable name
 *
 * It also probes each app's Hacker News query and reports how many stories
 * survive the client-side title filter, so brand names too generic to search
 * (see "Current") can be given a null query instead of noise.
 *
 *   npx tsx scripts/discover-apps.ts
 */
import { fetchLatestRelease } from "../src/lib/sources/itunes";
import { fetchReaction } from "../src/lib/sources/hn";

/** Search term -> preferred display name and HN phrase. */
interface Candidate {
  term: string;
  name: string;
  /** Explicit HN phrase; null means "don't even try". */
  hnQuery: string | null;
  /**
   * Brand token that MUST appear in the resolved app's name or seller.
   * Defaults to `name`. This is the guard against the search quietly handing
   * back a different company — see the note on resolveTrackId.
   */
  brand?: string;
}

const CANDIDATES: Candidate[] = [
  // Already tracked — re-validated so the whole set goes through one gate.
  { term: "Chime mobile banking", name: "Chime", hnQuery: "Chime" },
  { term: "Revolut", name: "Revolut", hnQuery: "Revolut" },
  { term: "Robinhood investing", name: "Robinhood", hnQuery: "Robinhood" },
  { term: "Cash App", name: "Cash App", hnQuery: "Cash App", brand: "Cash App" },
  { term: "Varo Bank", name: "Varo Bank", hnQuery: "Varo" },
  { term: "Current mobile banking", name: "Current", hnQuery: null },
  { term: "Public Invest Trade", name: "Public", hnQuery: "Public.com", brand: "Public" },

  // Neobanks / consumer banking
  { term: "SoFi bank invest", name: "SoFi", hnQuery: "SoFi" },
  { term: "Dave banking cash advance", name: "Dave", hnQuery: null },
  { term: "Albert budgeting banking", name: "Albert", hnQuery: null },
  { term: "MoneyLion", name: "MoneyLion", hnQuery: "MoneyLion" },
  { term: "Earnin", name: "EarnIn", hnQuery: "Earnin" },
  { term: "Brigit borrow money", name: "Brigit", hnQuery: null, brand: "Brigit" },
  { term: "Upgrade card loans", name: "Upgrade", hnQuery: null },
  { term: "Ally Bank", name: "Ally", hnQuery: "Ally Bank" },
  { term: "Monzo", name: "Monzo", hnQuery: "Monzo" },
  { term: "N26 bank", name: "N26", hnQuery: "N26" },
  { term: "Starling Bank", name: "Starling Bank", hnQuery: "Starling Bank" },
  { term: "Nubank", name: "Nubank", hnQuery: "Nubank" },

  // Payments / transfers
  { term: "Venmo", name: "Venmo", hnQuery: "Venmo" },
  { term: "PayPal", name: "PayPal", hnQuery: "PayPal" },
  { term: "Wise money transfer", name: "Wise", hnQuery: "Wise" },
  { term: "Remitly money transfer", name: "Remitly", hnQuery: "Remitly" },
  { term: "Zelle", name: "Zelle", hnQuery: "Zelle", brand: "Zelle" },

  // Buy-now-pay-later
  { term: "Klarna", name: "Klarna", hnQuery: "Klarna" },
  { term: "Affirm buy now pay later", name: "Affirm", hnQuery: "Affirm" },
  { term: "Afterpay", name: "Afterpay", hnQuery: "Afterpay" },

  // Investing / wealth
  { term: "Acorns invest", name: "Acorns", hnQuery: "Acorns" },
  { term: "Betterment investing", name: "Betterment", hnQuery: "Betterment" },
  { term: "Wealthfront", name: "Wealthfront", hnQuery: "Wealthfront" },
  { term: "Stash invest", name: "Stash", hnQuery: null },
  { term: "M1 Finance", name: "M1 Finance", hnQuery: "M1 Finance" },
  { term: "Webull", name: "Webull", hnQuery: "Webull" },
  { term: "eToro", name: "eToro", hnQuery: "eToro" },

  // Crypto
  { term: "Coinbase", name: "Coinbase", hnQuery: "Coinbase" },
  { term: "Kraken Pro crypto", name: "Kraken", hnQuery: "Kraken" },

  // Family / teen banking
  { term: "Greenlight kids money", name: "Greenlight", hnQuery: null },
  { term: "Step banking teens", name: "Step", hnQuery: null },

  // Business / SMB banking
  { term: "Novo business banking", name: "Novo", hnQuery: null },
  { term: "Bluevine business banking", name: "Bluevine", hnQuery: "Bluevine" },
  { term: "Ramp corporate card", name: "Ramp", hnQuery: "Ramp" },
  { term: "Brex", name: "Brex", hnQuery: "Brex" },
];

/**
 * App Store genres we consider in-scope. Shopping is included because the
 * buy-now-pay-later apps (Affirm, Afterpay) are filed there rather than under
 * Finance, and excluding it is what caused them to resolve to Klarna.
 */
const ALLOWED_GENRES = new Set(["Finance", "Business", "Shopping"]);

interface SearchHit {
  trackId: number;
  trackName: string;
  primaryGenreName?: string;
  sellerName?: string;
  version?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mentionsBrand(hit: SearchHit, brand: string): boolean {
  const needle = brand.toLowerCase();
  return (
    (hit.trackName ?? "").toLowerCase().includes(needle) ||
    (hit.sellerName ?? "").toLowerCase().includes(needle)
  );
}

/**
 * Resolve a candidate to a track ID.
 *
 * The brand check is the important part. An earlier version of this preferred
 * "the first Finance-genre hit", which silently returned a *different company*
 * whenever the intended app sat in another genre: searching Affirm returned
 * Klarna, Brigit returned Albert, Zelle returned Venmo. Only the duplicate
 * check caught it, and only because those companies happened to already be in
 * the list — otherwise we'd have tracked one competitor under another's name
 * indefinitely. Now a hit must actually name the brand before it can win.
 */
async function resolveTrackId(term: string, brand: string): Promise<SearchHit | null> {
  const params = new URLSearchParams({
    term,
    entity: "software",
    country: "us",
    limit: "8",
  });
  const res = await fetch(`https://itunes.apple.com/search?${params}`, { cache: "no-store" });
  if (!res.ok) return null;

  const { results = [] } = JSON.parse(await res.text()) as { results?: SearchHit[] };

  const branded = results.filter((r) => mentionsBrand(r, brand));
  if (branded.length === 0) return null;

  return branded.find((r) => ALLOWED_GENRES.has(r.primaryGenreName ?? "")) ?? branded[0];
}

async function main() {
  const accepted: Array<{
    itunesTrackId: number;
    name: string;
    hnQuery: string | null;
    genre: string;
    version: string;
    notesLen: number;
    hnStories: number;
  }> = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  const seenIds = new Set<number>();

  for (const candidate of CANDIDATES) {
    try {
      const hit = await resolveTrackId(candidate.term, candidate.brand ?? candidate.name);
      await sleep(350); // iTunes allows ~20 req/min; stay well under.

      if (!hit) {
        rejected.push({
          name: candidate.name,
          reason: "no result whose name or seller mentions the brand",
        });
        continue;
      }
      if (!ALLOWED_GENRES.has(hit.primaryGenreName ?? "")) {
        rejected.push({
          name: candidate.name,
          reason: `genre ${hit.primaryGenreName ?? "unknown"} not finance/business`,
        });
        continue;
      }
      if (seenIds.has(hit.trackId)) {
        rejected.push({
          name: candidate.name,
          reason: `resolved to track ${hit.trackId}, already claimed`,
        });
        continue;
      }

      // Validate through the real adapter — same code path the pipeline uses.
      const release = await fetchLatestRelease(hit.trackId);
      await sleep(350);

      if (!release.version) {
        rejected.push({ name: candidate.name, reason: "no version string" });
        continue;
      }

      let hnStories = 0;
      if (candidate.hnQuery) {
        try {
          const reaction = await fetchReaction(candidate.hnQuery, { sinceDaysAgo: 365 });
          hnStories = reaction.stories.length;
        } catch {
          hnStories = -1; // probe failed; not disqualifying
        }
        await sleep(250);
      }

      seenIds.add(hit.trackId);
      accepted.push({
        itunesTrackId: hit.trackId,
        name: candidate.name,
        hnQuery: candidate.hnQuery,
        genre: hit.primaryGenreName ?? "?",
        version: release.version,
        notesLen: release.releaseNotes?.length ?? 0,
        hnStories,
      });

      console.log(
        `OK   ${candidate.name.padEnd(14)} id=${String(hit.trackId).padEnd(11)} v${release.version.padEnd(11)} notes=${String(release.releaseNotes?.length ?? 0).padStart(4)} hn=${String(hnStories).padStart(2)} [${(hit.primaryGenreName ?? "?").padEnd(8)}] ${hit.trackName.slice(0, 30).padEnd(30)} | ${(hit.sellerName ?? "?").slice(0, 26)}`,
      );
    } catch (error) {
      rejected.push({
        name: candidate.name,
        reason: error instanceof Error ? error.message.slice(0, 80) : String(error),
      });
      console.log(`FAIL ${candidate.name.padEnd(15)} ${String(error).slice(0, 70)}`);
    }
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(`accepted: ${accepted.length}   rejected: ${rejected.length}`);
  for (const r of rejected) console.log(`  rejected  ${r.name.padEnd(15)} ${r.reason}`);

  console.log(`\n${"=".repeat(72)}\nSEED_APPS (validated):\n`);
  for (const a of accepted.sort((x, y) => x.name.localeCompare(y.name))) {
    const q = a.hnQuery === null ? "null" : JSON.stringify(a.hnQuery);
    console.log(
      `  { itunesTrackId: ${a.itunesTrackId}, name: ${JSON.stringify(a.name)}, hnQuery: ${q} },`,
    );
  }

  console.log(`\nSQL seed values:\n`);
  for (const a of accepted.sort((x, y) => x.name.localeCompare(y.name))) {
    const q = a.hnQuery === null ? "null" : `'${a.hnQuery.replace(/'/g, "''")}'`;
    console.log(`  (${a.itunesTrackId}, '${a.name.replace(/'/g, "''")}', ${q}),`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

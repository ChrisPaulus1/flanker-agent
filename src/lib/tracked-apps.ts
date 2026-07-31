/**
 * The competitor set Flanker tracks.
 *
 * Every entry here was produced and validated by scripts/discover-apps.ts, not
 * typed by hand. Each one was resolved from a search term, then checked:
 *   - the resolved app's name or seller actually mentions the brand
 *   - a lookup by that ID returns the same ID
 *   - the App Store genre is finance-adjacent
 *   - it has a non-empty version string
 *
 * The brand check matters more than it sounds. Resolving on "first
 * finance-genre hit" alone returned Klarna for Affirm, Albert for Brigit and
 * Venmo for Zelle — the fuzzy search will happily hand back a competitor's
 * neighbour, and nothing downstream would ever notice.
 *
 * `hnQuery: null` means the brand name is too generic to search Hacker News
 * usefully, so HN is skipped for that app rather than feeding the model noise.
 * These were each verified by inspecting what the query actually returns:
 * "Wise" matches "depth-wise aggregation", "Ramp" matches "off-ramp" and
 * "acquisition ramp", "Affirm" matches "Researchers affirm", "Current" matches
 * "current HTML boilerplate". The client-side title filter can't rescue a word
 * that legitimately appears in unrelated titles.
 */
export interface SeedApp {
  itunesTrackId: number;
  name: string;
  hnQuery: string | null;
}

export const SEED_APPS: SeedApp[] = [
  // Neobanks and consumer banking
  { itunesTrackId: 836215269, name: "Chime", hnQuery: "Chime" },
  { itunesTrackId: 932493382, name: "Revolut", hnQuery: "Revolut" },
  { itunesTrackId: 1517676784, name: "Varo Bank", hnQuery: "Varo" },
  { itunesTrackId: 1077366211, name: "Current", hnQuery: null },
  { itunesTrackId: 1191985736, name: "SoFi", hnQuery: "SoFi" },
  { itunesTrackId: 1052238659, name: "Monzo", hnQuery: "Monzo" },
  { itunesTrackId: 956857223, name: "N26", hnQuery: "N26" },
  { itunesTrackId: 514374715, name: "Ally", hnQuery: "Ally Bank" },

  // Earned-wage access and cash advance
  { itunesTrackId: 1193801909, name: "Dave", hnQuery: null },
  { itunesTrackId: 1057771088, name: "Albert", hnQuery: null },
  { itunesTrackId: 1064677082, name: "MoneyLion", hnQuery: "MoneyLion" },
  { itunesTrackId: 723815926, name: "EarnIn", hnQuery: "EarnIn" },
  { itunesTrackId: 1341884073, name: "Brigit", hnQuery: null },

  // Payments and transfers
  { itunesTrackId: 711923939, name: "Cash App", hnQuery: "Cash App" },
  { itunesTrackId: 351727428, name: "Venmo", hnQuery: "Venmo" },
  { itunesTrackId: 283646709, name: "PayPal", hnQuery: "PayPal" },
  { itunesTrackId: 612261027, name: "Wise", hnQuery: null },
  { itunesTrackId: 674258465, name: "Remitly", hnQuery: "Remitly" },

  // Buy now, pay later
  { itunesTrackId: 1115120118, name: "Klarna", hnQuery: "Klarna" },
  { itunesTrackId: 967040652, name: "Affirm", hnQuery: null },
  { itunesTrackId: 1401019110, name: "Afterpay", hnQuery: "Afterpay" },

  // Investing and wealth
  { itunesTrackId: 938003185, name: "Robinhood", hnQuery: "Robinhood" },
  { itunesTrackId: 1204112719, name: "Public", hnQuery: "Public.com" },
  { itunesTrackId: 883324671, name: "Acorns", hnQuery: "Acorns" },
  { itunesTrackId: 393156562, name: "Betterment", hnQuery: "Betterment" },
  { itunesTrackId: 816020992, name: "Wealthfront", hnQuery: "Wealthfront" },
  { itunesTrackId: 1179213067, name: "Webull", hnQuery: "Webull" },

  // Crypto
  { itunesTrackId: 886427730, name: "Coinbase", hnQuery: "Coinbase" },

  // Business banking and spend management
  { itunesTrackId: 1628197245, name: "Ramp", hnQuery: null },
  { itunesTrackId: 1472905508, name: "Brex", hnQuery: "Brex" },
];

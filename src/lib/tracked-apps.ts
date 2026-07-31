/**
 * The competitor set Flanker tracks, used to seed the `tracked_apps` table.
 *
 * Track IDs are pinned rather than resolved by name search — see the note in
 * sources/itunes.ts.
 *
 * `hnQuery` is a plain phrase, deliberately. Algolia's HN index has no boolean
 * operators — a query of `"Chime" AND (bank OR fintech)` returns zero hits
 * because AND/OR/parens are matched as literal words. Disambiguation of noisy
 * brand names happens client-side in sources/hn.ts, which requires the phrase
 * in the story *title*.
 *
 * `hnQuery: null` means the brand name is too generic to search reliably and
 * HN is skipped entirely for that app. That is a deliberate choice over
 * returning plausible-looking noise: a query for Current returns 18k hits
 * about "current HTML boilerplate" and "current nuclear fusion tech", none of
 * which have anything to do with the neobank, and the title filter can't save
 * it because the word legitimately appears in those titles.
 */
export interface SeedApp {
  itunesTrackId: number;
  name: string;
  hnQuery: string | null;
}

export const SEED_APPS: SeedApp[] = [
  { itunesTrackId: 836215269, name: "Chime", hnQuery: "Chime" },
  { itunesTrackId: 932493382, name: "Revolut", hnQuery: "Revolut" },
  { itunesTrackId: 938003185, name: "Robinhood", hnQuery: "Robinhood" },
  { itunesTrackId: 711923939, name: "Cash App", hnQuery: "Cash App" },
  { itunesTrackId: 1517676784, name: "Varo Bank", hnQuery: "Varo" },
  // "Current" is unsearchable on HN: 18k hits, effectively all unrelated.
  { itunesTrackId: 1077366211, name: "Current", hnQuery: null },
  { itunesTrackId: 1204112719, name: "Public", hnQuery: "Public.com" },
];

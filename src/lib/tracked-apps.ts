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
 * in the story *title*; that alone is enough to drop the wind-chime and
 * notification-sound false positives.
 */
export interface SeedApp {
  itunesTrackId: number;
  name: string;
  hnQuery: string;
}

export const SEED_APPS: SeedApp[] = [
  { itunesTrackId: 836215269, name: "Chime", hnQuery: "Chime" },
  { itunesTrackId: 932493382, name: "Revolut", hnQuery: "Revolut" },
  { itunesTrackId: 938003185, name: "Robinhood", hnQuery: "Robinhood" },
  { itunesTrackId: 711923939, name: "Cash App", hnQuery: "Cash App" },
];

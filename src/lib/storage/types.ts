import type { LlmTriage, SignalLevel } from "@/lib/llm/schema";

export interface TrackedApp {
  id: string;
  itunesTrackId: number;
  name: string;
  lastSeenVersion: string | null;
  lastCheckedAt: string | null;
  enabled: boolean;
}

/**
 * A version Flanker has observed, analysed or not.
 *
 * Detection is cheap and unbounded; analysis is expensive and lazy. Keeping
 * them in separate tables is what lets the catalogue be watched without
 * spending model budget on apps nobody has opened.
 */
export interface ObservedRelease {
  itunesTrackId: number;
  version: string;
  releaseNotes: string | null;
  releaseDate: string | null;
  firstSeenAt: string;
}

export interface FlankerEvent {
  id: string;
  appId: string;
  version: string;
  releaseNotes: string | null;
  releaseDate: string | null;
  llmOutput: LlmTriage;
  signalLevel: SignalLevel;
  /** Which Gemini model produced llmOutput; null for rows written before this was tracked. */
  model: string | null;
  detectedAt: string;
  emailSentAt: string | null;
}

export interface FlankerEventWithApp extends FlankerEvent {
  app: Pick<TrackedApp, "id" | "name" | "itunesTrackId">;
}

export interface NewEventInput {
  appId: string;
  version: string;
  releaseNotes: string | null;
  releaseDate: string | null;
  llmOutput: LlmTriage;
  signalLevel: SignalLevel;
  model: string;
}

export interface CatalogApp {
  itunesTrackId: number;
  name: string;
  developer: string | null;
  genre: string | null;
  iconUrl: string | null;
  version: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  popularityRank: number | null;
}

/**
 * The storage seam.
 *
 * The pipeline depends on this interface rather than on Supabase directly, so
 * the idempotency logic can be exercised against an in-memory fake with no
 * network and no database.
 */
export interface FlankerRepo {
  listTrackedApps(options?: { enabledOnly?: boolean }): Promise<TrackedApp[]>;
  findEvent(appId: string, version: string): Promise<FlankerEvent | null>;
  insertEvent(input: NewEventInput): Promise<FlankerEvent>;
  markEmailSent(eventId: string, sentAt: string): Promise<void>;
  /** Advances the change-detection cursor. Only ever called after a full success. */
  advanceLastSeenVersion(appId: string, version: string, checkedAt: string): Promise<void>;
  /** Records that we looked, without moving the cursor. */
  touchLastChecked(appId: string, checkedAt: string): Promise<void>;
  listRecentEvents(limit?: number): Promise<FlankerEventWithApp[]>;
  /** Tracked-app row for a store id, if this app has ever been analysed. */
  findTrackedByItunesId(itunesTrackId: number): Promise<TrackedApp | null>;
  /** Promote a catalog app into the monitored set on first view. */
  createTrackedApp(input: {
    itunesTrackId: number;
    name: string;
  }): Promise<TrackedApp>;
  /** Generations since a timestamp, for the daily budget guard. */
  countEventsSince(sinceIso: string): Promise<number>;
  /** Every stored release for one app, newest first. */
  listEventsForApp(appId: string, limit?: number): Promise<FlankerEventWithApp[]>;
  /** Demo affordance: rewind the cursor so the next run re-detects current data. */
  setLastSeenVersion(appId: string, version: string | null): Promise<void>;
  /**
   * Demo affordance: forget a stored event so the pipeline genuinely re-runs
   * for that version. Rewinding the cursor alone isn't enough — the event row
   * would short-circuit the run as already-processed.
   */
  deleteEvent(appId: string, version: string): Promise<boolean>;
  /** Bulk-record observed versions. Existing (track, version) pairs are left alone. */
  recordReleases(releases: Omit<ObservedRelease, "firstSeenAt">[]): Promise<number>;
  /** Track IDs of the most popular catalogue apps — the watch set. */
  listPopularTrackIds(limit: number): Promise<number[]>;
  /** Observed history for one app, newest release first. */
  listReleases(itunesTrackId: number, limit?: number): Promise<ObservedRelease[]>;

  // --- catalog ---------------------------------------------------------
  /** Bulk insert/update. Chunked internally; safe to re-run. */
  upsertCatalogApps(apps: CatalogApp[]): Promise<number>;
  /** Prefix match for type-ahead, popularity-ranked, hard-capped. */
  searchCatalogPrefix(prefix: string, limit: number): Promise<CatalogApp[]>;
  /** Substring match for the full search page. */
  searchCatalog(query: string, limit: number): Promise<CatalogApp[]>;
  getCatalogApp(itunesTrackId: number): Promise<CatalogApp | null>;
  countCatalogApps(): Promise<number>;
}

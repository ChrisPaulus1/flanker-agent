import type { HnStory } from "@/lib/sources/hn";
import type { LlmTriage, SignalLevel } from "@/lib/llm/schema";

export interface TrackedApp {
  id: string;
  itunesTrackId: number;
  name: string;
  hnQuery: string;
  lastSeenVersion: string | null;
  lastCheckedAt: string | null;
  enabled: boolean;
}

export interface FlankerEvent {
  id: string;
  appId: string;
  version: string;
  releaseNotes: string | null;
  releaseDate: string | null;
  hnSummary: string | null;
  hnStoryRefs: HnStory[];
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
  hnSummary: string | null;
  hnStoryRefs: HnStory[];
  llmOutput: LlmTriage;
  signalLevel: SignalLevel;
  model: string;
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
  /** Demo affordance: rewind the cursor so the next run re-detects current data. */
  setLastSeenVersion(appId: string, version: string | null): Promise<void>;
}

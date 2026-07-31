import type { AppRelease } from "@/lib/sources/itunes";
import type { HnReaction } from "@/lib/sources/hn";
import type { LlmTriage } from "@/lib/llm/schema";
import type { FlankerEvent, TrackedApp } from "@/lib/storage/types";

/**
 * The dependencies pipeline/run.ts composes.
 *
 * Declared as interfaces so the orchestration — specifically the rules about
 * when the version cursor is allowed to advance — can be tested against fakes
 * with no network, no database, and no LLM spend.
 */

export interface ReleaseSource {
  fetchLatestRelease(trackId: number): Promise<AppRelease>;
}

export interface ReactionSource {
  fetchReaction(query: string): Promise<HnReaction>;
}

export interface TriageEngine {
  triage(input: { app: TrackedApp; release: AppRelease; reaction: HnReaction | null }): Promise<LlmTriage>;
}

export interface AlertSender {
  send(input: { app: TrackedApp; release: AppRelease; event: FlankerEvent }): Promise<void>;
}

/** Injected so tests get deterministic timestamps. */
export type Clock = () => Date;

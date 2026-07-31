import type { AppRelease } from "@/lib/sources/itunes";
import type { HnReaction } from "@/lib/sources/hn";
import type { LlmTriage } from "@/lib/llm/schema";
import type { ViewerContext } from "@/lib/llm/prompt";
import type { TrackedApp } from "@/lib/storage/types";

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

export interface TriageResult {
  output: LlmTriage;
  /**
   * The model that actually produced this. Recorded because the engine
   * degrades to a lighter model when the preferred one hits its daily free
   * quota, and that shouldn't be invisible after the fact.
   */
  model: string;
}

export interface TriageEngine {
  triage(input: {
    app: TrackedApp;
    release: AppRelease;
    reaction: HnReaction | null;
    /**
     * Who is reading. Null produces a teardown with no counter-PRD; supplying
     * a product produces advice written from that product's position.
     */
    viewer?: ViewerContext | null;
  }): Promise<TriageResult>;
}

/** Injected so tests get deterministic timestamps. */
export type Clock = () => Date;

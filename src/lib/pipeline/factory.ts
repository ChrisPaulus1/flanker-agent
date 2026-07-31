import { fetchLatestRelease } from "@/lib/sources/itunes";
import { fetchReaction } from "@/lib/sources/hn";
import { GeminiTriageEngine } from "@/lib/llm/gemini";
import { SupabaseFlankerRepo } from "@/lib/storage/repo";
import type { PipelineDeps } from "@/lib/pipeline/run";

/**
 * Wires the real adapters together.
 *
 * The only place production dependencies are constructed — everything else
 * takes PipelineDeps, which is what lets the pipeline tests run against fakes.
 */
export function createPipelineDeps(): PipelineDeps {
  return {
    repo: new SupabaseFlankerRepo(),
    releases: { fetchLatestRelease: (trackId) => fetchLatestRelease(trackId) },
    reactions: { fetchReaction: (query) => fetchReaction(query) },
    triage: new GeminiTriageEngine(),
  };
}

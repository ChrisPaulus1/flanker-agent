import { fetchLatestRelease } from "@/lib/sources/itunes";
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
    triage: new GeminiTriageEngine(),
  };
}

import { GoogleGenAI } from "@google/genai";
import { config } from "@/lib/config";
import { buildTriagePrompt } from "@/lib/llm/prompt";
import { parseTriageResponse } from "@/lib/llm/parse";
import { listAvailableModels, rankModels } from "@/lib/llm/model";
import type { TriageEngine, TriageResult } from "@/lib/pipeline/ports";
import type { AppRelease } from "@/lib/sources/itunes";
import type { HnReaction } from "@/lib/sources/hn";
import type { TrackedApp } from "@/lib/storage/types";

/** Retried by falling down the candidate list rather than hammering one model. */
function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(message);
}

export class GeminiTriageEngine implements TriageEngine {
  private candidates: string[] | null = null;
  private readonly client: GoogleGenAI;

  constructor(
    private readonly apiKey: string = config.gemini.apiKey,
    private readonly pinnedModel: string = config.gemini.model,
  ) {
    this.client = new GoogleGenAI({ apiKey: this.apiKey });
  }

  /**
   * The models to try, best first. Resolved once per process.
   *
   * A pinned GEMINI_MODEL goes first but does NOT replace the chain: pinning
   * is about avoiding a ListModels round trip and about reproducibility, not
   * about giving up the ability to degrade when the daily free quota runs out.
   * Discovery only happens if the pinned model actually fails.
   */
  private async getCandidates(): Promise<string[]> {
    if (this.candidates) return this.candidates;

    let ranked: string[] = [];
    try {
      ranked = rankModels(await listAvailableModels(this.apiKey));
    } catch (error) {
      // If we have a pinned model we can still work; if not, this is fatal.
      if (!this.pinnedModel) throw error;
      console.warn(`[flanker] ListModels failed, falling back to pinned model: ${String(error)}`);
    }

    const candidates = this.pinnedModel
      ? [this.pinnedModel, ...ranked.filter((m) => m !== this.pinnedModel)]
      : ranked;

    if (candidates.length === 0) {
      throw new Error(
        "No usable Gemini text model is available to this API key — check the key's project has Generative Language API access.",
      );
    }

    this.candidates = candidates;
    return candidates;
  }

  async triage({
    app,
    release,
    reaction,
  }: {
    app: TrackedApp;
    release: AppRelease;
    reaction: HnReaction | null;
  }): Promise<TriageResult> {
    const prompt = buildTriagePrompt({ app, release, reaction });
    const candidates = await this.getCandidates();

    let lastError: unknown;

    // Walk down the ranked list on quota exhaustion. Free-tier daily caps are
    // low enough (100-250/day depending on model) that a backfill plus a few
    // demo triggers can genuinely exhaust the top choice, and degrading to a
    // lighter model beats failing the run.
    for (const model of candidates.slice(0, 4)) {
      try {
        const response = await this.client.models.generateContent({
          model,
          contents: prompt,
          config: {
            // Ask for JSON directly; the tolerant parser is the safety net for
            // when the model ignores this, which still happens.
            responseMimeType: "application/json",
            temperature: 0.4,
          },
        });

        const text = response.text;
        if (!text) throw new Error(`Model ${model} returned an empty response`);

        return { output: parseTriageResponse(text), model };
      } catch (error) {
        lastError = error;
        if (isQuotaError(error)) {
          console.warn(`[flanker] ${model} quota exhausted, trying next candidate`);
          continue;
        }
        throw error;
      }
    }

    throw new Error(
      `All Gemini candidates failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
}

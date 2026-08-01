import { GoogleGenAI } from "@google/genai";
import { config } from "@/lib/config";
import { buildTriagePrompt, type ViewerContext } from "@/lib/llm/prompt";
import { parseTriageResponse } from "@/lib/llm/parse";
import { listAvailableModels, rankModels } from "@/lib/llm/model";
import type { TriageEngine, TriageResult } from "@/lib/pipeline/ports";
import type { AppRelease } from "@/lib/sources/itunes";
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
   * The models to try, best first.
   *
   * A pinned GEMINI_MODEL is used immediately and discovery is skipped
   * entirely — that is the point of pinning, and an earlier version claimed
   * this in a comment while calling ListModels unconditionally, costing an
   * extra network round trip on every cold start for no benefit.
   *
   * Pinning still doesn't give up the fallback chain. If the pinned model
   * fails, `discoverFallbacks` runs then and appends the ranked alternatives,
   * so quota exhaustion still degrades rather than erroring.
   */
  private async getCandidates(): Promise<string[]> {
    if (this.candidates) return this.candidates;

    if (this.pinnedModel) {
      this.candidates = [this.pinnedModel];
      return this.candidates;
    }

    const ranked = rankModels(await listAvailableModels(this.apiKey));
    if (ranked.length === 0) {
      throw new Error(
        "No usable Gemini text model is available to this API key — check the key's project has Generative Language API access.",
      );
    }

    this.candidates = ranked;
    return ranked;
  }

  /**
   * Called only after the pinned model has failed, so the cost of discovery is
   * paid by the rare bad case rather than by every request.
   */
  private async discoverFallbacks(tried: string[]): Promise<string[]> {
    try {
      const ranked = rankModels(await listAvailableModels(this.apiKey));
      return ranked.filter((m) => !tried.includes(m));
    } catch (error) {
      console.warn(`[flanker] ListModels failed while looking for a fallback: ${String(error)}`);
      return [];
    }
  }

  async triage({
    app,
    release,
    viewer = null,
  }: {
    app: TrackedApp;
    release: AppRelease;
    viewer?: ViewerContext | null;
  }): Promise<TriageResult> {
    const prompt = buildTriagePrompt({ app, release, viewer });

    const queue = [...(await this.getCandidates())];
    const tried: string[] = [];
    let discovered = false;

    let lastError: unknown;

    // Walk down the list on quota exhaustion. Free-tier daily caps are low
    // enough that a burst of demand can genuinely exhaust the top choice, and
    // degrading to a lighter model beats failing the request.
    while (queue.length > 0 && tried.length < 4) {
      const model = queue.shift()!;
      tried.push(model);

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
        if (!isQuotaError(error)) throw error;

        console.warn(`[flanker] ${model} quota exhausted, trying next candidate`);

        // First failure with a pinned model: this is the moment discovery is
        // worth paying for, not on every cold start.
        if (queue.length === 0 && !discovered) {
          discovered = true;
          queue.push(...(await this.discoverFallbacks(tried)));
        }
      }
    }

    throw new Error(
      `All Gemini candidates failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
}

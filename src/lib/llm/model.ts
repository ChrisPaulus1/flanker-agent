/**
 * Runtime Gemini model selection.
 *
 * Free-tier model availability changes often — Google cut free quotas sharply
 * in Dec 2025 and the stable line turns over every few months — so this module
 * never hardcodes a model name. It asks the API what exists, ranks what came
 * back, and confirms the winner with a real generation call before committing.
 *
 * Set GEMINI_MODEL to pin a specific model and skip all of this.
 */

export interface ModelInfo {
  /** As returned by the API, e.g. "models/gemini-3.6-flash". */
  name: string;
  supportedActions?: string[];
}

/** Model families that can't do the job, whatever their version number. */
const EXCLUDED = /image|embedding|aqa|tts|audio|live|vision|robotics|computer-use|guard/i;

interface Scored {
  id: string;
  score: number;
}

/**
 * Rank candidates best-first for this workload.
 *
 * Preference order, in priority sequence:
 *   1. newer version family (3.6 beats 3.5 beats 2.5)
 *   2. stable over preview/experimental — previews carry tighter free quotas
 *      and get withdrawn without notice
 *   3. flash over flash-lite over pro — flash is the quality/quota sweet spot;
 *      pro's free allowance (~100/day) is the tightest of the three
 */
export function rankModels(models: ModelInfo[]): string[] {
  const scored: Scored[] = [];

  for (const model of models) {
    const id = model.name.replace(/^models\//, "");

    if (!id.startsWith("gemini-")) continue;
    if (EXCLUDED.test(id)) continue;

    // An explicitly advertised action list that lacks generateContent is
    // disqualifying; a missing list is treated as unknown, not as a refusal.
    if (model.supportedActions && !model.supportedActions.includes("generateContent")) continue;

    const version = id.match(/^gemini-(\d+)(?:\.(\d+))?/);
    if (!version) continue;

    const major = Number(version[1]);
    const minor = Number(version[2] ?? 0);

    const isPreview = /preview|exp|latest/i.test(id);
    const tier = /flash-lite/i.test(id) ? 1 : /flash/i.test(id) ? 2 : /pro/i.test(id) ? 0 : 0;

    // Version dominates, then stability, then tier.
    const score = (major * 100 + minor) * 100 + (isPreview ? 0 : 50) + tier * 10;

    scored.push({ id, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((s) => s.id);
}

export async function listAvailableModels(apiKey: string): Promise<ModelInfo[]> {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": apiKey },
  });

  if (!response.ok) {
    throw new Error(
      `Gemini ListModels failed: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`,
    );
  }

  const { models = [] } = (await response.json()) as { models?: ModelInfo[] };
  return models;
}

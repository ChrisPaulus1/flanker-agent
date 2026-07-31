/**
 * Asks the Gemini API which models this key can actually use, ranks them, and
 * confirms the top choice with a real generation call.
 *
 * Model names are never hardcoded from memory — free-tier availability shifts,
 * so this is the source of truth. Print the winner and paste it into
 * GEMINI_MODEL to pin it, or leave GEMINI_MODEL empty to resolve at runtime.
 */
import "./load-env";
import { GoogleGenAI } from "@google/genai";
import { listAvailableModels, rankModels } from "../src/lib/llm/model";
import { requireEnv } from "../src/lib/config";

async function main() {
  const apiKey = requireEnv("GEMINI_API_KEY");

  const all = await listAvailableModels(apiKey);
  console.log(`ListModels returned ${all.length} models`);

  const ranked = rankModels(all);
  if (ranked.length === 0) {
    throw new Error("No usable text-generation Gemini model available to this key.");
  }

  console.log("\nRanked candidates (best first):");
  ranked.slice(0, 8).forEach((id, i) => console.log(`  ${i + 1}. ${id}`));

  const client = new GoogleGenAI({ apiKey });

  console.log("\nConfirming with a real generateContent call...");
  for (const model of ranked.slice(0, 4)) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: 'Reply with exactly this JSON and nothing else: {"ok":true}',
        config: { responseMimeType: "application/json", temperature: 0 },
      });
      console.log(`  ${model}: OK -> ${response.text?.trim()}`);
      console.log(`\nUse this model:\n  GEMINI_MODEL=${model}`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Surface the quotaId: it distinguishes a per-minute limit (wait and
      // retry) from a per-day one (this model is done until midnight PT), and
      // the retryDelay field is misleading for the latter.
      const quotaId = message.match(/"quotaId":\s*"([^"]+)"/)?.[1];
      console.log(`  ${model}: FAILED -> ${quotaId ?? message.slice(0, 140)}`);
    }
  }

  throw new Error("Every top candidate failed a live call.");
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});

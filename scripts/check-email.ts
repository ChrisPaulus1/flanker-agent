/**
 * Sends one real alert email through Resend, built from real current release
 * data for a tracked app. No database writes.
 *
 * Usage: npx tsx scripts/check-email.ts [app-name-substring]
 *
 * The LLM step is skipped by default so this doesn't burn Gemini quota just to
 * check email delivery — pass --triage to run the real analysis instead of the
 * placeholder.
 */
import "./load-env";
import { fetchLatestRelease } from "../src/lib/sources/itunes";
import { fetchReaction } from "../src/lib/sources/hn";
import { GeminiTriageEngine } from "../src/lib/llm/gemini";
import { ResendAlertSender } from "../src/lib/email/resend";
import { SEED_APPS } from "../src/lib/tracked-apps";
import { config } from "../src/lib/config";
import type { LlmTriage } from "../src/lib/llm/schema";
import type { FlankerEvent, TrackedApp } from "../src/lib/storage/types";

const PLACEHOLDER: LlmTriage = {
  headline: "Delivery test — this analysis is a placeholder, not model output",
  signal_level: "medium",
  feature_analysis:
    "This email was sent by scripts/check-email.ts to verify Resend delivery and rendering. Run with --triage to populate this from a real Gemini call.",
  strategic_read: "Not applicable — placeholder content.",
  hn_reaction_summary: null,
  counter_prd: {
    problem_statement: "Placeholder problem statement.",
    why_now: "Placeholder rationale.",
    proposed_feature: "Placeholder proposal.",
    success_metric: "Placeholder metric.",
  },
};

async function main() {
  const useTriage = process.argv.includes("--triage");
  const nameArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const seed = nameArg
    ? SEED_APPS.find((a) => a.name.toLowerCase().includes(nameArg.toLowerCase()))
    : SEED_APPS.find((a) => a.name === "Varo Bank");

  if (!seed) throw new Error(`No tracked app matches ${JSON.stringify(nameArg)}`);

  const app: TrackedApp = {
    id: "dry-run",
    itunesTrackId: seed.itunesTrackId,
    name: seed.name,
    hnQuery: seed.hnQuery,
    lastSeenVersion: null,
    lastCheckedAt: null,
    enabled: true,
  };

  const release = await fetchLatestRelease(app.itunesTrackId);
  console.log(`${app.name} v${release.version}`);

  let llmOutput = PLACEHOLDER;
  let model = "none (placeholder)";

  if (useTriage) {
    let reaction = null;
    if (app.hnQuery) {
      try {
        reaction = await fetchReaction(app.hnQuery);
      } catch {
        reaction = null;
      }
    }
    const result = await new GeminiTriageEngine().triage({ app, release, reaction });
    llmOutput = result.output;
    model = result.model;
    console.log(`triaged by ${model}: ${llmOutput.signal_level}`);
  }

  const event: FlankerEvent = {
    id: "dry-run-event",
    appId: app.id,
    version: release.version,
    releaseNotes: release.releaseNotes,
    releaseDate: release.releaseDate,
    hnSummary: llmOutput.hn_reaction_summary,
    hnStoryRefs: [],
    llmOutput,
    signalLevel: llmOutput.signal_level,
    model,
    detectedAt: new Date().toISOString(),
    emailSentAt: null,
  };

  await new ResendAlertSender().send({ app, release, event });
  console.log(`\nSent to ${config.email.to} from ${config.email.from}`);
  console.log("Check the inbox — if nothing arrives, look in spam before assuming success.");
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});

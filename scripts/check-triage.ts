/**
 * Runs a real triage against real current release data for every tracked app.
 * No database writes and no email — this only exercises the LLM step.
 *
 * Worth running against the live set because the two interesting cases both
 * occur naturally: apps whose notes are pure filler ("Bug Fixes and
 * Improvements") should come back low signal, and apps with no HN discussion
 * should come back with a null reaction summary rather than an invented one.
 */
import "./load-env";
import { fetchLatestRelease } from "../src/lib/sources/itunes";
import { fetchReaction } from "../src/lib/sources/hn";
import { GeminiTriageEngine } from "../src/lib/llm/gemini";
import { SEED_APPS } from "../src/lib/tracked-apps";
import type { TrackedApp } from "../src/lib/storage/types";

async function main() {
  const engine = new GeminiTriageEngine();
  const only = process.argv[2]?.toLowerCase();
  const apps = only ? SEED_APPS.filter((a) => a.name.toLowerCase().includes(only)) : SEED_APPS;

  for (const seed of apps) {
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
    let reaction = null;
    if (app.hnQuery) {
      try {
        reaction = await fetchReaction(app.hnQuery);
      } catch {
        reaction = null;
      }
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`${app.name} v${release.version}`);
    console.log(`notes: ${(release.releaseNotes ?? "<none>").slice(0, 200).replace(/\n/g, " ")}`);
    console.log(`hn: ${reaction?.stories.length ?? 0} stories, ${reaction?.comments.length ?? 0} comments`);
    console.log("-".repeat(70));

    const { output: triage, model } = await engine.triage({ app, release, reaction });

    console.log(`model       : ${model}`);

    console.log(`signal      : ${triage.signal_level}`);
    console.log(`headline    : ${triage.headline}`);
    console.log(`feature     : ${triage.feature_analysis}`);
    console.log(`strategic   : ${triage.strategic_read}`);
    console.log(`hn reaction : ${triage.hn_reaction_summary ?? "null (no discussion found)"}`);
    console.log(`counter-PRD :`);
    console.log(`  problem   : ${triage.counter_prd.problem_statement}`);
    console.log(`  why now   : ${triage.counter_prd.why_now}`);
    console.log(`  proposal  : ${triage.counter_prd.proposed_feature}`);
    console.log(`  metric    : ${triage.counter_prd.success_metric}`);
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});

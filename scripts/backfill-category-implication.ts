/**
 * Re-runs triage for stored analyses that predate `category_implication`.
 *
 * Those rows render the advice section with a generic fallback line, which is
 * honest but flat. Regenerating fills in the real category-level read so old
 * and new cards look the same.
 *
 * Only touches rows where the field is missing, so re-running is cheap and
 * safe. Counts against the daily budget like any other generation.
 *
 *   npx tsx scripts/backfill-category-implication.ts
 *   npx tsx scripts/backfill-category-implication.ts --limit 10
 */
import "./load-env";
import { getSupabase } from "../src/lib/storage/client";
import { SupabaseFlankerRepo } from "../src/lib/storage/repo";
import { GeminiTriageEngine } from "../src/lib/llm/gemini";
import { fetchLatestRelease } from "../src/lib/sources/itunes";
import { budgetState, pacificDayStart } from "../src/lib/pipeline/budget";

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const db = getSupabase();
  const repo = new SupabaseFlankerRepo();
  const engine = new GeminiTriageEngine();

  const events = await repo.listRecentEvents(500);
  const missing = events.filter((e) => !e.llmOutput.category_implication);
  const stale = missing.slice(0, limit);

  // Report both numbers. An earlier version logged the post-slice count as
  // "missing", so `--limit 3` reported "3 missing" against 31 actually stale
  // rows — a status line that quietly lied about how much work was left.
  console.log(
    `${events.length} events, ${missing.length} missing category_implication` +
      (stale.length < missing.length ? `, processing ${stale.length} (--limit)` : ""),
  );
  if (stale.length === 0) return;

  const budget = budgetState(await repo.countEventsSince(pacificDayStart().toISOString()));
  console.log(`budget: ${budget.used}/${budget.limit} used today\n`);
  if (budget.remaining < stale.length) {
    console.warn(`only ${budget.remaining} generations left today — will stop when spent\n`);
  }

  let done = 0;
  let failed = 0;

  for (const event of stale) {
    if (done >= budget.remaining) {
      console.warn("daily budget reached, stopping");
      break;
    }

    try {
      const tracked = await repo.findTrackedByItunesId(event.app.itunesTrackId);
      if (!tracked) {
        console.log(`  skip ${event.app.name}: no tracked row`);
        continue;
      }

      const release = await fetchLatestRelease(event.app.itunesTrackId);
      const { output } = await engine.triage({
        app: tracked,
        release,
        reaction: null,
        viewer: null,
      });

      // Only the new field is written. The stored headline, analysis and
      // signal level were generated against the release that was live at the
      // time, and overwriting them would silently rewrite history.
      const merged = { ...event.llmOutput, category_implication: output.category_implication };

      const { error } = await db
        .from("events")
        .update({ llm_output_json: merged })
        .eq("id", event.id);
      if (error) throw new Error(error.message);

      done++;
      console.log(
        `  ${event.app.name.padEnd(14)} ${(output.category_implication ?? "").slice(0, 88)}`,
      );
    } catch (error) {
      failed++;
      console.log(`  FAIL ${event.app.name}: ${String(error).slice(0, 90)}`);
    }
  }

  console.log(`\nupdated ${done}, failed ${failed}`);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});

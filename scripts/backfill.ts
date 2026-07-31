/**
 * One-time backfill.
 *
 * Runs the full pipeline once against every tracked app's *current* version so
 * a fresh deployment has real populated history immediately, rather than an
 * empty dashboard until the next genuine competitor release.
 *
 * This is the same pipeline the cron runs, not a special path — which is
 * deliberate. It means the backfill exercises exactly the code that will run in
 * production, and it inherits the same idempotency: running it twice is a
 * no-op, so it's safe to re-run if it fails partway.
 *
 *   npx tsx scripts/backfill.ts
 */
import "./load-env";
import { createPipelineDeps } from "../src/lib/pipeline/factory";
import { runPipeline } from "../src/lib/pipeline/run";

async function main() {
  console.log("Running the full pipeline against every tracked app's current version.");
  console.log("Safe to re-run — already-processed releases are skipped.\n");

  const startedAt = Date.now();
  const results = await runPipeline(createPipelineDeps());
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log("");
  for (const result of results) {
    const detail = result.detail ? ` — ${result.detail}` : "";
    console.log(
      `  ${result.app.padEnd(11)} ${result.status.padEnd(18)} ${(result.version ?? "").padEnd(11)}${detail}`,
    );
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\nFinished in ${seconds}s: ${JSON.stringify(summary)}`);

  const failed = results.filter((r) => r.status === "failed");
  if (failed.length > 0) {
    console.error(
      `\n${failed.length} app(s) failed. Their version cursors were left untouched, so re-running picks them up again.`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});

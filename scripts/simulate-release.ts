/**
 * Demo trigger: make the next pipeline run treat an app's *current* release as
 * newly detected.
 *
 * No API data is faked. This only rewinds Flanker's own memory — the pipeline
 * then re-runs against whatever the App Store actually returns
 * right now, calls the real LLM and stores a real event.
 *
 * Rewinding last_seen_version alone is not enough: the stored event for that
 * version would short-circuit the run as already-processed, which is exactly
 * the idempotency behaviour we want in production. So the event row is deleted
 * too, unless --keep-event is passed (useful for demonstrating that the
 * idempotency check does hold).
 *
 *   npx tsx scripts/simulate-release.ts varo
 *   npx tsx scripts/simulate-release.ts varo --keep-event
 *   npx tsx scripts/simulate-release.ts --all
 */
import "./load-env";
import { SupabaseFlankerRepo } from "../src/lib/storage/repo";

async function main() {
  const args = process.argv.slice(2);
  const keepEvent = args.includes("--keep-event");
  const all = args.includes("--all");
  const nameArg = args.find((a) => !a.startsWith("--"));

  if (!nameArg && !all) {
    console.error("Usage: tsx scripts/simulate-release.ts <app-name> [--keep-event]");
    console.error("       tsx scripts/simulate-release.ts --all");
    process.exit(1);
  }

  const repo = new SupabaseFlankerRepo();
  const apps = await repo.listTrackedApps({ enabledOnly: false });

  const targets = all
    ? apps
    : apps.filter((a) => a.name.toLowerCase().includes(nameArg!.toLowerCase()));

  if (targets.length === 0) {
    console.error(`No tracked app matches ${JSON.stringify(nameArg)}.`);
    console.error(`Known apps: ${apps.map((a) => a.name).join(", ")}`);
    process.exit(1);
  }

  for (const app of targets) {
    const version = app.lastSeenVersion;
    console.log(`${app.name}: last_seen_version ${version ?? "<never>"} -> null`);
    await repo.setLastSeenVersion(app.id, null);

    if (version && !keepEvent) {
      const deleted = await repo.deleteEvent(app.id, version);
      console.log(`  ${deleted ? "deleted" : "no"} stored event for v${version}`);
    } else if (version) {
      console.log(`  kept stored event for v${version} — the next run should report already-processed`);
    }
  }

  console.log(
    `\nNow trigger a run:\n` +
      `  curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/poll\n` +
      `or npx tsx scripts/backfill.ts`,
  );
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});

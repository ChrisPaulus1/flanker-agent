/**
 * Verifies the storage layer against the real Supabase project: confirms the
 * schema is applied, the competitor set is seeded, and the unique constraint
 * that underpins idempotency is actually enforced by the database.
 *
 * Run with `npx tsx scripts/check-storage.ts` after applying supabase/schema.sql.
 */
import "./load-env";
import { getSupabase } from "../src/lib/storage/client";
import { SupabaseFlankerRepo } from "../src/lib/storage/repo";

async function main() {
  const repo = new SupabaseFlankerRepo();

  const apps = await repo.listTrackedApps();
  console.log(`tracked_apps: ${apps.length} enabled`);
  for (const app of apps) {
    console.log(
      `  - ${app.name.padEnd(10)} track=${app.itunesTrackId} last_seen=${app.lastSeenVersion ?? "<never>"}`,
    );
  }
  if (apps.length === 0) {
    throw new Error("No tracked apps found — did supabase/schema.sql run?");
  }

  const events = await repo.listRecentEvents(5);
  console.log(`\nevents: ${events.length} recent`);
  for (const event of events) {
    console.log(`  - ${event.app.name} v${event.version} [${event.signalLevel}] ${event.detectedAt}`);
  }

  // Prove the (app_id, version) unique constraint exists. This is the backstop
  // the whole idempotency story rests on, so it's worth confirming that the
  // database enforces it rather than trusting that the DDL ran.
  const db = getSupabase();
  const probeVersion = `__constraint_probe_${Date.now()}`;
  const probe = {
    app_id: apps[0].id,
    version: probeVersion,
    llm_output_json: {},
    signal_level: "low",
  };

  const first = await db.from("events").insert(probe).select("id").single();
  if (first.error) throw new Error(`probe insert failed: ${first.error.message}`);

  const second = await db.from("events").insert(probe).select("id").single();
  const rejectedAsDuplicate = second.error?.code === "23505";

  await db.from("events").delete().eq("id", first.data.id);

  if (!rejectedAsDuplicate) {
    throw new Error(
      `Expected duplicate (app_id, version) to be rejected, got: ${second.error?.message ?? "no error"}`,
    );
  }
  console.log("\nunique (app_id, version): enforced — duplicate insert rejected with 23505");
  console.log("probe row cleaned up");
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});

/**
 * Syncs SEED_APPS into the tracked_apps table.
 *
 * Upsert on itunes_track_id, so it's safe to re-run and it never clobbers
 * last_seen_version — seeding must not be able to replay alerts for releases
 * already processed.
 *
 * Apps present in the database but no longer in SEED_APPS are disabled rather
 * than deleted, so their event history survives on the dashboard.
 *
 *   npx tsx scripts/seed-apps.ts
 */
import "./load-env";
import { getSupabase } from "../src/lib/storage/client";
import { SEED_APPS } from "../src/lib/tracked-apps";

async function main() {
  const db = getSupabase();

  const { data: before, error: readError } = await db
    .from("tracked_apps")
    .select("itunes_track_id, name, enabled");
  if (readError) throw new Error(`read failed: ${readError.message}`);

  const existing = new Map((before ?? []).map((r) => [Number(r.itunes_track_id), r]));
  const seedIds = new Set(SEED_APPS.map((a) => a.itunesTrackId));

  const { error: upsertError } = await db.from("tracked_apps").upsert(
    SEED_APPS.map((app) => ({
      itunes_track_id: app.itunesTrackId,
      name: app.name,
      hn_query: app.hnQuery,
      enabled: true,
    })),
    { onConflict: "itunes_track_id" },
  );
  if (upsertError) throw new Error(`upsert failed: ${upsertError.message}`);

  const stale = (before ?? []).filter((r) => !seedIds.has(Number(r.itunes_track_id)));
  if (stale.length > 0) {
    const { error } = await db
      .from("tracked_apps")
      .update({ enabled: false })
      .in(
        "itunes_track_id",
        stale.map((r) => r.itunes_track_id),
      );
    if (error) throw new Error(`disable failed: ${error.message}`);
  }

  const { data: after, error: verifyError } = await db
    .from("tracked_apps")
    .select("itunes_track_id, name, hn_query, enabled, last_seen_version")
    .eq("enabled", true)
    .order("name");
  if (verifyError) throw new Error(`verify failed: ${verifyError.message}`);

  const added = SEED_APPS.filter((a) => !existing.has(a.itunesTrackId));
  console.log(`added ${added.length}, disabled ${stale.length}, enabled total ${after?.length ?? 0}`);
  for (const a of added) console.log(`  + ${a.name}`);
  for (const s of stale) console.log(`  - ${s.name} (disabled, history kept)`);

  // Verify what actually landed rather than trusting the write.
  const missing = SEED_APPS.filter(
    (a) => !(after ?? []).some((r) => Number(r.itunes_track_id) === a.itunesTrackId),
  );
  if (missing.length > 0) {
    throw new Error(`these seeds did not land: ${missing.map((m) => m.name).join(", ")}`);
  }

  const mismatched = (after ?? []).filter((row) => {
    const seed = SEED_APPS.find((a) => a.itunesTrackId === Number(row.itunes_track_id));
    return seed && (seed.name !== row.name || (seed.hnQuery ?? null) !== (row.hn_query ?? null));
  });
  if (mismatched.length > 0) {
    throw new Error(`rows disagree with SEED_APPS: ${mismatched.map((m) => m.name).join(", ")}`);
  }

  console.log("verified: every seed row is present and matches SEED_APPS");
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});

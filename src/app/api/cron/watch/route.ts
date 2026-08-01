import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/auth";
import { config } from "@/lib/config";
import { SupabaseFlankerRepo } from "@/lib/storage/repo";
import { runWatchSweep } from "@/lib/pipeline/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 2,000 apps is ten batched lookups plus pacing — well under a minute in
 * practice. The ceiling is generous because a slow upstream shouldn't truncate
 * a sweep partway and leave half the catalogue unobserved.
 */
export const maxDuration = 300;

/** How many of the most popular apps to watch. */
const WATCH_SET_SIZE = 2_000;

/**
 * Detection sweep.
 *
 * Deliberately separate from /api/cron/poll: this one never calls the LLM, so
 * it can run often and across the whole watch set without touching the daily
 * model budget that interactive visitors depend on. Its only job is to notice
 * that a version changed and write down what shipped.
 */
async function handle(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), config.cronSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const repo = new SupabaseFlankerRepo();

    // Popularity order, so the watch set is the apps people actually search
    // for. Everything else stays searchable and analysable on demand — it just
    // won't accumulate history until someone opens it.
    const trackIds = await repo.listPopularTrackIds(WATCH_SET_SIZE);

    const result = await runWatchSweep(trackIds, { repo });

    // Written after the sweep, not before, so the timestamp means "last
    // completed check" rather than "last attempt". A sweep that saw no new
    // versions writes no releases and no events — without this row there'd be
    // no evidence it ran at all, which is exactly why the dashboard used to
    // report an app as unchecked for 17 hours an hour after checking it.
    await repo.recordMonitorRun({
      appsChecked: result.appsChecked,
      newReleases: result.newReleases,
      failedBatches: result.failedBatches,
    });

    console.log(
      `[flanker] watch sweep: ${result.appsChecked} apps, ${result.newReleases} new releases, ` +
        `${result.failedBatches} failed batches, ${result.durationMs}ms`,
    );

    return NextResponse.json({ ok: true, watchSetSize: trackIds.length, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[flanker] watch sweep failed: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;

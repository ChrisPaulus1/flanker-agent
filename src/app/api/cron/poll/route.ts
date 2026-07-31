import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/auth";
import { config } from "@/lib/config";
import { createPipelineDeps } from "@/lib/pipeline/factory";
import { runPipeline } from "@/lib/pipeline/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A seven-app run measures around 60s (roughly 2.5s per Gemini call plus the
 * source fetches). Hobby allows 300s, so this has comfortable headroom.
 */
export const maxDuration = 300;

/**
 * Cron entrypoint.
 *
 * Safe to call repeatedly and concurrently-ish: every app's work is guarded by
 * the version cursor and the unique (app_id, version) constraint, so a double
 * fire produces no duplicate events and no duplicate alerts. That's what makes
 * it acceptable to have both Vercel Cron (daily, the Hobby limit) and a GitHub
 * Actions schedule (hourly) hitting the same URL.
 */
async function handle(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), config.cronSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const results = await runPipeline(createPipelineDeps());
    const durationMs = Date.now() - startedAt;

    const summary = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`[flanker] run finished in ${durationMs}ms`, JSON.stringify(summary));

    // A failed app is reported in the body, not as a 500: the run itself
    // succeeded, and returning 500 would make the cron look broken when six of
    // seven apps were processed fine.
    return NextResponse.json({
      ok: true,
      durationMs,
      summary,
      results,
    });
  } catch (error) {
    // Only reached if the run couldn't start at all — bad config, or the
    // tracked_apps query failed. No cursor has moved.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[flanker] run failed to start: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** Vercel Cron issues GET. */
export const GET = handle;

/** POST is here for manual triggering with curl during a demo. */
export const POST = handle;

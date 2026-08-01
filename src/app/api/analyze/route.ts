import { NextResponse } from "next/server";
import { SupabaseFlankerRepo } from "@/lib/storage/repo";
import { GeminiTriageEngine } from "@/lib/llm/gemini";
import { fetchLatestRelease } from "@/lib/sources/itunes";
import { deriveHnQuery, fetchReaction } from "@/lib/sources/hn";
import { budgetState, rateLimit } from "@/lib/pipeline/budget";
import { pacificDayStart } from "@/lib/pipeline/budget";
import type { ViewerContext } from "@/lib/llm/prompt";
import type { HnReaction } from "@/lib/sources/hn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * On-demand analysis for one app.
 *
 * This is what makes a 10,000-app catalog affordable. Pre-generating every app
 * would cost ten days of free-tier quota and most of it would never be read;
 * generating on first view costs one call per app anyone actually opens, and
 * the result is cached by (app, version) forever after — the same UNIQUE
 * constraint that gives the cron its idempotency doubles as the cache key.
 */
function clientKey(request: Request): string {
  // Vercel sets x-forwarded-for; the first entry is the real client.
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  let body: { trackId?: number; viewer?: ViewerContext | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const trackId = Number(body.trackId);
  if (!Number.isSafeInteger(trackId) || trackId <= 0) {
    return NextResponse.json({ error: "trackId must be a positive integer" }, { status: 400 });
  }

  const limited = rateLimit(clientKey(request));
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Analysis is rate limited per visitor." },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
    );
  }

  try {
    const repo = new SupabaseFlankerRepo();

    const catalogApp = await repo.getCatalogApp(trackId);
    if (!catalogApp) {
      return NextResponse.json({ error: "app not in catalog" }, { status: 404 });
    }

    // An app becomes "tracked" the moment someone looks at it. That's what
    // promotes it from the browsable catalog into the monitored set.
    let tracked = await repo.findTrackedByItunesId(trackId);
    if (!tracked) {
      tracked = await repo.createTrackedApp({
        itunesTrackId: trackId,
        name: catalogApp.name,
        // Derived from the store title rather than left null. Disabling HN for
        // every searched app meant community reaction never ran outside the
        // original seeded set — the section said "no discussion found" whether
        // or not any existed. deriveHnQuery returns null for names too generic
        // to search, so noise is still avoided where it matters.
        hnQuery: deriveHnQuery(catalogApp.name),
      });
    }

    const release = await fetchLatestRelease(trackId);

    // Cache hit: this exact version has already been analysed.
    const existing = await repo.findEvent(tracked.id, release.version.trim());
    if (existing) {
      return NextResponse.json({ status: "cached", event: existing });
    }

    // Cache miss — check the budget before spending a call.
    const usedToday = await repo.countEventsSince(pacificDayStart().toISOString());
    const budget = budgetState(usedToday);
    if (budget.exhausted) {
      return NextResponse.json(
        {
          status: "budget-exhausted",
          message: "Live analysis paused — daily quota resets at midnight PT.",
          budget,
        },
        { status: 503 },
      );
    }

    let reaction: HnReaction | null = null;
    if (tracked.hnQuery) {
      try {
        reaction = await fetchReaction(tracked.hnQuery);
      } catch {
        reaction = null;
      }
    }

    const { output, model } = await new GeminiTriageEngine().triage({
      app: tracked,
      release,
      reaction,
      viewer: body.viewer ?? null,
    });

    const event = await repo.insertEvent({
      appId: tracked.id,
      version: release.version.trim(),
      releaseNotes: release.releaseNotes,
      releaseDate: release.releaseDate,
      hnSummary: output.hn_reaction_summary,
      hnStoryRefs: reaction?.stories ?? [],
      llmOutput: output,
      signalLevel: output.signal_level,
      model,
    });

    // Nothing is emailed any more, so the cursor can advance as soon as the
    // event is stored — there is no later step left to fail.
    await repo.advanceLastSeenVersion(tracked.id, event.version, new Date().toISOString());

    return NextResponse.json({ status: "generated", event, budget: budgetState(usedToday + 1) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[flanker] analyze failed for ${trackId}: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

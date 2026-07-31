import { NextResponse } from "next/server";
import { SupabaseFlankerRepo } from "@/lib/storage/repo";
import { GeminiTriageEngine } from "@/lib/llm/gemini";
import { fetchLatestRelease } from "@/lib/sources/itunes";
import { budgetState, pacificDayStart, rateLimit } from "@/lib/pipeline/budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A counter-PRD for one app, written from the reader's product's position.
 *
 * Deliberately not stored in Postgres. The teardown is viewer-independent, so
 * it caches once per (app, version) and is shared by everyone; a counter-PRD
 * is per reader, and persisting one row per viewer permutation would multiply
 * the events table by the number of distinct readers for something the browser
 * can cache itself. The client keys it by (app, version, viewer).
 */
function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  let body: {
    trackId?: number;
    viewer?: { itunesTrackId?: number; name?: string; genre?: string | null; developer?: string | null };
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const trackId = Number(body.trackId);
  const viewerName = body.viewer?.name?.trim();

  if (!Number.isSafeInteger(trackId) || trackId <= 0) {
    return NextResponse.json({ error: "trackId must be a positive integer" }, { status: 400 });
  }
  if (!viewerName) {
    return NextResponse.json({ error: "viewer.name is required" }, { status: 400 });
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

    const tracked = await repo.findTrackedByItunesId(trackId);
    if (!tracked) {
      return NextResponse.json(
        { error: "analyse this app first" },
        { status: 409 },
      );
    }

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

    const release = await fetchLatestRelease(trackId);

    const { output } = await new GeminiTriageEngine().triage({
      app: tracked,
      release,
      // Reaction is already summarised on the stored teardown; re-fetching it
      // here would spend two upstream calls to change nothing about the advice.
      reaction: null,
      viewer: {
        name: viewerName,
        genre: body.viewer?.genre ?? null,
        developer: body.viewer?.developer ?? null,
      },
    });

    if (!output.counter_prd) {
      return NextResponse.json(
        { error: "the model returned no counter-PRD despite a viewer context" },
        { status: 502 },
      );
    }

    return NextResponse.json({ status: "generated", counterPrd: output.counter_prd });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[flanker] counter-prd failed for ${trackId}: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

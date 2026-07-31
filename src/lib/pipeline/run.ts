import type { HnReaction } from "@/lib/sources/hn";
import type { FlankerRepo, TrackedApp } from "@/lib/storage/types";
import { detectRelease } from "@/lib/pipeline/detect";
import type { AlertSender, Clock, ReactionSource, ReleaseSource, TriageEngine } from "@/lib/pipeline/ports";
import type { ViewerContext } from "@/lib/llm/prompt";

export interface PipelineDeps {
  repo: FlankerRepo;
  releases: ReleaseSource;
  reactions: ReactionSource;
  triage: TriageEngine;
  alerts: AlertSender;
  clock?: Clock;
  /** Scheduled runs have no reader, so they produce teardowns. */
  viewer?: ViewerContext | null;
}

export type PipelineStatus =
  | "processed" // new release, alert sent, cursor advanced
  | "already-processed" // event existed and was complete; cursor reconciled
  | "unchanged" // no new version
  | "skipped" // upstream gave us nothing usable
  | "failed";

export interface PipelineResult {
  app: string;
  status: PipelineStatus;
  version?: string;
  detail?: string;
}

/**
 * Runs the full pipeline for one app.
 *
 * The ordering here is the idempotency contract, and it is deliberate:
 *
 *   1. detect        — cheap, avoids all downstream work when nothing changed
 *   2. reconcile     — an existing event short-circuits the expensive steps
 *   3. enrich        — HN reaction, non-fatal
 *   4. triage        — the LLM call, the expensive step
 *   5. persist       — insert the event
 *   6. alert         — send the email, stamp email_sent_at
 *   7. advance       — move the cursor, LAST
 *
 * Anything that throws before step 7 leaves `last_seen_version` where it was,
 * so the next run retries this release rather than skipping past it. That is
 * the property the whole "no silently dropped events" requirement rests on.
 */
export async function runPipelineForApp(
  app: TrackedApp,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const { repo, releases, reactions, triage, alerts, clock = () => new Date(), viewer = null } = deps;
  const now = () => clock().toISOString();

  try {
    const release = await releases.fetchLatestRelease(app.itunesTrackId);
    const detection = detectRelease(app.lastSeenVersion, release.version);

    if (!detection.shouldProcess) {
      if (detection.reason === "invalid-current-version") {
        // Upstream gave us a blank version. Don't touch anything — treating
        // this as "checked" would hide a broken feed behind a fresh timestamp.
        return { app: app.name, status: "skipped", detail: "upstream returned an empty version" };
      }
      await repo.touchLastChecked(app.id, now());
      return { app: app.name, status: "unchanged", version: release.version };
    }

    const version = release.version.trim();

    // Reconcile before spending anything. Covers two cases: a crash between
    // persist and advance, and a store rollback to a version we already
    // handled. The unique (app_id, version) constraint means this check and
    // the database agree.
    const existing = await repo.findEvent(app.id, version);
    if (existing) {
      if (!existing.emailSentAt) {
        // Event survived, alert didn't. Resend without re-running the LLM.
        await alerts.send({ app, release, event: existing });
        await repo.markEmailSent(existing.id, now());
        await repo.advanceLastSeenVersion(app.id, version, now());
        return { app: app.name, status: "processed", version, detail: "resent pending alert" };
      }
      await repo.advanceLastSeenVersion(app.id, version, now());
      return { app: app.name, status: "already-processed", version };
    }

    // Enrichment: a failure here costs us context, not the alert. A null
    // hnQuery means this brand can't be searched usefully, so we skip rather
    // than hand the model noise to summarise.
    let reaction: HnReaction | null = null;
    if (app.hnQuery) {
      try {
        reaction = await reactions.fetchReaction(app.hnQuery);
      } catch {
        reaction = null;
      }
    }

    const { output: llmOutput, model } = await triage.triage({ app, release, reaction, viewer });

    const event = await repo.insertEvent({
      appId: app.id,
      version,
      releaseNotes: release.releaseNotes,
      releaseDate: release.releaseDate,
      hnSummary: llmOutput.hn_reaction_summary,
      hnStoryRefs: reaction?.stories ?? [],
      llmOutput,
      signalLevel: llmOutput.signal_level,
      model,
    });

    await alerts.send({ app, release, event });
    await repo.markEmailSent(event.id, now());
    await repo.advanceLastSeenVersion(app.id, version, now());

    return { app: app.name, status: "processed", version };
  } catch (error) {
    // Swallowed on purpose: one app's failure is reported, not propagated, so
    // the rest of the run continues. The cursor is untouched, so the next run
    // picks this release up again.
    return {
      app: app.name,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runPipeline(deps: PipelineDeps): Promise<PipelineResult[]> {
  const apps = await deps.repo.listTrackedApps({ enabledOnly: true });

  // Sequential rather than parallel: the iTunes API is rate limited to roughly
  // 20 requests/minute and the Gemini free tier to single-digit RPM, and a
  // four-app run has no need to race.
  const results: PipelineResult[] = [];
  for (const app of apps) {
    results.push(await runPipelineForApp(app, deps));
  }
  return results;
}

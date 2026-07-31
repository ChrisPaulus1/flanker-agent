import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { EventCard } from "@/components/event-card";
import { DetectedRelease } from "@/components/detected-release";
import { AnalyzeButton } from "@/components/analyze-button";
import { SearchBox } from "@/components/search-box";
import { SiteShell } from "@/components/site-shell";
import { Card } from "@/components/ui/card";
import { SupabaseFlankerRepo } from "@/lib/storage/repo";
import { formatVersion, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { buildHistory, newestUnanalyzed } from "@/lib/pipeline/history";
import type { CatalogApp, FlankerEventWithApp, ObservedRelease } from "@/lib/storage/types";

export const dynamic = "force-dynamic";

function parseTrackId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({
  params,
}: {
  params: { trackId: string };
}): Promise<Metadata> {
  const id = parseTrackId(params.trackId);
  if (!id) return { title: "Flanker" };

  try {
    const app = await new SupabaseFlankerRepo().getCatalogApp(id);
    return app
      ? { title: `${app.name} — release intelligence | Flanker` }
      : { title: "Flanker" };
  } catch {
    return { title: "Flanker" };
  }
}

function StatTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent: "indigo" | "tangerine" | "teal";
}) {
  const dot = { indigo: "bg-indigo", tangerine: "bg-tangerine", teal: "bg-teal" }[accent];

  return (
    <Card className="panel surface-card p-4">
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-[3px]", dot)} aria-hidden />
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </div>
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

/**
 * Identity block, in place of the old "Apps tracked" panel.
 *
 * On a per-app page that panel would have read "1" forever. What a visitor
 * actually needs to know here is which app they're looking at and what its
 * current version is.
 */
function AppIdentity({ app }: { app: CatalogApp }) {
  return (
    <Card className="panel surface-card overflow-hidden p-4 sm:p-5">
      <div className="flex items-center gap-4">
        {app.iconUrl && (
          /* eslint-disable-next-line @next/next/no-img-element -- App Store
             artwork is served from arbitrary CDN hosts; next/image would need
             every one allow-listed up front. */
          <img
            src={app.iconUrl}
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 shrink-0 rounded-xl border border-border/70 bg-muted object-cover"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Now viewing
          </div>
          <h2 className="mt-1 truncate text-xl font-semibold tracking-tight">{app.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {app.version && (
              <span className="font-mono tabular-nums text-teal-ink">
                Latest v{formatVersion(app.version)}
              </span>
            )}
            {app.developer && <span className="truncate">{app.developer}</span>}
            {app.genre && <span>{app.genre}</span>}
          </div>
        </div>

        <a
          href={`https://apps.apple.com/us/app/id${app.itunesTrackId}`}
          target="_blank"
          rel="noreferrer"
          className="hidden shrink-0 text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline sm:block"
        >
          App Store
        </a>
      </div>
    </Card>
  );
}

function NoAnalysisYet({ app }: { app: CatalogApp }) {
  return (
    <Card className="panel surface-card p-8 text-center">
      <h3 className="font-semibold">No analysis for this app yet</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
        Flanker has {app.name} v{app.version ? formatVersion(app.version) : "?"} in the catalog but
        hasn&apos;t analyzed this release. Analysis runs on demand and is cached, so the first
        request takes a few seconds and every later view is instant.
      </p>

      <AnalyzeButton trackId={app.itunesTrackId} appName={app.name} />
      {app.releaseNotes && (
        <div className="mx-auto mt-5 max-w-2xl text-left">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-signal-medium">
            Latest release notes, verbatim
          </div>
          <blockquote className="whitespace-pre-wrap rounded-lg border-l-2 border-l-teal/50 bg-muted/60 px-3.5 py-3 text-left font-mono text-[13px] leading-relaxed text-muted-foreground">
            {app.releaseNotes}
          </blockquote>
        </div>
      )}
    </Card>
  );
}

export default async function AppPage({ params }: { params: { trackId: string } }) {
  const trackId = parseTrackId(params.trackId);
  if (!trackId) notFound();

  let app: CatalogApp | null = null;
  let events: FlankerEventWithApp[] = [];
  let releases: ObservedRelease[] = [];
  let error: string | null = null;

  try {
    const repo = new SupabaseFlankerRepo();
    app = await repo.getCatalogApp(trackId);

    if (app) {
      const tracked = await repo.findTrackedByItunesId(trackId);
      [releases, events] = await Promise.all([
        repo.listReleases(trackId, 25),
        tracked ? repo.listEventsForApp(tracked.id, 50) : Promise.resolve([]),
      ]);
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  if (!app && !error) notFound();

  const history = buildHistory(releases, events);
  const pendingVersion = newestUnanalyzed(history);
  const highSignal = events.filter((e) => e.signalLevel === "high").length;
  const lastChecked = events[0]?.detectedAt ?? releases[0]?.firstSeenAt ?? null;

  return (
    <SiteShell>
      <div className="mx-auto mb-8 max-w-xl">
        <SearchBox />
      </div>

      {error ? (
        <Card className="panel border-destructive/40 bg-destructive/5 p-6">
          <h2 className="font-semibold text-destructive">Could not load this app</h2>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </Card>
      ) : (
        app && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              <StatTile
                label="Releases detected"
                value={String(history.length)}
                accent="indigo"
              />
              <StatTile
                label="High signal"
                value={String(highSignal)}
                hint={history.length > 1 ? `of ${history.length} releases` : undefined}
                accent="tangerine"
              />
              <StatTile
                label="Last checked"
                value={lastChecked ? relativeTime(lastChecked) : "never"}
                accent="teal"
              />
            </div>

            <div className="mt-3 sm:mt-4">
              <AppIdentity app={app} />
            </div>

            <div className="mt-8 space-y-3">
              {history.length === 0 ? (
                <NoAnalysisYet app={app} />
              ) : (
                history.map((entry) =>
                  entry.kind === "analyzed" ? (
                    <EventCard key={entry.event.id} event={entry.event} />
                  ) : (
                    <DetectedRelease
                      key={`detected-${entry.version}`}
                      trackId={app!.itunesTrackId}
                      appName={app!.name}
                      version={entry.version}
                      releaseDate={entry.releaseDate}
                      releaseNotes={entry.releaseNotes}
                      /* Only the newest gap analyses itself. Backfilling every
                         gap on a page view would spend the daily budget on
                         history nobody asked to read. */
                      autoRun={entry.version === pendingVersion}
                    />
                  ),
                )
              )}
            </div>
          </>
        )
      )}
    </SiteShell>
  );
}

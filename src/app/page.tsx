import { Activity, Radio } from "lucide-react";
import { EventCard } from "@/components/event-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SupabaseFlankerRepo } from "@/lib/storage/repo";
import { relativeTime } from "@/lib/format";
import type { FlankerEventWithApp, TrackedApp } from "@/lib/storage/types";

// The dashboard reads Supabase directly from the server. No API route and no
// client-side key: the service role credential never leaves the server.
export const dynamic = "force-dynamic";

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="surface-card p-4 shadow-[0_1px_2px_hsl(var(--grad-violet)/0.05),0_6px_20px_-14px_hsl(var(--grad-violet)/0.25)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="surface-card flex flex-col items-center gap-3 p-12 text-center">
      <Radio className="h-7 w-7 text-signal-medium" aria-hidden />
      <div>
        <h2 className="font-semibold">No releases detected yet</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Flanker records an event the first time it sees each tracked app, then on every version
          change after that. Run <code className="font-mono text-xs">npm run backfill</code> to
          populate history from current versions.
        </p>
      </div>
    </Card>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40 bg-destructive/5 p-6">
      <h2 className="font-semibold text-destructive">Could not load events</h2>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      <p className="mt-3 text-sm text-muted-foreground">
        Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and that supabase/schema.sql has been
        applied.
      </p>
    </Card>
  );
}

export default async function DashboardPage() {
  let events: FlankerEventWithApp[] = [];
  let apps: TrackedApp[] = [];
  let error: string | null = null;

  try {
    const repo = new SupabaseFlankerRepo();
    [events, apps] = await Promise.all([repo.listRecentEvents(100), repo.listTrackedApps()]);
  } catch (caught) {
    // A dead database should render a diagnosable page, not a stack trace.
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const highSignal = events.filter((e) => e.signalLevel === "high").length;
  const lastChecked = apps
    .map((a) => a.lastCheckedAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);

  return (
    <div className="page-wash min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/50">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Activity className="h-5 w-5 text-signal-high" aria-hidden />
            <span className="font-semibold tracking-tight">Flanker</span>
            <Badge variant="outline" className="hidden font-normal sm:inline-flex">
              Competitive intelligence
            </Badge>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="container py-8 md:py-12">
        <div className="max-w-2xl">
          <h1 className="text-gradient text-2xl font-semibold tracking-tight md:text-3xl">Release timeline</h1>
          <p className="mt-2 text-muted-foreground">
            Every App Store release detected across the tracked FinTech set, reverse-engineered into
            a strategic read and a counter-PRD. Expand any card for the full analysis.
          </p>
        </div>

        {error ? (
          <div className="mt-8">
            <ErrorState message={error} />
          </div>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <StatTile label="Apps tracked" value={String(apps.length)} />
              <StatTile label="Releases detected" value={String(events.length)} />
              <StatTile
                label="High signal"
                value={String(highSignal)}
                hint={events.length > 0 ? `of ${events.length} releases` : undefined}
              />
              <StatTile
                label="Last checked"
                value={lastChecked ? relativeTime(lastChecked) : "never"}
              />
            </div>

            <div className="mt-8 space-y-3">
              {events.length === 0 ? (
                <EmptyState />
              ) : (
                events.map((event) => <EventCard key={event.id} event={event} />)
              )}
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-border/60">
        <div className="container py-6 text-xs text-muted-foreground">
          Flanker polls the iTunes Search API and Hacker News, then uses Gemini to draft the
          analysis. Feature and strategy sections are inferred from public release notes and may be
          wrong.
        </div>
      </footer>
    </div>
  );
}

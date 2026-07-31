"use client";

import * as React from "react";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatDate, formatVersion } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A version Flanker observed but hasn't analysed.
 *
 * Rendered flatter and quieter than an analysed card on purpose: it's real
 * history — the version and the developer's own notes, verbatim — but it
 * hasn't cost a model call, and it shouldn't look like it has.
 *
 * `autoRun` marks the newest unanalysed release, which analyses itself once on
 * mount so the top of the page is always a complete card without a click.
 */
export function DetectedRelease({
  trackId,
  appName,
  version,
  releaseDate,
  releaseNotes,
  autoRun = false,
}: {
  trackId: number;
  appName: string;
  version: string;
  releaseDate: string | null;
  releaseNotes: string | null;
  autoRun?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<"idle" | "running" | "error" | "paused">("idle");
  const [message, setMessage] = React.useState<string | null>(null);
  const started = React.useRef(false);

  const run = React.useCallback(async () => {
    // Guard against StrictMode's double-mount in development, which would
    // otherwise fire two analyses and bill the budget twice.
    if (started.current) return;
    started.current = true;

    setState("running");
    setMessage(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trackId }),
      });
      const data = (await res.json()) as { message?: string; error?: string };

      if (res.ok) {
        // The analysis lives server-side now; reload so it renders as a full
        // card rather than duplicating the card markup here.
        window.location.reload();
        return;
      }
      if (res.status === 503) {
        setState("paused");
        setMessage(data.message ?? "Live analysis paused — daily quota resets at midnight PT.");
        return;
      }
      setState("error");
      setMessage(
        res.status === 429
          ? "Too many requests in a short window. Give it a minute."
          : (data.error ?? "Could not analyze this release."),
      );
      started.current = false;
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : String(error));
      started.current = false;
    }
  }, [trackId]);

  React.useEffect(() => {
    if (autoRun) void run();
  }, [autoRun, run]);

  const busy = state === "running";

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card className={cn("panel relative overflow-hidden bg-muted/20", busy && "animate-pulse")}>
        <span className="absolute inset-y-0 left-0 w-1 bg-border" aria-hidden />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4 pl-5">
          <CollapsibleTrigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="rounded-md border border-border/70 bg-secondary/60 px-1.5 py-0.5 font-mono text-xs text-secondary-foreground/80">
              v{formatVersion(version)}
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {busy ? `Analyzing ${appName}…` : "Detected, not yet analyzed"}
            </span>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {formatDate(releaseDate)}
            </span>
            <ChevronDown
              className={cn(
                "ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                open && "rotate-180",
              )}
              aria-hidden
            />
          </CollapsibleTrigger>

          {state !== "paused" && (
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer"
              onClick={() => {
                started.current = false;
                void run();
              }}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              )}
              {busy ? "Analyzing…" : state === "error" ? "Retry" : "Analyze"}
            </Button>
          )}
        </div>

        {message && (
          <p
            className={cn(
              "px-5 pb-3 text-xs",
              state === "paused" ? "text-muted-foreground" : "text-destructive",
            )}
          >
            {message}
          </p>
        )}

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="border-t px-5 pb-4 pt-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-signal-medium">
              Release notes, verbatim
            </div>
            <blockquote className="whitespace-pre-wrap rounded-lg border-l-2 border-l-teal/50 bg-muted/60 px-3.5 py-3 font-mono text-[13px] leading-relaxed text-muted-foreground">
              {releaseNotes?.trim() || "The developer published no release notes for this version."}
            </blockquote>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

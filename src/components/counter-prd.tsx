"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { counterPrdCacheKey, openProductPicker, useViewer } from "@/lib/viewer";
import type { CounterPrd } from "@/lib/llm/schema";

/**
 * The advice section of an event card.
 *
 * Deliberately never empty. An earlier version rendered a "Counter-PRD"
 * heading and then explained that there wasn't one — a section advertising an
 * empty box, and the default state for every visitor. Naming who you are is
 * now an upgrade rather than a prerequisite:
 *
 *   no product set → "What this means for competitors", a category-level read
 *                    the model can write honestly with no named reader
 *   product set    → "Counter-PRD for <product>", the specific version
 */
export function AdviceSection({
  categoryImplication,
  trackId,
  version,
  appName,
}: {
  categoryImplication: string | null;
  trackId: number;
  version: string;
  appName: string;
}) {
  const [viewer, , ready] = useViewer();
  const [generated, setGenerated] = React.useState<CounterPrd | null>(null);
  const [state, setState] = React.useState<"idle" | "running" | "error" | "paused">("idle");
  const [message, setMessage] = React.useState<string | null>(null);

  const cacheKey = viewer ? counterPrdCacheKey(trackId, version, viewer.itunesTrackId) : null;

  React.useEffect(() => {
    setGenerated(null);
    setState("idle");
    setMessage(null);
    if (!cacheKey) return;
    try {
      const raw = window.localStorage.getItem(cacheKey);
      if (raw) setGenerated(JSON.parse(raw) as CounterPrd);
    } catch {
      /* an unreadable cache entry isn't worth surfacing */
    }
  }, [cacheKey]);

  async function generate() {
    if (!viewer || !cacheKey) return;
    setState("running");
    setMessage(null);

    try {
      const res = await fetch("/api/counter-prd", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trackId, viewer }),
      });
      const data = (await res.json()) as {
        counterPrd?: CounterPrd;
        message?: string;
        error?: string;
      };

      if (res.ok && data.counterPrd) {
        setGenerated(data.counterPrd);
        setState("idle");
        try {
          window.localStorage.setItem(cacheKey, JSON.stringify(data.counterPrd));
        } catch {
          /* a full localStorage shouldn't lose what's already on screen */
        }
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
          : (data.error ?? "Could not generate a counter-PRD."),
      );
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  /*
    Only a counter-PRD generated for the *current* reader is shown.

    Stored ones are deliberately ignored. Rows written before the teardown
    split carry a counter_prd addressed to an unnamed "our app", and nothing
    records which reader any stored PRD was written for — rendering one under
    a heading naming the current viewer would attribute advice to a product it
    was never about.
  */
  const prd = generated;
  const heading = prd && viewer ? `Counter-PRD for ${viewer.name}` : "What this means for competitors";

  return (
    <div className="rounded-xl border border-border/70 bg-gradient-to-br from-indigo/[0.07] via-teal/[0.05] to-tangerine/[0.07] p-4">
      <h4 className="mb-3 text-sm font-semibold tracking-tight">{heading}</h4>

      {prd ? (
        <dl className="space-y-3">
          {[
            ["Problem statement", prd.problem_statement],
            ["Why now", prd.why_now],
            ["Proposed response", prd.proposed_feature],
            ["Success metric", prd.success_metric],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 text-[15px] leading-relaxed text-foreground/90">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <>
          <p className="text-[15px] leading-relaxed text-foreground/90">
            {categoryImplication ??
              `What ${appName} shipped here doesn't move the bar for anyone else in its category.`}
          </p>

          {/* The offer, not the limitation — and the control is right here
              rather than a pointer to the header. */}
          {ready && state !== "paused" && state !== "error" && (
            <Button
              size="sm"
              variant={viewer ? "default" : "outline"}
              className="mt-4 cursor-pointer"
              onClick={() => (viewer ? void generate() : openProductPicker())}
              disabled={state === "running"}
            >
              {state === "running" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Writing counter-PRD…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  {viewer ? `Write a counter-PRD for ${viewer.name}` : "Get a counter-PRD for your product"}
                </>
              )}
            </Button>
          )}

          {(state === "paused" || state === "error") && (
            <div className="mt-4 text-sm">
              <p className={state === "paused" ? "text-muted-foreground" : "text-destructive"}>
                {message}
              </p>
              {state === "error" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 cursor-pointer"
                  onClick={() => void generate()}
                >
                  Try again
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

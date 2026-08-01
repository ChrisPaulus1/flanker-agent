"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { counterPrdCacheKey, openProductPicker, useViewer } from "@/lib/viewer";
import { shortAppName } from "@/lib/format";
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

  /*
    You can't write a competitive response to your own release.

    Handled here rather than in the prompt because it needs no model call at
    all: comparing an app to itself has one correct answer and it's the same
    every time. Left to the model it came back classified "unrelated", which
    rendered the nonsense "X isn't a competitor to X".
  */
  const isSelf = viewer?.itunesTrackId === trackId;

  const cacheKey =
    viewer && !isSelf ? counterPrdCacheKey(trackId, version, viewer.itunesTrackId) : null;

  React.useEffect(() => {
    setGenerated(null);
    setState("idle");
    setMessage(null);
    if (!cacheKey) return;
    try {
      const raw = window.localStorage.getItem(cacheKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as CounterPrd;
      // Belt and braces alongside the versioned key: an entry written before
      // `relationship` existed can't be rendered correctly, so regenerate
      // rather than show it under a heading that may be wrong.
      if (!parsed?.relationship) {
        window.localStorage.removeItem(cacheKey);
        return;
      }
      setGenerated(parsed);
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

  /*
    "Counter" presupposes a competitive threat, and most pairings across a
    general App Store catalogue have none — a banking app has no competitive
    response to a dating app's ranking tab. When the model classifies the two
    as unrelated, the section says what it actually is: a transferable pattern,
    not a threat to answer.
  */
  const unrelated = prd?.relationship === "unrelated";
  const heading = isSelf
    ? "This is your own release"
    : !prd || !viewer
      ? "What this means for competitors"
      : unrelated
        ? `What ${shortAppName(viewer.name)} could borrow`
        : `Counter-PRD for ${shortAppName(viewer.name)}`;

  return (
    <div className="rounded-xl border border-border/70 bg-gradient-to-br from-indigo/[0.07] via-teal/[0.05] to-tangerine/[0.07] p-4">
      <h4 className="mb-3 text-sm font-semibold tracking-tight">{heading}</h4>

      {isSelf ? (
        <p className="text-[15px] leading-relaxed text-foreground/90">
          You&apos;ve set {shortAppName(appName)} as your own product, so there&apos;s no competitor to respond
          to here — this is your release. Pick a different app to see how it reads against
          yours, or switch your product to compare from another position.
        </p>
      ) : prd ? (
        <>
          {/*
            One statement, not three. The heading already frames this as
            borrowing and the classification is the only fact worth adding;
            spelling out "adapts the mechanic rather than matching the feature"
            said the same thing a third time, with a long App Store name in it
            twice.
          */}
          {unrelated && viewer && (
            <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
              {shortAppName(appName)} isn&apos;t a competitor to {shortAppName(viewer.name)}.
            </p>
          )}
          <dl className="space-y-3">
          {[
            ["Problem statement", prd.problem_statement],
            ["Why now", prd.why_now],
            [unrelated ? "Pattern to borrow" : "Proposed response", prd.proposed_feature],
            ["Success metric", prd.success_metric],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 text-[15px] leading-relaxed text-foreground/90">{value}</dd>
            </div>
          ))}
          </dl>
        </>
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
              /* Button is whitespace-nowrap by default, which sent a long store
                 title off the right edge on mobile. Wrapping with auto height
                 keeps the label inside the card at any name length. */
              className="mt-4 h-auto max-w-full cursor-pointer whitespace-normal py-2 text-left"
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
                  {viewer
                    ? `Write a counter-PRD for ${shortAppName(viewer.name)}`
                    : "Get a counter-PRD for your product"}
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

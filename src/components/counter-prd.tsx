"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { counterPrdCacheKey, useViewer } from "@/lib/viewer";
import type { CounterPrd } from "@/lib/llm/schema";

/**
 * The counter-PRD block inside an event card.
 *
 * Three states, and the empty one is the point: with no reader identified
 * there is nobody to write advice for, so the section explains what's missing
 * rather than inventing a company to address.
 */
export function CounterPrdSection({
  stored,
  trackId,
  version,
  appName,
}: {
  /** Written at analysis time — only present if a viewer was set then. */
  stored: CounterPrd | null;
  trackId: number;
  version: string;
  appName: string;
}) {
  const [viewer, , ready] = useViewer();
  const [generated, setGenerated] = React.useState<CounterPrd | null>(null);
  const [state, setState] = React.useState<"idle" | "running" | "error" | "paused">("idle");
  const [message, setMessage] = React.useState<string | null>(null);

  const cacheKey = viewer ? counterPrdCacheKey(trackId, version, viewer.itunesTrackId) : null;

  // Re-read the cache whenever the reader changes product.
  React.useEffect(() => {
    setGenerated(null);
    setState("idle");
    setMessage(null);
    if (!cacheKey) return;
    try {
      const raw = window.localStorage.getItem(cacheKey);
      if (raw) setGenerated(JSON.parse(raw) as CounterPrd);
    } catch {
      /* unreadable cache entry is not worth surfacing */
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
        status?: string;
        message?: string;
        error?: string;
      };

      if (res.ok && data.counterPrd) {
        setGenerated(data.counterPrd);
        setState("idle");
        try {
          window.localStorage.setItem(cacheKey, JSON.stringify(data.counterPrd));
        } catch {
          /* quota-full localStorage shouldn't lose the result on screen */
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

  const prd = generated ?? stored;

  if (prd) {
    return (
      <dl className="space-y-3">
        {viewer && (
          <p className="text-xs text-muted-foreground">
            Written for <span className="font-medium text-foreground">{viewer.name}</span>
          </p>
        )}
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
    );
  }

  if (!ready) return <div className="h-5" aria-hidden />;

  if (!viewer) {
    return (
      <p className="text-[15px] leading-relaxed text-muted-foreground">
        This is a neutral teardown — nobody has said who&apos;s reading, so there&apos;s no one to
        write advice for. Use <span className="font-medium text-foreground">Set your product</span>{" "}
        above and this becomes a counter-PRD written from your product&apos;s position.
      </p>
    );
  }

  if (state === "paused" || state === "error") {
    return (
      <div className="text-sm">
        <p className={state === "paused" ? "text-muted-foreground" : "text-destructive"}>{message}</p>
        {state === "error" && (
          <Button variant="outline" size="sm" className="mt-3 cursor-pointer" onClick={() => void generate()}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="text-[15px] leading-relaxed text-muted-foreground">
        Draft a response to {appName}&apos;s release from{" "}
        <span className="font-medium text-foreground">{viewer.name}</span>&apos;s position.
      </p>
      <Button
        size="sm"
        className="mt-3 cursor-pointer"
        onClick={() => void generate()}
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
            Write counter-PRD for {viewer.name}
          </>
        )}
      </Button>
    </div>
  );
}

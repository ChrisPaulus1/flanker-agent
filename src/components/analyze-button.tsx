"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Triggers on-demand analysis for an app that has none yet.
 *
 * The first request costs one LLM call and a few seconds; every later view of
 * the same version is served from cache. Failure states are shown inline
 * rather than thrown, because "the daily free-tier quota is spent" is an
 * ordinary thing to say, not an error page.
 */
export function AnalyzeButton({ trackId, appName }: { trackId: number; appName: string }) {
  const router = useRouter();
  const [state, setState] = React.useState<"idle" | "running" | "error" | "paused">("idle");
  const [message, setMessage] = React.useState<string | null>(null);

  async function run() {
    setState("running");
    setMessage(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trackId }),
      });
      const data = (await res.json()) as {
        status?: string;
        message?: string;
        error?: string;
      };

      if (res.ok) {
        // The page is a server component, so re-render it from the server to
        // pick up the row that was just written.
        router.refresh();
        return;
      }

      if (res.status === 503 && data.status === "budget-exhausted") {
        setState("paused");
        setMessage(data.message ?? "Live analysis paused — daily quota resets at midnight PT.");
        return;
      }

      setState("error");
      setMessage(
        res.status === 429
          ? "Too many requests in a short window. Give it a minute and try again."
          : (data.error ?? "Analysis failed."),
      );
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  if (state === "paused" || state === "error") {
    return (
      <div className="mt-5 text-sm">
        <p className={state === "paused" ? "text-muted-foreground" : "text-destructive"}>
          {message}
        </p>
        {state === "error" && (
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void run()}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  return (
    <Button
      className="mt-5 cursor-pointer"
      onClick={() => void run()}
      disabled={state === "running"}
    >
      {state === "running" ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Analyzing {appName}…
        </>
      ) : (
        <>
          <Sparkles className="h-4 w-4" aria-hidden />
          Analyze latest release
        </>
      )}
    </Button>
  );
}

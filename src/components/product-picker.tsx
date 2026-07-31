"use client";

import * as React from "react";
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useViewer, type ViewerProduct } from "@/lib/viewer";
import type { Suggestion } from "@/lib/catalog/search";

/**
 * Lets a visitor say which product is theirs, from the same catalog they
 * search.
 *
 * This is what turns a teardown into a counter-PRD. Without it every analysis
 * has to stay in the third person, because advice addressed to an unnamed "we"
 * is advice to a company that doesn't exist.
 */
export function ProductPicker() {
  const [viewer, setViewer, ready] = useViewer();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Suggestion[]>([]);
  const [loading, setLoading] = React.useState(false);

  const panelRef = React.useRef<HTMLDivElement>(null);
  const latest = React.useRef("");

  React.useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    latest.current = trimmed;

    if (!trimmed) {
      setResults([]);
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as { results?: Suggestion[] };
        if (latest.current !== trimmed) return;
        setResults((data.results ?? []).slice(0, 6));
      } catch {
        /* aborted or offline */
      } finally {
        if (latest.current === trimmed) setLoading(false);
      }
    }, 160);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  React.useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function choose(s: Suggestion) {
    const product: ViewerProduct = {
      itunesTrackId: s.itunesTrackId,
      name: s.name,
      developer: s.developer,
      genre: s.genre,
      iconUrl: s.iconUrl,
    };
    setViewer(product);
    setOpen(false);
    setQuery("");
  }

  // Render nothing until localStorage has been read, or the button flashes
  // "Set your product" for someone who already set one.
  if (!ready) return <div className="h-8 w-32" aria-hidden />;

  return (
    <div ref={panelRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        className="cursor-pointer gap-2"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {viewer ? (
          <>
            {viewer.iconUrl && (
              /* eslint-disable-next-line @next/next/no-img-element -- App Store
                 artwork on arbitrary CDN hosts. */
              <img src={viewer.iconUrl} alt="" width={16} height={16} className="h-4 w-4 rounded-[4px]" />
            )}
            <span className="max-w-[9rem] truncate">{viewer.name}</span>
          </>
        ) : (
          <span>Set your product</span>
        )}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </Button>

      {open && (
        <div className="panel absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border bg-card p-3 shadow-lg">
          <p className="mb-2.5 text-xs leading-relaxed text-muted-foreground">
            Pick the app you work on. Every analysis then includes a counter-PRD written from its
            position instead of a neutral teardown.
          </p>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your app…"
              aria-label="Search for your product"
              className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
            )}
          </div>

          {results.length > 0 && (
            <ul className="mt-2 max-h-64 overflow-y-auto">
              {results.map((s) => {
                const isCurrent = viewer?.itunesTrackId === s.itunesTrackId;
                return (
                  <li key={s.itunesTrackId}>
                    <button
                      type="button"
                      onClick={() => choose(s)}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/60"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- remote artwork */}
                      <img
                        src={s.iconUrl ?? ""}
                        alt=""
                        width={28}
                        height={28}
                        className="h-7 w-7 shrink-0 rounded-[7px] border border-border/70 bg-muted object-cover"
                        loading="lazy"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{s.name}</span>
                        {s.developer && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {s.developer}
                          </span>
                        )}
                      </span>
                      {isCurrent && <Check className="h-4 w-4 shrink-0 text-teal-ink" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {viewer && (
            <button
              type="button"
              onClick={() => {
                setViewer(null);
                setOpen(false);
              }}
              className="mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border/70 px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <X className="h-3 w-3" aria-hidden />
              Clear — go back to neutral teardowns
            </button>
          )}
        </div>
      )}
    </div>
  );
}

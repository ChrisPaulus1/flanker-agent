"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Suggestion } from "@/lib/catalog/search";

/**
 * Catalog search with type-ahead.
 *
 * Deliberately capped at three suggestions: the point is to offer a decision,
 * not a directory. Requests are debounced and every in-flight response is
 * checked against the current query before rendering — without that, typing
 * "sna" then "snap" can land the slower "sna" response last and overwrite the
 * newer results.
 */
export function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Suggestion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(-1);

  const boxRef = React.useRef<HTMLDivElement>(null);
  const latestQuery = React.useRef("");

  React.useEffect(() => {
    const trimmed = query.trim();
    latestQuery.current = trimmed;

    if (trimmed.length === 0) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    const controller = new AbortController();

    // 140ms is short enough to feel immediate and long enough that a fast
    // typist doesn't fire a request per character.
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?mode=suggest&q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        const data = (await res.json()) as { results?: Suggestion[] };

        // Drop a response the user has already typed past.
        if (latestQuery.current !== trimmed) return;

        setResults(data.results ?? []);
        setOpen(true);
        setActive(-1);
      } catch {
        // Aborted or offline — leave the previous suggestions rather than
        // flashing an empty dropdown.
      } finally {
        if (latestQuery.current === trimmed) setLoading(false);
      }
    }, 140);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Close on outside click.
  React.useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function go(app: Suggestion) {
    setOpen(false);
    router.push(`/app/${app.itunesTrackId}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || results.length === 0) {
      if (event.key === "Enter" && results.length > 0) go(results[0]);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      // Enter with nothing highlighted takes the best match, which is what
      // pressing enter in a search box is expected to do.
      go(results[active >= 0 ? active : 0]);
    }
  }

  return (
    <div ref={boxRef} className="relative w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (results.length > 0) go(results[active >= 0 ? active : 0]);
        }}
        role="search"
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="text"
            value={query}
            autoFocus={autoFocus}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Search any App Store app…"
            aria-label="Search apps"
            role="combobox"
            aria-expanded={open}
            aria-controls="search-suggestions"
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `suggestion-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className={cn(
              "panel surface-card h-14 w-full rounded-full border bg-card pl-11 pr-11 text-[15px]",
              "placeholder:text-muted-foreground focus-visible:outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "transition-shadow",
            )}
          />
          {loading && (
            <Loader2
              className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
              aria-hidden
            />
          )}
        </div>
      </form>

      {open && results.length > 0 && (
        <ul
          id="search-suggestions"
          role="listbox"
          aria-label="App suggestions"
          className="panel absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border bg-card py-1.5 shadow-lg"
        >
          {results.map((app, i) => (
            <li key={app.itunesTrackId} id={`suggestion-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(app)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left transition-colors",
                  i === active ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- remote
                    App Store artwork on arbitrary CDN hosts; next/image would
                    need every host allow-listed up front. */}
                <img
                  src={app.iconUrl ?? ""}
                  alt=""
                  width={36}
                  height={36}
                  className="h-9 w-9 shrink-0 rounded-[9px] border border-border/70 bg-muted object-cover"
                  loading="lazy"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{app.name}</span>
                  {app.developer && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {app.developer}
                    </span>
                  )}
                </span>
                {app.version && (
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    v{app.version.replace(/^v/i, "")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && !loading && query.trim().length > 0 && results.length === 0 && (
        <div className="panel absolute z-20 mt-2 w-full rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          No apps match “{query.trim()}”.
        </div>
      )}
    </div>
  );
}

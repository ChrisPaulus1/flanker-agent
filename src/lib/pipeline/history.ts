import type { FlankerEventWithApp, ObservedRelease } from "@/lib/storage/types";

/**
 * One row of an app's release history.
 *
 * Every version Flanker has observed appears, whether or not it has been
 * analysed. That's the point of splitting detection from analysis: the
 * timeline is as long as what the sweep has seen, and analysis fills in
 * on demand rather than gating what's visible.
 */
export type HistoryEntry =
  | { kind: "analyzed"; version: string; releaseDate: string | null; event: FlankerEventWithApp }
  | { kind: "detected"; version: string; releaseDate: string | null; releaseNotes: string | null };

/** Versions differ in case and padding across sources; compare normalised. */
function key(version: string): string {
  return version.trim().toLowerCase();
}

function time(value: string | null): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Merge observed releases with the analyses that exist for them.
 *
 * An analysis always wins over the bare observation of the same version — it
 * carries the same release notes plus everything the model added. Versions
 * that were analysed but never observed by a sweep still appear, which matters
 * for apps analysed before they entered the watch set: their first event would
 * otherwise vanish from their own history.
 */
export function buildHistory(
  releases: ObservedRelease[],
  events: FlankerEventWithApp[],
): HistoryEntry[] {
  const analysed = new Map(events.map((e) => [key(e.version), e]));
  const entries: HistoryEntry[] = [];
  const seen = new Set<string>();

  for (const release of releases) {
    const k = key(release.version);
    if (seen.has(k)) continue;
    seen.add(k);

    const event = analysed.get(k);
    entries.push(
      event
        ? { kind: "analyzed", version: event.version, releaseDate: release.releaseDate, event }
        : {
            kind: "detected",
            version: release.version,
            releaseDate: release.releaseDate,
            releaseNotes: release.releaseNotes,
          },
    );
  }

  // Analysed versions the sweep never recorded — anything analysed before the
  // app joined the watch set.
  for (const event of events) {
    const k = key(event.version);
    if (seen.has(k)) continue;
    seen.add(k);
    entries.push({
      kind: "analyzed",
      version: event.version,
      releaseDate: event.releaseDate,
      event,
    });
  }

  // Newest first. Release date is the honest ordering; detection order is only
  // a tiebreak, because the sweep sees a backlog of versions all at once.
  return entries.sort((a, b) => {
    const byDate = time(b.releaseDate) - time(a.releaseDate);
    if (byDate !== 0) return byDate;
    if (a.kind === "analyzed" && b.kind === "analyzed") {
      return time(b.event.detectedAt) - time(a.event.detectedAt);
    }
    return a.kind === "analyzed" ? -1 : b.kind === "analyzed" ? 1 : 0;
  });
}

/** The newest version with no analysis yet, if any — what to auto-analyse. */
export function newestUnanalyzed(entries: HistoryEntry[]): string | null {
  const first = entries.find((e) => e.kind === "detected");
  return first ? first.version : null;
}

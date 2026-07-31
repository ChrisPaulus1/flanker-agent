/**
 * Change detection for a tracked app.
 *
 * Equality-based on purpose. The tracked set ships versions like `5.337.0`,
 * `10.141` and `2026.30.1` — semver, two-segment and calendar schemes side by
 * side — so there is no ordering comparison that is correct across them. Any
 * difference from the stored cursor is a release worth processing.
 *
 * This function has no memory beyond `lastSeenVersion`, so it cannot recognise
 * a rollback to a version processed some time ago. Suppressing that duplicate
 * is the event store's job (see pipeline/run.ts), which is the right place for
 * it: the unique (app_id, version) constraint makes it a guarantee rather than
 * a heuristic.
 */

export type DetectionReason =
  | "first-sighting"
  | "version-changed"
  | "unchanged"
  | "invalid-current-version";

export interface Detection {
  shouldProcess: boolean;
  reason: DetectionReason;
}

function normalise(version: string | null): string {
  return (version ?? "").trim().toLowerCase();
}

export function detectRelease(lastSeenVersion: string | null, currentVersion: string): Detection {
  const current = normalise(currentVersion);

  // Never advance the cursor to nothing. An upstream hiccup that yields an
  // empty version must not be mistaken for a release.
  if (current.length === 0) {
    return { shouldProcess: false, reason: "invalid-current-version" };
  }

  const lastSeen = normalise(lastSeenVersion);

  // Both NULL and "" mean we have never recorded a version for this app.
  if (lastSeen.length === 0) {
    return { shouldProcess: true, reason: "first-sighting" };
  }

  return lastSeen === current
    ? { shouldProcess: false, reason: "unchanged" }
    : { shouldProcess: true, reason: "version-changed" };
}

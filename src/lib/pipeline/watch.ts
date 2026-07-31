import { chunkTrackIds, fetchReleasesForBatch, type AppRelease } from "@/lib/sources/itunes";
import type { FlankerRepo } from "@/lib/storage/types";

/**
 * The watch sweep: observe what shipped, analyse nothing.
 *
 * This is the half of the agent that can afford to run across the whole
 * catalogue. A batched lookup carries 200 track IDs per request, so watching
 * 2,000 apps costs ten keyless HTTP calls and zero model calls. Analysis stays
 * on demand, which is what keeps a background job from consuming the daily LLM
 * budget that interactive visitors need.
 *
 * It cannot recover history. Apple exposes only an app's current version, so a
 * release that ships and is superseded between two sweeps is lost permanently.
 * Sweeping more often narrows that window; nothing closes it.
 */

export interface WatchDeps {
  repo: FlankerRepo;
  fetchBatch?: (trackIds: number[]) => Promise<Map<number, AppRelease>>;
  /** Pause between batches, to stay well under iTunes' ~20 req/min. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface WatchResult {
  appsChecked: number;
  batches: number;
  /** Versions not previously in the releases table. */
  newReleases: number;
  failedBatches: number;
  durationMs: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runWatchSweep(
  trackIds: number[],
  {
    repo,
    fetchBatch = (ids) => fetchReleasesForBatch(ids),
    delayMs = 1_500,
    sleep = defaultSleep,
  }: WatchDeps,
): Promise<WatchResult> {
  const startedAt = Date.now();
  const batches = chunkTrackIds(trackIds);

  let newReleases = 0;
  let failedBatches = 0;
  let appsChecked = 0;

  for (const [index, batch] of batches.entries()) {
    try {
      const found = await fetchBatch(batch);
      appsChecked += found.size;

      // One write per batch rather than per app: 200 rows in a single upsert,
      // where all but the changed ones are discarded by the unique constraint.
      newReleases += await repo.recordReleases(
        [...found.values()].map((release) => ({
          itunesTrackId: release.trackId,
          version: release.version,
          releaseNotes: release.releaseNotes,
          releaseDate: release.releaseDate,
        })),
      );
    } catch {
      // A failed batch costs visibility into 200 apps for one sweep, not the
      // other 1,800. The next sweep re-reads the same current versions, so
      // nothing is lost unless a version ships and is superseded in between.
      failedBatches++;
    }

    if (index < batches.length - 1 && delayMs > 0) await sleep(delayMs);
  }

  return {
    appsChecked,
    batches: batches.length,
    newReleases,
    failedBatches,
    durationMs: Date.now() - startedAt,
  };
}

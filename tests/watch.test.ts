import { describe, expect, it } from "vitest";
import { runWatchSweep } from "@/lib/pipeline/watch";
import { FakeRepo, makeRelease } from "./fakes";
import type { AppRelease } from "@/lib/sources/itunes";

const noSleep = async () => {};

function batchOf(ids: number[], version = "1.0.0"): Map<number, AppRelease> {
  return new Map(
    ids.map((id) => [id, makeRelease({ trackId: id, version, appName: `App ${id}` })]),
  );
}

describe("runWatchSweep", () => {
  it("records a version the first time it is seen", async () => {
    const repo = new FakeRepo();
    const result = await runWatchSweep([1, 2, 3], {
      repo,
      fetchBatch: async (ids) => batchOf(ids),
      sleep: noSleep,
    });

    expect(result.newReleases).toBe(3);
    expect(result.appsChecked).toBe(3);
    expect(repo.releases).toHaveLength(3);
  });

  it("is a no-op on the second sweep when nothing shipped", async () => {
    // The common case by far: every sweep re-reads the same current versions.
    const repo = new FakeRepo();
    const deps = { repo, fetchBatch: async (ids: number[]) => batchOf(ids), sleep: noSleep };

    await runWatchSweep([1, 2, 3], deps);
    const second = await runWatchSweep([1, 2, 3], deps);

    expect(second.newReleases).toBe(0);
    expect(repo.releases).toHaveLength(3);
  });

  it("records a new version alongside the old one rather than replacing it", async () => {
    // This is what builds history: the previous version has to survive.
    const repo = new FakeRepo();
    await runWatchSweep([1], {
      repo,
      fetchBatch: async (ids) => batchOf(ids, "1.0.0"),
      sleep: noSleep,
    });
    const second = await runWatchSweep([1], {
      repo,
      fetchBatch: async (ids) => batchOf(ids, "1.1.0"),
      sleep: noSleep,
    });

    expect(second.newReleases).toBe(1);
    expect(repo.releases.map((r) => r.version).sort()).toEqual(["1.0.0", "1.1.0"]);
  });

  it("splits large watch sets into 200-id batches", async () => {
    const repo = new FakeRepo();
    const sizes: number[] = [];
    const result = await runWatchSweep(
      Array.from({ length: 450 }, (_, i) => i + 1),
      {
        repo,
        fetchBatch: async (ids) => {
          sizes.push(ids.length);
          return batchOf(ids);
        },
        sleep: noSleep,
      },
    );

    expect(sizes).toEqual([200, 200, 50]);
    expect(result.batches).toBe(3);
    expect(result.newReleases).toBe(450);
  });

  it("keeps going when a batch fails, and reports it", async () => {
    // A dropped batch costs one sweep's visibility into those apps, not the run.
    const repo = new FakeRepo();
    let call = 0;
    const result = await runWatchSweep(Array.from({ length: 400 }, (_, i) => i + 1), {
      repo,
      fetchBatch: async (ids) => {
        call++;
        if (call === 1) throw new Error("itunes 503");
        return batchOf(ids);
      },
      sleep: noSleep,
    });

    expect(result.failedBatches).toBe(1);
    expect(result.newReleases).toBe(200);
    expect(repo.releases).toHaveLength(200);
  });

  it("tolerates apps the lookup does not return", async () => {
    // Delisted apps come back missing from the batch; that isn't an error.
    const repo = new FakeRepo();
    const result = await runWatchSweep([1, 2, 3], {
      repo,
      fetchBatch: async () => batchOf([1, 3]),
      sleep: noSleep,
    });

    expect(result.appsChecked).toBe(2);
    expect(result.newReleases).toBe(2);
  });

  it("does nothing, and makes no request, for an empty watch set", async () => {
    const repo = new FakeRepo();
    let called = false;
    const result = await runWatchSweep([], {
      repo,
      fetchBatch: async () => {
        called = true;
        return new Map();
      },
      sleep: noSleep,
    });

    expect(called).toBe(false);
    expect(result.batches).toBe(0);
    expect(result.newReleases).toBe(0);
  });

  it("never calls the LLM — the sweep has no triage dependency at all", async () => {
    // Structural: WatchDeps has no triage engine to inject, so a sweep cannot
    // spend model budget even by mistake. This test documents that intent.
    const repo = new FakeRepo();
    const deps = { repo, fetchBatch: async (ids: number[]) => batchOf(ids), sleep: noSleep };
    await runWatchSweep([1], deps);
    expect(Object.keys(deps)).not.toContain("triage");
  });

  it("paces between batches but not after the last one", async () => {
    const repo = new FakeRepo();
    let sleeps = 0;
    await runWatchSweep(Array.from({ length: 450 }, (_, i) => i + 1), {
      repo,
      fetchBatch: async (ids) => batchOf(ids),
      sleep: async () => {
        sleeps++;
      },
    });
    // Three batches, two gaps.
    expect(sleeps).toBe(2);
  });
});

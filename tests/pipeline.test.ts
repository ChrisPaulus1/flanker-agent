import { describe, expect, it } from "vitest";
import { runPipelineForApp, runPipeline } from "@/lib/pipeline/run";
import {
  FakeReleaseSource,
  FakeRepo,
  FakeTriageEngine,
  fixedClock,
  makeApp,
  makeRelease,
} from "./fakes";

const NOW = "2026-07-30T12:00:00.000Z";

function harness(options: {
  app?: ReturnType<typeof makeApp>;
  release?: ReturnType<typeof makeRelease> | Error;
  triage?: Error;
} = {}) {
  const app = options.app ?? makeApp();
  const repo = new FakeRepo([app]);
  const releases = new FakeReleaseSource(options.release ?? makeRelease());
  const triage = new FakeTriageEngine(options.triage ?? undefined);
  const deps = { repo, releases, triage, clock: fixedClock(NOW) };
  return { app, repo, releases, triage, deps };
}

describe("runPipelineForApp", () => {
  describe("the happy path", () => {
    it("stores the event, then advances the cursor", async () => {
      const h = harness();

      const result = await runPipelineForApp(h.app, h.deps);

      expect(result.status).toBe("processed");
      expect(h.repo.events).toHaveLength(1);
      expect(h.repo.apps[0].lastSeenVersion).toBe("5.337.0");
    });

    it("advances the cursor only after the event is durably stored", async () => {
      const h = harness();
      await runPipelineForApp(h.app, h.deps);

      // Ordering is the whole guarantee: advancing first would mean a crash
      // before the insert silently skips the release forever.
      expect(h.repo.calls).toEqual(["insertEvent", "advanceLastSeenVersion"]);
    });

    it("records the signal level from the LLM output on the event", async () => {
      const h = harness();
      await runPipelineForApp(h.app, h.deps);
      expect(h.repo.events[0].signalLevel).toBe("high");
    });

    it("records which model produced the output", async () => {
      // The engine falls back to a lighter model when the preferred one hits
      // its daily free quota — which happens in practice — so the event has to
      // say what actually answered.
      const h = harness();
      await runPipelineForApp(h.app, h.deps);
      expect(h.repo.events[0].model).toBe("fake-model");
    });
  });

  describe("when nothing has changed", () => {
    it("skips the LLM entirely and only touches last_checked_at", async () => {
      const h = harness({ app: makeApp({ lastSeenVersion: "5.337.0" }) });

      const result = await runPipelineForApp(h.app, h.deps);

      expect(result.status).toBe("unchanged");
      expect(h.triage.calls).toBe(0);
      expect(h.repo.calls).toEqual(["touchLastChecked"]);
      expect(h.repo.apps[0].lastCheckedAt).toBe(NOW);
    });

    it("is a no-op when run twice in a row", async () => {
      const h = harness();

      await runPipelineForApp(h.app, h.deps);
      const second = await runPipelineForApp(h.repo.apps[0], h.deps);

      expect(second.status).toBe("unchanged");
      expect(h.repo.events).toHaveLength(1);
      expect(h.triage.calls).toBe(1);
    });
  });

  describe("failure must not advance the cursor", () => {
    it("leaves the cursor untouched when the LLM fails", async () => {
      const h = harness({ triage: new Error("gemini 429") });

      const result = await runPipelineForApp(h.app, h.deps);

      expect(result.status).toBe("failed");
      expect(h.repo.apps[0].lastSeenVersion).toBeNull();
      expect(h.repo.events).toHaveLength(0);
    });

    it("leaves the cursor untouched when the release lookup fails", async () => {
      const h = harness({ release: new Error("itunes 503") });

      const result = await runPipelineForApp(h.app, h.deps);

      expect(result.status).toBe("failed");
      expect(h.repo.apps[0].lastSeenVersion).toBeNull();
      expect(h.repo.calls).toEqual([]);
    });

    it("leaves the cursor untouched when the event insert fails", async () => {
      const h = harness();
      h.repo.insertEvent = async () => {
        throw new Error("postgres unavailable");
      };

      const result = await runPipelineForApp(h.app, h.deps);

      expect(result.status).toBe("failed");
      expect(h.repo.events).toHaveLength(0);
      expect(h.repo.apps[0].lastSeenVersion).toBeNull();
    });

    it("retries a failed release on the next run and recovers", async () => {
      const h = harness({ triage: new Error("gemini 429") });
      await runPipelineForApp(h.app, h.deps);

      // Same app, same version, but the LLM is healthy now.
      const recovered = harness();
      recovered.repo.apps[0] = h.repo.apps[0];
      const result = await runPipelineForApp(h.repo.apps[0], recovered.deps);

      expect(result.status).toBe("processed");
      expect(recovered.repo.apps[0].lastSeenVersion).toBe("5.337.0");
    });
  });

  describe("recovering a half-finished run", () => {
    it("self-heals a cursor that never advanced, without re-running the LLM", async () => {
      // Crash between insertEvent and advanceLastSeenVersion: the event is
      // stored but the cursor never moved. Re-running must reconcile the
      // cursor and must not pay for the analysis a second time.
      const h = harness();
      await runPipelineForApp(h.app, h.deps);
      h.repo.apps[0].lastSeenVersion = null; // simulate the lost write
      h.repo.calls = [];

      const result = await runPipelineForApp(h.repo.apps[0], h.deps);

      expect(result.status).toBe("already-processed");
      expect(h.triage.calls).toBe(1); // not re-run
      expect(h.repo.events).toHaveLength(1); // no duplicate row
      expect(h.repo.apps[0].lastSeenVersion).toBe("5.337.0");
      expect(h.repo.calls).toEqual(["advanceLastSeenVersion"]);
    });

    it("does not re-analyse when the store rolls back to a version already processed", async () => {
      // Apple pulls a build and the listing reverts. detectRelease sees a
      // difference and says "process"; the event store is what stops the
      // duplicate work.
      const h = harness();
      await runPipelineForApp(h.app, h.deps); // processes 5.337.0
      h.repo.apps[0].lastSeenVersion = "5.338.0"; // we'd since seen a newer one

      const result = await runPipelineForApp(h.repo.apps[0], h.deps); // store shows 5.337.0 again

      expect(result.status).toBe("already-processed");
      expect(h.triage.calls).toBe(1);
      expect(h.repo.events).toHaveLength(1);
    });
  });


  describe("guarding against bad upstream data", () => {
    it("refuses to advance the cursor to an empty version", async () => {
      const h = harness({ release: makeRelease({ version: "   " }) });

      const result = await runPipelineForApp(h.app, h.deps);

      expect(result.status).toBe("skipped");
      expect(h.repo.apps[0].lastSeenVersion).toBeNull();
      expect(h.triage.calls).toBe(0);
    });
  });
});

describe("runPipeline", () => {
  it("keeps going when one app fails, and reports per-app outcomes", async () => {
    // A single broken competitor must not stop the others from being checked.
    const apps = [makeApp({ id: "app-1", name: "Chime" }), makeApp({ id: "app-2", name: "Revolut" })];
    const repo = new FakeRepo(apps);
    let call = 0;
    const deps = {
      repo,
      releases: {
        async fetchLatestRelease() {
          call++;
          if (call === 1) throw new Error("itunes 503");
          return makeRelease({ version: "10.141" });
        },
      },
      triage: new FakeTriageEngine(),
      clock: fixedClock(NOW),
    };

    const results = await runPipeline(deps);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("failed");
    expect(results[1].status).toBe("processed");
    expect(repo.apps[1].lastSeenVersion).toBe("10.141");
  });
});

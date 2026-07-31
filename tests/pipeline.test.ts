import { describe, expect, it } from "vitest";
import { runPipelineForApp, runPipeline } from "@/lib/pipeline/run";
import {
  FakeAlertSender,
  FakeReactionSource,
  FakeReleaseSource,
  FakeRepo,
  FakeTriageEngine,
  fixedClock,
  makeApp,
  makeRelease,
  makeReaction,
} from "./fakes";

const NOW = "2026-07-30T12:00:00.000Z";

function harness(options: {
  app?: ReturnType<typeof makeApp>;
  release?: ReturnType<typeof makeRelease> | Error;
  reaction?: ReturnType<typeof makeReaction> | Error;
  triage?: Error;
  alert?: Error;
} = {}) {
  const app = options.app ?? makeApp();
  const repo = new FakeRepo([app]);
  const releases = new FakeReleaseSource(options.release ?? makeRelease());
  const reactions = new FakeReactionSource(options.reaction ?? makeReaction());
  const triage = new FakeTriageEngine(options.triage ?? undefined);
  const alerts = new FakeAlertSender(options.alert ?? null);
  const deps = { repo, releases, reactions, triage, alerts, clock: fixedClock(NOW) };
  return { app, repo, releases, reactions, triage, alerts, deps };
}

describe("runPipelineForApp", () => {
  describe("the happy path", () => {
    it("stores the event, sends the alert, then advances the cursor", async () => {
      const h = harness();

      const result = await runPipelineForApp(h.app, h.deps);

      expect(result.status).toBe("processed");
      expect(h.repo.events).toHaveLength(1);
      expect(h.alerts.sent).toEqual(["event-1"]);
      expect(h.repo.apps[0].lastSeenVersion).toBe("5.337.0");
      expect(h.repo.events[0].emailSentAt).toBe(NOW);
    });

    it("advances the cursor only after the alert has gone out", async () => {
      const h = harness();
      await runPipelineForApp(h.app, h.deps);

      // Ordering is the whole guarantee: if advanceLastSeenVersion ran before
      // markEmailSent, a crash in between would drop the release silently.
      expect(h.repo.calls).toEqual(["insertEvent", "markEmailSent", "advanceLastSeenVersion"]);
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
      expect(h.alerts.calls).toBe(0);
      expect(h.repo.calls).toEqual(["touchLastChecked"]);
      expect(h.repo.apps[0].lastCheckedAt).toBe(NOW);
    });

    it("is a no-op when run twice in a row", async () => {
      const h = harness();

      await runPipelineForApp(h.app, h.deps);
      const second = await runPipelineForApp(h.repo.apps[0], h.deps);

      expect(second.status).toBe("unchanged");
      expect(h.repo.events).toHaveLength(1);
      expect(h.alerts.sent).toHaveLength(1);
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

    it("keeps the event but not the cursor when the email fails", async () => {
      const h = harness({ alert: new Error("resend 500") });

      const result = await runPipelineForApp(h.app, h.deps);

      expect(result.status).toBe("failed");
      expect(h.repo.events).toHaveLength(1);
      expect(h.repo.events[0].emailSentAt).toBeNull();
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
    it("resends the alert without paying for the LLM again", async () => {
      const h = harness({ alert: new Error("resend 500") });
      await runPipelineForApp(h.app, h.deps);
      expect(h.triage.calls).toBe(1);

      // Second run: email works this time.
      const retry = harness();
      retry.repo.events = h.repo.events;
      retry.repo.apps[0] = h.repo.apps[0];
      retry.repo.calls = [];

      const result = await runPipelineForApp(retry.repo.apps[0], retry.deps);

      expect(result.status).toBe("processed");
      expect(retry.triage.calls).toBe(0); // the expensive step is skipped
      expect(retry.repo.events).toHaveLength(1); // and no duplicate row
      expect(retry.repo.apps[0].lastSeenVersion).toBe("5.337.0");
      expect(retry.repo.calls).toEqual(["markEmailSent", "advanceLastSeenVersion"]);
    });

    it("self-heals a stored event whose alert already went out", async () => {
      // Crash between markEmailSent and advanceLastSeenVersion: the event is
      // complete but the cursor never moved. Re-running must fix the cursor
      // without re-alerting.
      const h = harness();
      await runPipelineForApp(h.app, h.deps);
      h.repo.apps[0].lastSeenVersion = null; // simulate the lost write
      h.repo.calls = [];

      const result = await runPipelineForApp(h.repo.apps[0], h.deps);

      expect(result.status).toBe("already-processed");
      expect(h.alerts.sent).toHaveLength(1); // not re-sent
      expect(h.triage.calls).toBe(1); // not re-run
      expect(h.repo.apps[0].lastSeenVersion).toBe("5.337.0");
    });

    it("does not re-alert when the store rolls back to a version already processed", async () => {
      // Apple pulls a build and the listing reverts. detectRelease sees a
      // difference and says "process"; the event store is what stops the
      // duplicate alert.
      const h = harness();
      await runPipelineForApp(h.app, h.deps); // processes 5.337.0
      h.repo.apps[0].lastSeenVersion = "5.338.0"; // we'd since seen a newer one

      const result = await runPipelineForApp(h.repo.apps[0], h.deps); // store shows 5.337.0 again

      expect(result.status).toBe("already-processed");
      expect(h.alerts.sent).toHaveLength(1);
      expect(h.repo.events).toHaveLength(1);
    });
  });

  describe("HN reaction is optional", () => {
    it("still produces an event when the reaction lookup fails", async () => {
      // Community reaction is enrichment, not a dependency. Losing it must not
      // cost us the release alert.
      const h = harness({ reaction: new Error("algolia timeout") });

      const result = await runPipelineForApp(h.app, h.deps);

      expect(result.status).toBe("processed");
      expect(h.repo.events[0].hnStoryRefs).toEqual([]);
      expect(h.repo.apps[0].lastSeenVersion).toBe("5.337.0");
    });

    it("skips HN entirely when the app has no usable query", async () => {
      // Some brand names ("Current") are too generic to search — the honest
      // move is to skip, not to summarise 18k unrelated stories.
      const h = harness({ app: makeApp({ hnQuery: null }) });

      const result = await runPipelineForApp(h.app, h.deps);

      expect(result.status).toBe("processed");
      expect(h.reactions.calls).toBe(0);
      expect(h.repo.events[0].hnStoryRefs).toEqual([]);
    });

    it("stores no summary when there was no discussion to summarise", async () => {
      const h = harness();
      await runPipelineForApp(h.app, h.deps);
      expect(h.repo.events[0].hnSummary).toBeNull();
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
      reactions: new FakeReactionSource(),
      triage: new FakeTriageEngine(),
      alerts: new FakeAlertSender(),
      clock: fixedClock(NOW),
    };

    const results = await runPipeline(deps);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("failed");
    expect(results[1].status).toBe("processed");
    expect(repo.apps[1].lastSeenVersion).toBe("10.141");
  });
});

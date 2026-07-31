import type { AppRelease } from "@/lib/sources/itunes";
import type { HnReaction } from "@/lib/sources/hn";
import type { LlmTriage } from "@/lib/llm/schema";
import type {
  FlankerEvent,
  FlankerEventWithApp,
  FlankerRepo,
  NewEventInput,
  TrackedApp,
} from "@/lib/storage/types";
import type { AlertSender, ReactionSource, ReleaseSource, TriageEngine } from "@/lib/pipeline/ports";

export function makeApp(overrides: Partial<TrackedApp> = {}): TrackedApp {
  return {
    id: "app-1",
    itunesTrackId: 836215269,
    name: "Chime",
    hnQuery: "Chime",
    lastSeenVersion: null,
    lastCheckedAt: null,
    enabled: true,
    ...overrides,
  };
}

export function makeRelease(overrides: Partial<AppRelease> = {}): AppRelease {
  return {
    trackId: 836215269,
    appName: "Chime",
    version: "5.337.0",
    releaseNotes: "Added instant paycheck advances up to $500.",
    releaseDate: "2026-07-28T20:10:14Z",
    trackViewUrl: "https://apps.apple.com/us/app/id836215269",
    artworkUrl: null,
    sellerName: "Chime Financial, Inc.",
    ...overrides,
  };
}

export function makeTriage(overrides: Partial<LlmTriage> = {}): LlmTriage {
  return {
    headline: "Chime ships instant paycheck advances",
    signal_level: "high",
    feature_analysis: "Short-term liquidity product fronting earned wages.",
    strategic_read: "Deepens primary-account behaviour ahead of a bank charter.",
    hn_reaction_summary: null,
    counter_prd: {
      problem_statement: "Users bridge shortfalls with high-cost credit.",
      why_now: "Competitor has set a $500 anchor.",
      proposed_feature: "Earned-wage access tied to direct deposit history.",
      success_metric: "30-day repeat usage among enrolled users.",
    },
    ...overrides,
  };
}

export function makeReaction(overrides: Partial<HnReaction> = {}): HnReaction {
  return { query: "Chime", stories: [], comments: [], ...overrides };
}

/**
 * In-memory FlankerRepo.
 *
 * Enforces the same unique (app_id, version) constraint the real schema does,
 * so tests exercise the actual guarantee rather than a permissive stand-in.
 */
export class FakeRepo implements FlankerRepo {
  events: FlankerEvent[] = [];
  calls: string[] = [];
  private seq = 0;

  constructor(public apps: TrackedApp[] = [makeApp()]) {}

  async listTrackedApps({ enabledOnly = true } = {}): Promise<TrackedApp[]> {
    return this.apps.filter((a) => (enabledOnly ? a.enabled : true));
  }

  async findEvent(appId: string, version: string): Promise<FlankerEvent | null> {
    return this.events.find((e) => e.appId === appId && e.version === version) ?? null;
  }

  async insertEvent(input: NewEventInput): Promise<FlankerEvent> {
    this.calls.push("insertEvent");
    if (await this.findEvent(input.appId, input.version)) {
      const error = new Error(
        `duplicate key value violates unique constraint "events_app_version_unique"`,
      );
      (error as { code?: string }).code = "23505";
      throw error;
    }
    const event: FlankerEvent = {
      id: `event-${++this.seq}`,
      appId: input.appId,
      version: input.version,
      releaseNotes: input.releaseNotes,
      releaseDate: input.releaseDate,
      hnSummary: input.hnSummary,
      hnStoryRefs: input.hnStoryRefs,
      llmOutput: input.llmOutput,
      signalLevel: input.signalLevel,
      detectedAt: "2026-07-30T00:00:00.000Z",
      emailSentAt: null,
    };
    this.events.push(event);
    return event;
  }

  async markEmailSent(eventId: string, sentAt: string): Promise<void> {
    this.calls.push("markEmailSent");
    const event = this.events.find((e) => e.id === eventId);
    if (event) event.emailSentAt = sentAt;
  }

  async advanceLastSeenVersion(appId: string, version: string, checkedAt: string): Promise<void> {
    this.calls.push("advanceLastSeenVersion");
    const app = this.apps.find((a) => a.id === appId);
    if (app) {
      app.lastSeenVersion = version;
      app.lastCheckedAt = checkedAt;
    }
  }

  async touchLastChecked(appId: string, checkedAt: string): Promise<void> {
    this.calls.push("touchLastChecked");
    const app = this.apps.find((a) => a.id === appId);
    if (app) app.lastCheckedAt = checkedAt;
  }

  async listRecentEvents(limit = 50): Promise<FlankerEventWithApp[]> {
    return this.events.slice(0, limit).map((event) => {
      const app = this.apps.find((a) => a.id === event.appId);
      return {
        ...event,
        app: {
          id: app?.id ?? event.appId,
          name: app?.name ?? "Unknown",
          itunesTrackId: app?.itunesTrackId ?? 0,
        },
      };
    });
  }

  async setLastSeenVersion(appId: string, version: string | null): Promise<void> {
    const app = this.apps.find((a) => a.id === appId);
    if (app) app.lastSeenVersion = version;
  }
}

export class FakeReleaseSource implements ReleaseSource {
  calls = 0;
  constructor(private readonly release: AppRelease | Error = makeRelease()) {}
  async fetchLatestRelease(): Promise<AppRelease> {
    this.calls++;
    if (this.release instanceof Error) throw this.release;
    return this.release;
  }
}

export class FakeReactionSource implements ReactionSource {
  calls = 0;
  constructor(private readonly reaction: HnReaction | Error = makeReaction()) {}
  async fetchReaction(): Promise<HnReaction> {
    this.calls++;
    if (this.reaction instanceof Error) throw this.reaction;
    return this.reaction;
  }
}

export class FakeTriageEngine implements TriageEngine {
  calls = 0;
  constructor(private readonly result: LlmTriage | Error = makeTriage()) {}
  async triage(): Promise<LlmTriage> {
    this.calls++;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

export class FakeAlertSender implements AlertSender {
  calls = 0;
  sent: string[] = [];
  constructor(private readonly failure: Error | null = null) {}
  async send({ event }: { event: FlankerEvent }): Promise<void> {
    this.calls++;
    if (this.failure) throw this.failure;
    this.sent.push(event.id);
  }
}

export const fixedClock = (iso = "2026-07-30T12:00:00.000Z") => () => new Date(iso);

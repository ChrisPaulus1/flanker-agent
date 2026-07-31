import type { AppRelease } from "@/lib/sources/itunes";
import type { HnReaction } from "@/lib/sources/hn";
import type { LlmTriage } from "@/lib/llm/schema";
import type {
  CatalogApp,
  FlankerEvent,
  FlankerEventWithApp,
  FlankerRepo,
  NewEventInput,
  TrackedApp,
} from "@/lib/storage/types";
import type {
  ReactionSource,
  ReleaseSource,
  TriageEngine,
  TriageResult,
} from "@/lib/pipeline/ports";

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
      model: input.model,
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

  async findTrackedByItunesId(itunesTrackId: number): Promise<TrackedApp | null> {
    return this.apps.find((a) => a.itunesTrackId === itunesTrackId) ?? null;
  }

  async createTrackedApp(input: {
    itunesTrackId: number;
    name: string;
    hnQuery: string | null;
  }): Promise<TrackedApp> {
    const existing = this.apps.find((a) => a.itunesTrackId === input.itunesTrackId);
    if (existing) return existing;
    const app: TrackedApp = {
      id: `app-${this.apps.length + 1}`,
      itunesTrackId: input.itunesTrackId,
      name: input.name,
      hnQuery: input.hnQuery,
      lastSeenVersion: null,
      lastCheckedAt: null,
      enabled: true,
    };
    this.apps.push(app);
    return app;
  }

  async countEventsSince(sinceIso: string): Promise<number> {
    return this.events.filter((e) => e.detectedAt >= sinceIso).length;
  }

  async listEventsForApp(appId: string, limit = 50): Promise<FlankerEventWithApp[]> {
    const all = await this.listRecentEvents(1000);
    return all.filter((e) => e.appId === appId).slice(0, limit);
  }

  // --- catalog ---------------------------------------------------------
  catalog: CatalogApp[] = [];

  async upsertCatalogApps(apps: CatalogApp[]): Promise<number> {
    for (const app of apps) {
      const i = this.catalog.findIndex((c) => c.itunesTrackId === app.itunesTrackId);
      if (i >= 0) this.catalog[i] = app;
      else this.catalog.push(app);
    }
    return apps.length;
  }

  private rank(a: CatalogApp) {
    return a.popularityRank ?? Number.MAX_SAFE_INTEGER;
  }

  async searchCatalogPrefix(prefix: string, limit: number): Promise<CatalogApp[]> {
    const q = prefix.trim().toLowerCase();
    if (!q) return [];
    return this.catalog
      .filter((a) => a.name.toLowerCase().startsWith(q))
      .sort((a, b) => this.rank(a) - this.rank(b) || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  async searchCatalog(query: string, limit: number): Promise<CatalogApp[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.catalog
      .filter((a) => a.name.toLowerCase().includes(q))
      .sort((a, b) => this.rank(a) - this.rank(b) || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  async getCatalogApp(itunesTrackId: number): Promise<CatalogApp | null> {
    return this.catalog.find((a) => a.itunesTrackId === itunesTrackId) ?? null;
  }

  async countCatalogApps(): Promise<number> {
    return this.catalog.length;
  }

  async deleteEvent(appId: string, version: string): Promise<boolean> {
    const before = this.events.length;
    this.events = this.events.filter((e) => !(e.appId === appId && e.version === version));
    return this.events.length < before;
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
  constructor(
    private readonly result: LlmTriage | Error = makeTriage(),
    private readonly model = "fake-model",
  ) {}
  async triage(): Promise<TriageResult> {
    this.calls++;
    if (this.result instanceof Error) throw this.result;
    return { output: this.result, model: this.model };
  }
}

export const fixedClock = (iso = "2026-07-30T12:00:00.000Z") => () => new Date(iso);

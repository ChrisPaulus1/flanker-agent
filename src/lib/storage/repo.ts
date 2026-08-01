import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/storage/client";
import type { HnStory } from "@/lib/sources/hn";
import { llmTriageSchema, type SignalLevel } from "@/lib/llm/schema";
import type {
  CatalogApp,
  FlankerEvent,
  FlankerEventWithApp,
  FlankerRepo,
  NewEventInput,
  ObservedRelease,
  TrackedApp,
} from "@/lib/storage/types";

const APP_COLUMNS = "id, itunes_track_id, name, hn_query, last_seen_version, last_checked_at, enabled";
const CATALOG_COLUMNS =
  "itunes_track_id, name, developer, genre, icon_url, version, release_notes, release_date, popularity_rank";
const EVENT_COLUMNS =
  "id, app_id, version, release_notes, release_date, hn_summary, hn_story_refs, llm_output_json, signal_level, model, detected_at, email_sent_at";

type AppRow = {
  id: string;
  itunes_track_id: number;
  name: string;
  hn_query: string;
  last_seen_version: string | null;
  last_checked_at: string | null;
  enabled: boolean;
};

type EventRow = {
  id: string;
  app_id: string;
  version: string;
  release_notes: string | null;
  release_date: string | null;
  hn_summary: string | null;
  hn_story_refs: unknown;
  llm_output_json: unknown;
  signal_level: string;
  model: string | null;
  detected_at: string;
  email_sent_at: string | null;
  // supabase-js types an embedded relation as an array even when the foreign
  // key guarantees at most one row, so accept both shapes and normalise.
  tracked_apps?: EmbeddedApp | EmbeddedApp[] | null;
};

type EmbeddedApp = { id: string; name: string; itunes_track_id: number };

function firstEmbedded(value: EventRow["tracked_apps"]): EmbeddedApp | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toApp(row: AppRow): TrackedApp {
  return {
    id: row.id,
    itunesTrackId: Number(row.itunes_track_id),
    name: row.name,
    hnQuery: row.hn_query,
    lastSeenVersion: row.last_seen_version,
    lastCheckedAt: row.last_checked_at,
    enabled: row.enabled,
  };
}

function toEvent(row: EventRow): FlankerEvent {
  return {
    id: row.id,
    appId: row.app_id,
    version: row.version,
    releaseNotes: row.release_notes,
    releaseDate: row.release_date,
    hnSummary: row.hn_summary,
    hnStoryRefs: Array.isArray(row.hn_story_refs) ? (row.hn_story_refs as HnStory[]) : [],
    // Validate on the way out too: a row written by an older prompt version
    // shouldn't be able to crash the dashboard with a missing field.
    llmOutput: llmTriageSchema.parse(row.llm_output_json),
    signalLevel: row.signal_level as SignalLevel,
    model: row.model,
    detectedAt: row.detected_at,
    emailSentAt: row.email_sent_at,
  };
}

type CatalogRow = {
  itunes_track_id: number;
  name: string;
  developer: string | null;
  genre: string | null;
  icon_url: string | null;
  version: string | null;
  release_notes: string | null;
  release_date: string | null;
  popularity_rank: number | null;
};

function toCatalogApp(row: CatalogRow): CatalogApp {
  return {
    itunesTrackId: Number(row.itunes_track_id),
    name: row.name,
    developer: row.developer,
    genre: row.genre,
    iconUrl: row.icon_url,
    version: row.version,
    releaseNotes: row.release_notes,
    releaseDate: row.release_date,
    popularityRank: row.popularity_rank,
  };
}

/**
 * `%` and `_` are wildcards in LIKE. A user typing "100%" must not turn into a
 * match-everything pattern.
 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function fail(operation: string, error: { message: string } | null): never {
  throw new Error(`Supabase ${operation} failed: ${error?.message ?? "unknown error"}`);
}

export class SupabaseFlankerRepo implements FlankerRepo {
  constructor(private readonly db: SupabaseClient = getSupabase()) {}

  async listTrackedApps({ enabledOnly = true } = {}): Promise<TrackedApp[]> {
    let query = this.db.from("tracked_apps").select(APP_COLUMNS).order("name");
    if (enabledOnly) query = query.eq("enabled", true);

    const { data, error } = await query;
    if (error) fail("listTrackedApps", error);
    return (data as AppRow[]).map(toApp);
  }

  async findEvent(appId: string, version: string): Promise<FlankerEvent | null> {
    const { data, error } = await this.db
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("app_id", appId)
      .eq("version", version)
      .maybeSingle();

    if (error) fail("findEvent", error);
    return data ? toEvent(data as EventRow) : null;
  }

  async insertEvent(input: NewEventInput): Promise<FlankerEvent> {
    const { data, error } = await this.db
      .from("events")
      .insert({
        app_id: input.appId,
        version: input.version,
        release_notes: input.releaseNotes,
        release_date: input.releaseDate,
        hn_summary: input.hnSummary,
        hn_story_refs: input.hnStoryRefs,
        llm_output_json: input.llmOutput,
        signal_level: input.signalLevel,
        model: input.model,
      })
      .select(EVENT_COLUMNS)
      .single();

    if (error) fail("insertEvent", error);
    return toEvent(data as EventRow);
  }

  async markEmailSent(eventId: string, sentAt: string): Promise<void> {
    const { error } = await this.db.from("events").update({ email_sent_at: sentAt }).eq("id", eventId);
    if (error) fail("markEmailSent", error);
  }

  async advanceLastSeenVersion(appId: string, version: string, checkedAt: string): Promise<void> {
    const { error } = await this.db
      .from("tracked_apps")
      .update({ last_seen_version: version, last_checked_at: checkedAt })
      .eq("id", appId);
    if (error) fail("advanceLastSeenVersion", error);
  }

  async touchLastChecked(appId: string, checkedAt: string): Promise<void> {
    const { error } = await this.db
      .from("tracked_apps")
      .update({ last_checked_at: checkedAt })
      .eq("id", appId);
    if (error) fail("touchLastChecked", error);
  }

  async listRecentEvents(limit = 50): Promise<FlankerEventWithApp[]> {
    const { data, error } = await this.db
      .from("events")
      .select(`${EVENT_COLUMNS}, tracked_apps!inner(id, name, itunes_track_id)`)
      .order("detected_at", { ascending: false })
      .limit(limit);

    if (error) fail("listRecentEvents", error);

    return (data as unknown as EventRow[]).map((row) => {
      const app = firstEmbedded(row.tracked_apps);
      return {
        ...toEvent(row),
        app: {
          id: app?.id ?? row.app_id,
          name: app?.name ?? "Unknown app",
          itunesTrackId: Number(app?.itunes_track_id ?? 0),
        },
      };
    });
  }

  async deleteEvent(appId: string, version: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("events")
      .delete()
      .eq("app_id", appId)
      .eq("version", version)
      .select("id");

    if (error) fail("deleteEvent", error);
    return (data?.length ?? 0) > 0;
  }

  async findTrackedByItunesId(itunesTrackId: number): Promise<TrackedApp | null> {
    const { data, error } = await this.db
      .from("tracked_apps")
      .select(APP_COLUMNS)
      .eq("itunes_track_id", itunesTrackId)
      .maybeSingle();

    if (error) fail("findTrackedByItunesId", error);
    return data ? toApp(data as AppRow) : null;
  }

  async createTrackedApp(input: {
    itunesTrackId: number;
    name: string;
    hnQuery: string | null;
  }): Promise<TrackedApp> {
    // Upsert rather than insert: two visitors can open the same new app at the
    // same moment, and the unique constraint on itunes_track_id would make one
    // of them fail for no good reason.
    const { data, error } = await this.db
      .from("tracked_apps")
      .upsert(
        {
          itunes_track_id: input.itunesTrackId,
          name: input.name,
          hn_query: input.hnQuery,
          enabled: true,
        },
        { onConflict: "itunes_track_id" },
      )
      .select(APP_COLUMNS)
      .single();

    if (error) fail("createTrackedApp", error);
    return toApp(data as AppRow);
  }

  async countEventsSince(sinceIso: string): Promise<number> {
    const { count, error } = await this.db
      .from("events")
      .select("id", { count: "exact", head: true })
      .gte("detected_at", sinceIso);

    if (error) fail("countEventsSince", error);
    return count ?? 0;
  }

  async listEventsForApp(appId: string, limit = 50): Promise<FlankerEventWithApp[]> {
    const { data, error } = await this.db
      .from("events")
      .select(`${EVENT_COLUMNS}, tracked_apps!inner(id, name, itunes_track_id)`)
      .eq("app_id", appId)
      .order("detected_at", { ascending: false })
      .limit(limit);

    if (error) fail("listEventsForApp", error);

    return (data as unknown as EventRow[]).map((row) => {
      const app = firstEmbedded(row.tracked_apps);
      return {
        ...toEvent(row),
        app: {
          id: app?.id ?? row.app_id,
          name: app?.name ?? "Unknown app",
          itunesTrackId: Number(app?.itunes_track_id ?? 0),
        },
      };
    });
  }

  /**
   * Record observed versions in bulk.
   *
   * `ignoreDuplicates` leans on the unique (itunes_track_id, version)
   * constraint so the sweep can blindly write whatever it sees: re-reading the
   * same current version every run is the common case, and this makes that a
   * no-op without a read-before-write round trip.
   */
  async recordReleases(releases: Omit<ObservedRelease, "firstSeenAt">[]): Promise<number> {
    if (releases.length === 0) return 0;

    const { data, error } = await this.db
      .from("releases")
      .upsert(
        releases.map((r) => ({
          itunes_track_id: r.itunesTrackId,
          version: r.version,
          release_notes: r.releaseNotes,
          release_date: r.releaseDate,
        })),
        { onConflict: "itunes_track_id,version", ignoreDuplicates: true },
      )
      .select("id");

    if (error) fail("recordReleases", error);
    return data?.length ?? 0;
  }

  /**
   * The watch set, most popular first.
   *
   * Paginated with `.range()` rather than a single `.limit()`: PostgREST caps
   * a response at 1,000 rows by default, so asking for 2,000 silently returns
   * 1,000 and the sweep quietly watches half the set it reported. Found by the
   * first live sweep coming back with watchSetSize 1000 for a 2,000 request.
   */
  async listPopularTrackIds(limit: number): Promise<number[]> {
    const PAGE = 1_000;
    const ids: number[] = [];

    for (let offset = 0; offset < limit; offset += PAGE) {
      const upper = Math.min(offset + PAGE, limit) - 1;
      const { data, error } = await this.db
        .from("catalog_apps")
        .select("itunes_track_id")
        // Chart-ranked apps first; unranked ones have no popularity signal and
        // are the long tail nobody searches for.
        .order("popularity_rank", { ascending: true, nullsFirst: false })
        .order("itunes_track_id", { ascending: true })
        .range(offset, upper);

      if (error) fail("listPopularTrackIds", error);
      const page = (data ?? []).map((row) => Number(row.itunes_track_id));
      ids.push(...page);
      // Short page means the catalogue is smaller than the requested watch set.
      if (page.length < upper - offset + 1) break;
    }

    return ids;
  }

  async listReleases(itunesTrackId: number, limit = 20): Promise<ObservedRelease[]> {
    const { data, error } = await this.db
      .from("releases")
      .select("itunes_track_id, version, release_notes, release_date, first_seen_at")
      .eq("itunes_track_id", itunesTrackId)
      // Nulls last so an app with no release date doesn't outrank dated ones.
      .order("release_date", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: false })
      .limit(limit);

    if (error) fail("listReleases", error);

    return (data ?? []).map((row) => ({
      itunesTrackId: Number(row.itunes_track_id),
      version: row.version as string,
      releaseNotes: (row.release_notes as string | null) ?? null,
      releaseDate: (row.release_date as string | null) ?? null,
      firstSeenAt: row.first_seen_at as string,
    }));
  }

  async setLastSeenVersion(appId: string, version: string | null): Promise<void> {
    const { error } = await this.db
      .from("tracked_apps")
      .update({ last_seen_version: version })
      .eq("id", appId);
    if (error) fail("setLastSeenVersion", error);
  }

  // --- catalog ---------------------------------------------------------

  async upsertCatalogApps(apps: CatalogApp[]): Promise<number> {
    if (apps.length === 0) return 0;

    // Chunked because a single insert of 10k rows exceeds what PostgREST will
    // accept in one request body.
    const CHUNK = 500;
    let written = 0;

    for (let i = 0; i < apps.length; i += CHUNK) {
      const batch = apps.slice(i, i + CHUNK).map((a) => ({
        itunes_track_id: a.itunesTrackId,
        name: a.name,
        developer: a.developer,
        genre: a.genre,
        icon_url: a.iconUrl,
        version: a.version,
        release_notes: a.releaseNotes,
        release_date: a.releaseDate,
        popularity_rank: a.popularityRank,
        refreshed_at: new Date().toISOString(),
      }));

      const { error } = await this.db
        .from("catalog_apps")
        .upsert(batch, { onConflict: "itunes_track_id" });
      if (error) fail("upsertCatalogApps", error);
      written += batch.length;
    }

    return written;
  }

  async searchCatalogPrefix(prefix: string, limit: number): Promise<CatalogApp[]> {
    const cleaned = prefix.trim().toLowerCase();
    if (cleaned.length === 0) return [];

    const { data, error } = await this.db
      .from("catalog_apps")
      .select(CATALOG_COLUMNS)
      .ilike("name", `${escapeLike(cleaned)}%`)
      // Charted apps first, so "s" surfaces Spotify rather than a dead app
      // whose name happens to start with s.
      .order("popularity_rank", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true })
      .limit(limit);

    if (error) fail("searchCatalogPrefix", error);
    return (data as CatalogRow[]).map(toCatalogApp);
  }

  async searchCatalog(query: string, limit: number): Promise<CatalogApp[]> {
    const cleaned = query.trim().toLowerCase();
    if (cleaned.length === 0) return [];

    const { data, error } = await this.db
      .from("catalog_apps")
      .select(CATALOG_COLUMNS)
      .ilike("name", `%${escapeLike(cleaned)}%`)
      .order("popularity_rank", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true })
      .limit(limit);

    if (error) fail("searchCatalog", error);
    return (data as CatalogRow[]).map(toCatalogApp);
  }

  async getCatalogApp(itunesTrackId: number): Promise<CatalogApp | null> {
    const { data, error } = await this.db
      .from("catalog_apps")
      .select(CATALOG_COLUMNS)
      .eq("itunes_track_id", itunesTrackId)
      .maybeSingle();

    if (error) fail("getCatalogApp", error);
    return data ? toCatalogApp(data as CatalogRow) : null;
  }

  async countCatalogApps(): Promise<number> {
    // NOT head:true. A HEAD count against a table that doesn't exist comes
    // back with no body, supabase-js leaves `error` null, and this returned a
    // confident 0 — which reads exactly like "table exists, no rows yet". That
    // false negative let a 20-minute catalog build run against a table that
    // was never created. Asking for a row surfaces the real PGRST205.
    const { data, count, error } = await this.db
      .from("catalog_apps")
      .select("itunes_track_id", { count: "exact" })
      .limit(1);

    if (error) fail("countCatalogApps", error);
    return count ?? (data?.length ?? 0);
  }
}

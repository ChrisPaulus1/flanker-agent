import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/storage/client";
import type { HnStory } from "@/lib/sources/hn";
import { llmTriageSchema, type SignalLevel } from "@/lib/llm/schema";
import type {
  FlankerEvent,
  FlankerEventWithApp,
  FlankerRepo,
  NewEventInput,
  TrackedApp,
} from "@/lib/storage/types";

const APP_COLUMNS = "id, itunes_track_id, name, hn_query, last_seen_version, last_checked_at, enabled";
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

  async setLastSeenVersion(appId: string, version: string | null): Promise<void> {
    const { error } = await this.db
      .from("tracked_apps")
      .update({ last_seen_version: version })
      .eq("id", appId);
    if (error) fail("setLastSeenVersion", error);
  }
}

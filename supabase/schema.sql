-- Flanker schema. Paste into the Supabase SQL editor and run.
-- Safe to re-run: everything is IF NOT EXISTS / ON CONFLICT.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- tracked_apps: the competitor set, plus the cursor for change detection.
-- ---------------------------------------------------------------------------
create table if not exists public.tracked_apps (
  id                uuid primary key default gen_random_uuid(),
  itunes_track_id   bigint      not null unique,
  name              text        not null,
  -- Plain phrase, not an Algolia boolean expression: the HN index has no
  -- AND/OR support and would match the operators as literal words.
  hn_query          text        not null,
  -- NULL means "never checked" — the backfill treats that as the bootstrap
  -- case rather than as a new release.
  last_seen_version text,
  last_checked_at   timestamptz,
  enabled           boolean     not null default true,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- events: one row per detected release, with the full pipeline output.
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid        not null references public.tracked_apps(id) on delete cascade,
  version         text        not null,
  release_notes   text,
  release_date    timestamptz,
  hn_summary      text,
  hn_story_refs   jsonb       not null default '[]'::jsonb,
  llm_output_json jsonb       not null,
  signal_level    text        not null check (signal_level in ('high', 'medium', 'low')),
  -- Which Gemini model produced llm_output_json. Recorded because the engine
  -- silently degrades to a lighter model when the preferred one exhausts its
  -- daily free quota, and that shouldn't be invisible after the fact.
  model           text,
  detected_at     timestamptz not null default now(),
  -- NULL means the event was persisted but the alert never went out. The cron
  -- run uses this to resend without paying for the LLM call again.
  email_sent_at   timestamptz,

  -- The real idempotency backstop: re-running the pipeline for a version we
  -- already processed cannot create a duplicate, regardless of what the
  -- in-process logic believes.
  constraint events_app_version_unique unique (app_id, version)
);

-- Additive migration for projects created before `model` existed.
alter table public.events add column if not exists model text;

create index if not exists events_detected_at_idx on public.events (detected_at desc);
create index if not exists events_app_id_idx on public.events (app_id);

-- ---------------------------------------------------------------------------
-- Row Level Security.
--
-- Flanker is a single-operator tool with no user auth. Everything reaches
-- Postgres through the service role key from server-side code only, and the
-- service role bypasses RLS. RLS is still enabled with no permissive policies
-- so that if an anon key ever leaks into the browser, it reads nothing.
-- ---------------------------------------------------------------------------
alter table public.tracked_apps enable row level security;
alter table public.events       enable row level security;

-- Newer Supabase projects do NOT auto-grant table privileges to service_role on
-- tables created through the SQL editor. Without these, every request comes back
-- 403 / 42501 "permission denied for table" even though the key authenticates
-- correctly as service_role. Granting only to service_role, deliberately:
-- anon and authenticated are left with no privileges at all, so a leaked
-- publishable key can read nothing.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.tracked_apps to service_role;
grant select, insert, update, delete on public.events       to service_role;

-- ---------------------------------------------------------------------------
-- Seed the tracked competitor set. Re-running updates the name/query but never
-- clobbers last_seen_version, so seeding can't accidentally replay alerts.
-- ---------------------------------------------------------------------------
insert into public.tracked_apps (itunes_track_id, name, hn_query) values
  (836215269, 'Chime',     'Chime'),
  (932493382, 'Revolut',   'Revolut'),
  (938003185, 'Robinhood', 'Robinhood'),
  (711923939, 'Cash App',  'Cash App')
on conflict (itunes_track_id) do update
  set name = excluded.name,
      hn_query = excluded.hn_query;

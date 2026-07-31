-- Catalog of App Store apps that Flanker can analyse.
-- Paste into the Supabase SQL editor and run. Safe to re-run.

-- ---------------------------------------------------------------------------
-- catalog_apps: the searchable universe.
--
-- Separate from tracked_apps on purpose. tracked_apps is the small set the
-- scheduled cron monitors; catalog_apps is the ~10k a visitor can search. An
-- app graduates from catalog to tracked when someone actually looks at it.
-- ---------------------------------------------------------------------------
create table if not exists public.catalog_apps (
  itunes_track_id bigint      primary key,
  name            text        not null,
  developer       text,
  genre           text,
  icon_url        text,
  -- Denormalised from the last bulk refresh so search results and the app
  -- header render with zero extra API calls.
  version         text,
  release_notes   text,
  release_date    timestamptz,
  -- Chart position when discovered, else null. Drives type-ahead ranking and
  -- decides which apps are worth precomputing.
  popularity_rank integer,
  refreshed_at    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- Prefix search: "s" -> apps starting with s. text_pattern_ops is what makes
-- LIKE 'foo%' use an index instead of scanning 10k rows.
create index if not exists catalog_apps_name_prefix_idx
  on public.catalog_apps (lower(name) text_pattern_ops);

-- Substring search for the full search page, and the ranking sort.
create index if not exists catalog_apps_name_trgm_idx on public.catalog_apps (lower(name));
create index if not exists catalog_apps_popularity_idx
  on public.catalog_apps (popularity_rank nulls last);

alter table public.catalog_apps enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.catalog_apps to service_role;

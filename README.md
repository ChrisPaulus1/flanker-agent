# Flanker

Search any App Store app and see what its team actually shipped. Flanker reads
release notes and reverse-engineers each release into a strategic read,
separating the genuine launches from the "bug fixes and improvements" filler
that most releases are.

Tell it what you build and the analysis becomes a counter-PRD written for your
product.

Built with Next.js, Supabase, Gemini & Vercel Cron.

**Live dashboard: https://flanker-agent.vercel.app**

## Architecture

<!-- GitHub swaps these automatically with the reader's colour scheme. -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/architecture-dark.png">
  <img src="docs/architecture.png" alt="Flanker system architecture: an instant browse path over a 16,700-app catalog, on-demand analysis through a five-stage idempotent pipeline — detect, reconcile, triage, persist, advance cursor — and a continuous monitoring sweep that checks 2,000 apps in ten keyless requests with no model calls, backed by Supabase and Gemini, with a daily budget guard that degrades to cached results instead of erroring.">
</picture>

The diagram is authored as HTML in [docs/architecture.html](docs/architecture.html) and rendered
with `npm run diagram`, so it stays reviewable in a diff and can be regenerated when the system
changes. It shares the app's design tokens, so the two can't drift apart.

## What it does

Search the catalog, open an app, and Flanker runs this for that app's current
release — on demand, cached afterwards:

1. **Detect** — look up the current version via the iTunes Search API and
   compare it to the stored cursor.
2. **Reconcile** — an event already stored for that version short-circuits the
   run, which is what makes a re-run safe.
3. **Triage** — send the release notes to Gemini with a structured prompt, and
   get back a signal level, feature analysis, strategic read and counter-PRD.
4. **Persist** — store the event, keyed by `(app, version)` so it's cached forever.
5. **Advance the cursor** — last, and only once the event is durably stored.

The version cursor advances **only after** the event is written, so a failure
anywhere in the pipeline means the release is retried rather than silently
dropped.

### Two output modes

Without knowing who's reading, a counter-PRD is advice to a company that doesn't
exist. So the default output is a **teardown** — what shipped, why, what it
signals, with no "we" anywhere. Name your own product and it becomes a real
**counter-PRD** written from that product's position.

## Stack

| Concern | Choice |
| --- | --- |
| App | Next.js 14 (App Router), TypeScript |
| UI | Tailwind CSS, shadcn/ui, light + dark mode |
| Storage | Supabase (Postgres) |
| LLM | Gemini, model resolved at runtime |
| Scheduling | Vercel Cron (daily) + GitHub Actions (hourly) |
| Sources | iTunes Search API (catalog, releases, batched lookup) |

Every external service is on a free tier and none require a credit card.

## Code layout

```
src/lib/
  sources/     iTunes adapters — single lookup, batched lookup, catalog discovery
  catalog/     search + type-ahead over the app catalog
  llm/         model resolution, prompt, schema, tolerant parser
  storage/     Supabase repo behind a FlankerRepo interface
  pipeline/    detection, orchestration, ports, budget guard
```

`sources`, `storage` and `llm` are I/O adapters that know nothing about each
other. `pipeline/run.ts` is the only place they compose, and it takes its
dependencies as arguments — which is what lets the idempotency logic be tested
against in-memory fakes with no network, no database and no LLM spend.

### Why on demand

Pre-generating an analysis for every app in the catalog would cost about ten
days of free-tier quota, and most of it would never be read. Instead the browse
path — search, type-ahead, app header — touches nothing but Postgres, and an
analysis is generated the first time someone actually opens an app. The
`UNIQUE (app_id, version)` constraint that gives the cron its idempotency
doubles as the cache key.

When the daily budget is spent, cached analyses keep serving and new ones report
that live analysis is paused until the quota resets, rather than erroring.

## Getting started

```bash
nvm use                 # Node 22 — supabase-js requires it
npm install
cp .env.example .env.local
```

Fill in `.env.local`, then paste `supabase/schema.sql` and `supabase/catalog.sql`
into the Supabase SQL editor and run them. Both are idempotent. Then build the
catalog:

```bash
npm run build-catalog        # ~12 min, keyless, respects Apple's 20 req/min
```

Verify each layer independently:

```bash
npx tsx scripts/check-storage.ts   # schema, seed data, unique constraint
npm run resolve-model              # which Gemini models this key can use
```

Then run it:

```bash
npm run dev
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/poll
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm test` | Unit tests |
| `npm run backfill` | Populate history from every app's current version |
| `npm run simulate-release <app>` | Rewind memory so the next run re-detects a release |
| `npm run resolve-model` | Discover and verify an available Gemini model |
| `npm run build-catalog` | Discover and hydrate the searchable app catalog |
| `npm run diagram` | Re-render the architecture diagram to PNG |

`simulate-release` fakes no API data. It only rewinds Flanker's own memory; the
pipeline then re-runs against whatever the App Store actually returns at
that moment. Pass `--keep-event` to leave the stored event in place, which
demonstrates the idempotency check rejecting the duplicate.

## Deployment

Import the repo on Vercel, set the environment variables from `.env.example`,
and deploy. `vercel.json` registers a daily cron; the hourly polling comes from
`.github/workflows/poll.yml`, which needs two repository secrets:

- `DEPLOYMENT_URL` — the production URL, no trailing slash
- `CRON_SECRET` — the same value as the Vercel environment variable

## Notes from building this

Things that were true in practice and not obvious up front:

- **Most releases are filler.** "Bug Fixes and Improvements" is a real, current
  release note. The prompt is written to make *low signal* a comfortable answer,
  because a prompt that inflates every bugfix into a strategic threat produces a
  dashboard nobody reads.
- **Gemini's free tier is per-model per-day** and small. The engine ranks
  available models, tries them in order, and degrades on quota exhaustion —
  which happened on the very first live run. Events record which model answered.
- **Vercel Hobby caps cron at once per day**, hence the GitHub Actions companion.
- **iTunes lookup accepts 200 ids per request.** That's the difference between
  refreshing 10,000 apps in 50 requests and doing it in 10,000.
- **Community reaction was a dead end.** Hacker News had near-zero relevant
  discussion (Stripe's only hit was a 2-point story about a dashboard outage),
  and App Store reviews mention an actual update in roughly 1 of 50. The section
  was removed rather than padded with content that read as insight and wasn't.
- **Newer Supabase projects don't auto-grant** table privileges to `service_role`
  for tables created in the SQL editor; without explicit `GRANT`s every request
  returns `42501`.

## Licence

MIT

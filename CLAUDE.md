@AGENTS.md

# The Virtual Mechanic

Premium dashboard for tracking bike component wear and performance loss.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS v4 + shadcn/ui (`components/ui`, base color `neutral`, style `base-nova`)
- Supabase (`@supabase/supabase-js`) — client at `lib/supabase.ts`
- Deployed on Vercel

## Commands

- `npm run dev` — start the dev server
- `npm run build` — production build (also type-checks)
- `npm run lint` — ESLint
- `npx tsc --noEmit` — type-check only
- `npm run seed` — idempotent dev seed (see below)

## Project structure

No `src/` directory — routes live in `app/`, shared code in `lib/`, UI primitives in
`components/ui` (managed by the shadcn CLI, don't hand-edit unless necessary), other
shared components in `components/`. Path alias `@/*` maps to the project root.

## Environment variables

Copy `.env.local.example` to `.env.local` and fill in the real values:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project.
- `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` — dev-only test user (see below). Server-only,
  never prefix these with `NEXT_PUBLIC_`.
- `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` — from a Strava API app
  (strava.com/settings/api). `getStravaRedirectUri` (`lib/strava.ts`) derives the
  `redirect_uri` from the incoming request, so the OAuth routes work unchanged on
  localhost and in production — but Strava's Authorization Callback Domain field only
  holds one domain at a time, so it has to be flipped between `localhost` and the
  production domain depending on which one you're exercising.

## Supabase schema

Tables: `profiles` (id references `auth.users`; also holds `strava_athlete_id` /
`strava_access_token` / `strava_refresh_token` / `strava_expires_at`), `bikes`
(`profile_id` FK), `components` (`bike_id` FK; `type` is `'chain' | 'cassette' |
'chainring' | ...` — reused rather than adding a redundant column when the drivetrain
cascade was built; `brand`/`tier` hold e.g. `'Shimano'`/`'Ultegra'`), `activities`
(`profile_id` FK; `id` is `text` — either a real Strava activity id or the seed script's
synthetic one), `wear_logs` (`component_id` FK, not wired into the UI or the sync flow yet
— `components.current_wear_percentage` is the only wear number that actually updates
today). RLS is enabled and ownership-scoped
(`auth.uid() = profile_id`/`id`, or via a `bikes`/`components` join) on all of them —
SELECT and INSERT everywhere, plus UPDATE on `profiles` and `components` and DELETE on
`activities` (needed for the Strava token exchange and the sync route's wear updates).
There is no public/anon read or write access. No generated types yet — if the schema
stabilizes, generate them with `supabase gen types typescript` and type the client instead
of guessing column shapes.

Every one of those non-SELECT/INSERT policies got added reactively, mid-implementation,
because the default (RLS on, no policy for that command) fails *silently* — the write
matches zero rows instead of erroring. If a new write starts mysteriously not sticking,
check for a missing policy before anything else; `app/api/strava/sync/route.ts` shows the
pattern for surfacing that as a visible error instead of a silent no-op.

### No login yet (pre-Auth.js)

There's no Auth.js session wired up, but RLS requires an authenticated `auth.uid()` for
every read and write. Until real login exists, `scripts/seed.ts` and every server-side
Supabase read/write (`lib/dashboard-data.ts`, the `app/api/**/route.ts` handlers) sign in
as one dev test user (`SEED_USER_EMAIL`/`SEED_USER_PASSWORD`) to satisfy RLS.
`lib/supabase-server.ts` holds the single shared, `server-only` singleton that does this —
**always import `getAuthenticatedSupabaseClient` from there** rather than calling
`signInWithPassword` again; every extra sign-in call eats into Supabase Auth's rate limit
(we hit it once already — see git history). Replace that whole file with the real user's
session as soon as Auth.js lands, and delete `scripts/seed.ts`'s reliance on the same
credentials at that point too.

### Seeding dev data

`npm run seed` (`scripts/seed.ts`) signs in as the dev test user and, only if missing,
inserts: their `profiles` row, a "Scott Addict 30" bike, the full Shimano Ultegra
drivetrain triangle (chain `max_km: 3000`, cassette `7500`, chainring `18000`; the chain
starts at `current_wear_percentage: 35`, the other two lower), and one activity in Palma
de Mallorca. It's safe to re-run — every insert is guarded by an existence check first,
matching the pattern the Strava sync route also uses for `activities`.

### Strava OAuth

- `GET /api/strava/connect` — redirects to Strava's authorize URL (`lib/strava.ts`).
- `GET /api/auth/strava/callback` — exchanges the returned `code` for tokens and saves
  them on the dev test user's `profiles` row, then redirects to `/`. On any failure it
  redirects to `/?strava_error=<code>` instead of pretending it worked — see
  `stravaErrorMessages` in `app/page.tsx` for the human-readable copy per code.
- `POST /api/strava/sync` — refreshes the access token if it's expired, pulls the
  athlete's recent activities, and inserts the latest ride into `activities` if it isn't
  there yet. Only for a genuinely new activity (the `!existing` branch) it also:
  - Fetches real weather for the ride's start coordinates + time window from Open-Meteo
    (`lib/open-meteo.ts` — forecast endpoint for the last 5 days, archive endpoint
    further back) and derives `watts_lost` from humidity/rain with the heuristic in
    `lib/wear-model.ts` (`estimateWattsLost`). No GPS on the activity → falls back to a
    neutral placeholder (50% humidity, 0mm rain) rather than failing the sync.
  - Applies the ride's distance to the whole drivetrain triangle via
    `applyRideToDrivetrain` (`lib/wear-model.ts`) — this is what moves the component wear
    cards on the Dashboard. See "Drivetrain wear cascade" below.
  - Both steps are skipped when the activity already exists, so re-clicking "Sincronizar
    rutas" never double-counts wear or re-derives weather for the same ride.
- The Dashboard header shows "Conectar Strava" or "Sincronizar rutas" depending on
  whether `profiles.strava_athlete_id` is set (`getProfile()` in `lib/dashboard-data.ts`).

### Drivetrain wear cascade

`lib/wear-model.ts` models the chain, cassette, and chainring as one system rather than
three independent odometers — all pure functions, no I/O, easy to unit-test in isolation:

- `getWeatherWearMultiplier` — only the chain's own wear rate is weather-multiplied (it's
  the part directly exposed to road spray/grit); 1.0 at ≤50% humidity and no rain.
- `getCassetteCascadeMultiplier` / `getChainringCascadeMultiplier` — a chain that's
  already stretched rides high on the other two's teeth. Both read the chain's
  **pre-ride** `current_wear_percentage` (never the value after this ride's own delta is
  applied) — cassette gets ×1.5 past 60% chain wear, ×2.5 past 85%; chainring gets ×1.3
  past 75%, nothing below that.
- `getEffectiveMaxKm` — only the cassette has a tier modifier today (Dura-Ace/SRAM Red
  0.9×, Ultegra/Force 1.0×, 105/Rival 1.1× — lighter titanium wears faster than steel).
  Chain and chainring pass through their stored `max_km` unchanged regardless of tier.
- `applyRideToDrivetrain` — the entry point the sync route calls: takes every component on
  the bike plus the ride's distance and weather, reads the chain's pre-ride wear once, and
  returns the new `current_wear_percentage` for all of them together.

### Wear status UI (app/page.tsx)

Four states, computed from `current_wear_percentage` alone by `wearStatus()`: `optimal`
(<60%), `warning` (60–85%), `critical` (85–100%), `exhausted` (≥100%). `critical` and
`exhausted` share the oxblood `--status-critical` token — the escalation is via weight
(bold, larger % text) and fill (outline "Agendar cambio" badge vs. solid inverted "Pieza
agotada" badge), not a new hue, to stay inside the validated editorial palette. Copy per
state/component type lives in `getWearMessage()` — the chain's `warning` message is the
only one that differs by component type (it names the cascade effect on the cassette).
`WorkshopAlertsBanner` re-fetches the same `getPrimaryBike()` call (deduped by
`React.cache`, no extra query) and renders nothing (`Suspense fallback={null}`, not a
skeleton) unless at least one component is `critical`/`exhausted` — avoids a
flash-then-vanish loading state for a banner that usually shouldn't appear at all.

### Route dynamic rendering

`app/page.tsx` exports `dynamic = "force-dynamic"` because it reads live Supabase data —
without it Next prerenders the dashboard at build time and the wear percentages would be
frozen from whenever `next build` last ran.

## Code style

- Functional components, no class components.
- Server Components by default; add `"use client"` only where interactivity/state is
  needed (e.g. the sidebar toggle in `components/dashboard-shell.tsx`). Prefer a plain
  `<form action="...">` POSTing to a Route Handler over a client component + `fetch` when
  a native form covers it (see the "Sincronizar rutas" button).
- Compose UI from `components/ui` primitives rather than raw HTML where one exists.
- Tailwind utility classes only — no CSS modules, no styled-components.
- Design tokens (`--brand`, `--status-good`, `--status-warning`, `--status-critical`)
  live in `app/globals.css` alongside the shadcn theme variables; reuse them instead of
  hardcoding hex colors so the light, Rapha/Pas Normal Studios-inspired editorial look
  stays consistent.

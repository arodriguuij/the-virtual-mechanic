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
cascade was built; `brand`/`tier` hold e.g. `'Shimano'`/`'Ultegra'`; `status_type` is
`'estimated' | 'certified'` — text with a `CHECK` constraint, unlike every other free-text
column here, because it drives user-facing trust messaging directly and a typo would
silently break the badge instead of erroring), `activities`
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
drivetrain triangle (chain `max_km: 3000`, cassette `7500`, chainring `18000`), its disc
brakes (`disc_pad max_km: 2500`, `disc_rotor max_km: 12000`), and its Schwalbe Pro One TLE
tires (`max_km: 4500` each; rear seeded more worn — `40` vs. front's `15` — matching the
extra load/torque it carries) — all `current_wear_percentage` seeded low except the chain
(`35`) and rear tire (`40`) — and one activity in Palma de Mallorca. It's safe to re-run —
every insert is guarded by an existence check first, matching the pattern the Strava sync
route also uses for `activities`.

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
  - Applies the ride's distance to every wearable component via `applyRideToComponents`
    (`lib/wear-model.ts`) — this is what moves the component wear cards on the Dashboard.
    See "Component wear model" below.
  - Both steps are skipped when the activity already exists, so re-clicking "Sincronizar
    rutas" never double-counts wear or re-derives weather for the same ride.
- The Dashboard header shows "Conectar Strava" or "Sincronizar rutas" depending on
  whether `profiles.strava_athlete_id` is set (`getProfile()` in `lib/dashboard-data.ts`).

### Component wear model

`lib/wear-model.ts` models every wearable part on the bike as one system rather than
independent odometers — all pure functions, no I/O, easy to unit-test in isolation. The
entry point is `applyRideToComponents(components, { km, elevationGainM, weather })`,
called from the sync route; `component.type` picks the rule:

**Drivetrain triangle** (chain / cassette / chainring):
- `getWeatherWearMultiplier` — only the chain's own wear rate is weather-multiplied (it's
  the part directly exposed to road spray/grit); 1.0 at ≤50% humidity and no rain.
- `getCassetteCascadeMultiplier` / `getChainringCascadeMultiplier` — a chain that's
  already stretched rides high on the other two's teeth. Both read the chain's
  **pre-ride** `current_wear_percentage` (never the value after this ride's own delta is
  applied) — cassette gets ×1.5 past 60% chain wear, ×2.5 past 85%; chainring gets ×1.3
  past 75%, nothing below that.
- `getEffectiveMaxKm` — only the cassette has a tier modifier today (Dura-Ace/SRAM Red
  0.9×, Ultegra/Force 1.0×, 105/Rival 1.1× — lighter titanium wears faster than steel).
  Everything else passes through its stored `max_km` unchanged regardless of tier.

**Braking module** (disc or rim — `type` drives which rule applies, no cascade between
them, each reacts directly to this ride's own weather/elevation):
- `getDiscPadRainMultiplier` — ×3.5 if `rain_mm > 0` (wet grit turns into a grinding paste
  on resin pads).
- `getDiscRotorThermalMultiplier` — ×1.8 if the ride's elevation gain exceeds 1,000 m
  (sustained braking heat on long descents).
- `getRimPadRainMultiplier` / `getWheelRimRainMultiplier` — ×4.0 / ×2.5 if it rained (rim
  brakes have no thermal mass to shed water, and the wet pad sands the braking track).
  `rim_pad`/`wheel_rim` aren't seeded on the Addict 30 (disc brakes) — modeled anyway so a
  future rim-brake bike is a data change (`scripts/seed.ts`), not a code change.

**Tires** (`tire_front` / `tire_rear` — flat multiplier, no weather/cascade input):
- `REAR_TIRE_TRACTION_MULTIPLIER` (×1.3) — the rear tire carries 60–65% of the rider's
  weight plus all of the drivetrain's torque, so it wears faster than the front on every
  ride regardless of conditions. The front tire is the baseline (×1).

### Wear status UI (app/page.tsx)

Four states, computed by `wearStatus(pct, componentType?)`: `optimal` (<60%), `warning`
(60%–critical threshold), `critical` (critical threshold–100%), `exhausted` (≥100%). The
critical threshold is 85% by default but 80% for `tire_front`/`tire_rear`
(`CRITICAL_THRESHOLD_OVERRIDES`) — a thin tire is a puncture/blowout risk before it's
"used up" the way a chain or rotor is, so **always pass `component.type`** to
`wearStatus()`/`getWearMessage()`; omitting it silently falls back to the 85% default and
tires won't flag early. `critical` and `exhausted` share the oxblood `--status-critical`
token — the escalation is via weight (bold, larger % text) and fill (outline "Agendar
cambio" badge vs. solid inverted "Pieza agotada"/"¡Peligro de reventón!" badge), not a new
hue, to stay inside the validated editorial palette. Copy lives in `getWearMessage(status,
componentType, wearPercentage)`: the chain's `warning` message is the only non-tire one
that differs by component type (names the cascade effect on the cassette); tires ignore
`status` granularity above the critical threshold and branch on the raw `wearPercentage`
instead, since "critical" alone can't distinguish the 80–90% ("alto") / 90–99% ("muy
alto") / ≥100% ("reventón") puncture-risk copy.
`WorkshopAlertsBanner` re-fetches the same `getPrimaryBike()` call (deduped by
`React.cache`, no extra query) and renders nothing (`Suspense fallback={null}`, not a
skeleton) unless at least one component is `critical`/`exhausted` — avoids a
flash-then-vanish loading state for a banner that usually shouldn't appear at all.

### Calibration system ("Cold Start Problem")

We can't assume a new user's components start at 0% wear, and manually-entered mileage
can't claim the same precision as a real Strava-synced ride (we don't know if that
mileage was ridden in the rain, or whether a "new" cassette had already absorbed wear from
a previous chain). `components.status_type` tracks that distinction everywhere a wear
number is shown:

- **`estimated`** (default) — legacy/seeded data or anything the user entered by hand.
  Dashboard cards show a neutral "Calibrando" badge (`statusTypeMeta.estimated` in
  `app/page.tsx`) with an always-visible explanation line (not hover-only — a `title`
  attribute alone would be invisible on mobile and unreliable for a11y) plus a native
  `title` as a free desktop-hover bonus.
- **`certified`** — set the moment a user calibrates a component as genuinely new (0 km).
  From that point every ride synced through `applyRideToComponents` is a real physical
  simulation. Badge reuses `--status-good` (olive) rather than introducing a new "premium"
  hue, same restraint as the rest of the palette.

`components/calibration-dialog.tsx` (`"use client"`) is the only client-side piece — a
Dialog (shadcn, `@base-ui/react/dialog`) with a method radio group that adapts to
component type:

- **Any component**: "Es una pieza nueva (0 km)" → `current_wear_percentage = 0`,
  `status_type = 'certified'`. "Introducir kilómetros estimados" → linear
  `km / effectiveMaxKm * 100` (via `getEffectiveMaxKm`, the same tier-aware helper the ride
  sync uses), `status_type = 'estimated'`.
- **Chain only**: a third method, "Tengo un medidor de desgaste físico" — a wear-indicator
  gauge that only reads three fixed points, `0.5` / `0.75` / `1.0`, so the result is fixed
  at exactly 50%, 75%, or 100% wear (not a linear calculation), `status_type = 'estimated'`.
  `1.0` ("cadena totalmente estirada") pins wear at exactly 100 — no new Dashboard logic
  needed for that to flip the card to `exhausted` and pull it into the workshop banner;
  `wearStatus`/`WorkshopAlertsBanner` already react to any component crossing 100%,
  calibration or ride sync alike. The dialog shows an inline danger warning the moment
  `1.0` is selected, before the form is even submitted.

The form POSTs (plain HTML `<form>`, no client fetch — same progressive-enhancement
pattern as "Sincronizar rutas") to `POST /api/components/calibrate`, which re-fetches the
component server-side for its `type`/`tier`/`max_km`, computes the new wear percentage,
and redirects to `/?calibration_error=<code>` on any failure (missing/invalid fields, RLS
blocking the UPDATE, or a `gauge` method requested for a non-chain component) instead of
pretending it worked — see `calibrationErrorMessages` in `app/page.tsx`.

### Ride history lookbook (app/page.tsx)

`getRecentActivities(limit)` (`lib/dashboard-data.ts`) replaced the old single-activity
`getLatestActivity()` — `RideHistorySection` calls it with `limit: 8` to render the
editorial list below the drivetrain grid (numbered rows, hairline dividers, no per-row
card chrome — deliberately not another grid of boxes), and `WattsTaxCard` calls it with
the *same* `8` and just reads `activities[0]`. Same argument value → same `React.cache`
entry → one Supabase query serves both, same dedup trick as `getPrimaryBike()` elsewhere
on this page. If you add a component that needs a different number of rows, it gets its
own query — keep call sites that can share data calling with identical arguments.

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

@AGENTS.md

# Motor Metabólico

Nutrition and physiology planner for cyclists — turns FTP, weight, and self-reported sweat
rate plus real ride/weather data from Strava and Open-Meteo into a fueling and recovery
plan. Pivoted from an earlier bike-component-wear tracker of the same codebase (see git
history — the Strava/Open-Meteo/Supabase-Auth infrastructure survived the pivot, the
mechanical wear domain didn't).

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
`strava_access_token` / `strava_refresh_token` / `strava_expires_at` — the Strava
connection itself, independent of the athlete's physiological data), `athlete_profiles`
(id references `auth.users`; `ftp` integer watts; `weight_kg` numeric; `sweat_rate` —
`'low' | 'medium' | 'high'`, a `CHECK`-constrained self-reported category rather than a
real sweat-test value — see "Metabolic engine" below for how each field is used),
`activities` (`profile_id` FK; `id` is `text` — either a real Strava activity id or the
seed script's synthetic one; `average_watts`/`rain_mm`/`humidity_avg`/`temperature_avg`
capture the ride's own conditions; `carbs_burned_g`/`fluid_loss_ml`/`sodium_loss_mg` are
computed once at sync time from those plus the athlete's profile — `null` on rides synced
before an FTP was set, since carb oxidation can't be estimated without one). RLS is
enabled and ownership-scoped (`auth.uid() = profile_id`/`id`) on all of them — SELECT,
INSERT, and UPDATE on `profiles` and `athlete_profiles`, SELECT and INSERT on
`activities`, plus DELETE on `activities` (needed for the Strava token exchange and retry
flows). There is no public/anon read or write access. No generated types yet — if the
schema stabilizes, generate them with `supabase gen types typescript` and type the client
instead of guessing column shapes.

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
inserts: their `profiles` row, an `athlete_profiles` row (FTP 250W, 72kg, medium sweat
rate — a plausible amateur-racer fixture, not this specific user's real numbers), and one
activity ("Serra de Tramuntana Loop") with hand-computed nutrition figures matching
`lib/metabolic-engine.ts`'s formulas for that ride's watts/humidity/temperature. It's safe
to re-run — every insert is guarded by an existence check first, matching the pattern the
Strava sync route also uses for `activities`.

### Strava OAuth

- `GET /api/strava/connect` — redirects to Strava's authorize URL (`lib/strava.ts`).
- `GET /api/auth/strava/callback` — exchanges the returned `code` for tokens and saves
  them on the dev test user's `profiles` row, then redirects to `/`. On any failure it
  redirects to `/?strava_error=<code>` instead of pretending it worked — see
  `stravaErrorMessages` in `app/page.tsx` for the human-readable copy per code.
  Also does a best-effort, zero-friction weight sync: fetches `/athlete` (`fetchAthlete()`
  in `lib/strava.ts`) and upserts its `weight` (kg) into `athlete_profiles.weight_kg` —
  `UPDATE` if the athlete already has a profile row (never overwrites their own `ftp`/
  `sweat_rate`), otherwise `INSERT`s a fresh row with placeholder `ftp: 200` /
  `sweat_rate: 'medium'` (Strava has no concept of either) so the row satisfies the
  table's `NOT NULL` columns until the athlete edits their real numbers via the
  Physiological Profile form. A failure here is logged but never undoes an otherwise-
  successful Strava connection.
- `POST /api/strava/sync` — refreshes the access token if it's expired (via
  `getValidStravaAccessToken()` in `lib/strava-session.ts`, shared with the routes
  listing below so the refresh-and-persist dance lives in one place), pulls the
  athlete's latest cycling activity, and inserts it into `activities` if it isn't there
  yet. Only for a genuinely new activity (the `!existing` branch) it also:
  - Samples real weather along the ride's actual route from Open-Meteo (see "Geographic
    microclimate sampling" below) for humidity/temperature/rain — indoor rides skip this
    entirely and use a fixed warm-room assumption instead (26°C / 60% humidity — trainer
    rooms run hotter and more humid than outdoors since there's no airflow cooling).
  - Reads the athlete's `ftp`/`sweat_rate` from `athlete_profiles` and, if an FTP is set
    and the ride has `average_watts`, computes `carbs_burned_g`/`fluid_loss_ml`/
    `sodium_loss_mg` via `lib/metabolic-engine.ts` and stores them on the activity row —
    see "Metabolic engine" below for the formulas. No FTP yet → the ride is still logged,
    just without nutrition figures (`null`), same "log now, compute what you can" pattern
    as the old wear model's neutral-placeholder fallback.
  - Skipped entirely when the activity already exists, so re-clicking "Sincronizar rutas"
    never double-counts nutrition cost or re-derives weather for the same ride.
- The Dashboard header shows "Conectar Strava" or "Sincronizar rutas" depending on
  whether `profiles.strava_athlete_id` is set (`getProfile()` in `lib/dashboard-data.ts`).

#### Geographic microclimate sampling

A single start-coordinate weather lookup can completely miss a localized storm the rider
actually rode through further down the route, or over-represent a big ride's weather from
one point. `lib/strava.ts` and `lib/open-meteo.ts` sample the ride's *actual path*
instead:

- `decodePolyline()` (`lib/strava.ts`) decodes the activity's `map.summary_polyline`
  (Strava/Google's standard polyline encoding) into `[lat, lng]` pairs — pure geometry
  decode, no I/O.
- `getSamplePointCount(distanceKm)` picks a dynamic control-point count instead of a fixed
  one: one point per 25km, clamped to `[3, 8]` — enough coverage on a long ride to catch a
  storm cell (or a hot valley climb) without hammering Open-Meteo, a minimum of 3 on a
  short one.
- `getRouteSamplePoints()` picks that many coordinates evenly spaced across the decoded
  polyline (always including the first and last point) and assigns each an estimated
  pass-through time via linear interpolation across `moving_time` — point `i` of `n` lands
  at `start_date + moving_time * i / (n - 1)`, same fraction driving both the geographic and
  temporal spacing.
- `getWeatherForRoute()` (`lib/open-meteo.ts`) queries Open-Meteo for all of those points
  in parallel (`Promise.all`, one request per point, each its own single-hour lookup at
  that point's estimated time — forecast endpoint for the last 5 days, archive endpoint
  further back), then aggregates: `humidityAvg`/`temperatureAvgC` are the mean across
  points (both feed the fluid/sodium loss estimate below), `rainMm` is the *max* reading
  across points but only kept if it's above `WET_THRESHOLD_MM` (0.1mm — sub-threshold
  readings are treated as measurement noise), otherwise `rainMm` is `0`.
- Any point request that fails (network hiccup, no data for that hour) is dropped rather
  than failing the whole sync — `getWeatherForRoute` only returns `null` if *every* point
  came back empty, matching the existing "fall back to a neutral placeholder" convention.

### Metabolic engine

`lib/metabolic-engine.ts` turns physiological inputs into a fueling plan — all pure
functions, no I/O, safe to import from both server components (the Dashboard cards) and
client components (`FuelingCalculator`'s live recompute on every duration/intensity
change). Heuristic and documented as such throughout, grounded in mainstream
sports-nutrition guidance rather than a clinical or individually-calibrated model:

- **`getCarbOxidationRateGPerHour(relativeIntensity)`** — carb burn rate (g/h) banded by
  %FTP: 30g/h below 50% FTP up to a 100g/h practical gut-absorption ceiling at/above 110%
  FTP. `relativeIntensity` comes from either `getRelativeIntensityFromLevel(level)` (the
  pre-ride planner's assumed %FTP per named intensity — recovery 55%, endurance 70%, tempo
  85%, threshold 98%, vo2max 115%) or `getRelativeIntensity(averageWatts, ftp)` (real data,
  used for the post-ride Recovery card).
- **`getFluidLossMlPerHour(sweatRate, temperatureC, humidityPct)`** — a baseline ml/h by
  sweat-rate category (low 500 / medium 750 / high 1000, at a comfortable ~18°C/50%
  humidity) scaled up by `getHeatHumidityMultiplier` (+2%/°C above 18°C, +0.4%/point of
  humidity above 50%). `getSodiumLossMgPerHour` multiplies that fluid volume by a flat
  700mg/L average sweat-sodium concentration.
- **`getHomeLabRecipe()`** — the "Receta de Laboratorio Casero": splits the ride's total
  carb target into a 1:0.8 maltodextrin:fructose mix by weight (the standard
  2:1-equivalent glucose:fructose ratio that raises the gut's total absorption ceiling
  above what either sugar alone achieves), plus the sodium and water targets for the same
  duration — one bottle recipe covering both carbs and hydration.
- **`getMoneySavedVsGels(totalCarbsG)`** — compares a flat €2.50/30g-of-carbs commercial
  gel price against a €0.35/30g homemade equivalent — a rough illustrative comparison, not
  a live price feed.
- **`getGlycogenBurnedGrams(relativeIntensity, movingTimeSeconds)`** — the oxidation rate
  integrated over the ride's actual duration; this is what the sync route stores as
  `activities.carbs_burned_g`.
- **`getPostRideRecoveryTarget(weightKg)`** — standard post-exercise window guidance:
  ~1.1g carbs/kg and ~0.3g protein/kg to kickstart glycogen resynthesis and muscle repair.
- **`estimateRideDurationHours({ distanceKm, elevationGainM, ftp, weightKg, intensity })`**
  — sizes the fueling window for a saved Strava route, which has no real moving-time of
  its own. A simplified two-term heuristic, not a physical simulation: a flat-road speed
  estimated from W/kg (~22km/h at 2.5 W/kg, +5km/h per extra W/kg) plus a
  Naismith's-rule-style climbing time bonus from an estimated VAM (~700 vertical m/h at
  2.5 W/kg, scaling with W/kg) — `flatTimeHours + climbTimeHours`, both clamped to
  plausible ranges.

### Fueling planner ("Paso 1")

The planner is the friction-zero pre-ride tool: pick a saved Strava route (or use the
quick manual calculator), pick a departure date/time, and get back the exact DIY bottle
recipe for that specific ride's real forecast conditions.

- **`lib/strava-routes.ts`** — `fetchAthleteRoutes(accessToken)` lists the athlete's
  saved/starred routes from `/athlete/routes`, filtered to `type === 1` (ride, not run)
  and mapped to `{ id, name, distanceKm, elevationGainM, startLat, startLng }` — the start
  coordinates come from decoding the route's own `map.summary_polyline` (reusing
  `decodePolyline()` from `lib/strava.ts`) rather than a second API call. Returns `[]`
  (never throws) on any Strava API failure, so a hiccup here just leaves the planner in
  its manual quick-calculator mode instead of breaking the Dashboard.
- **`getStravaRoutes()`** (`lib/dashboard-data.ts`) — the cached, auth-aware wrapper
  `FuelingPlannerSection` calls: resolves a valid access token via
  `getValidStravaAccessToken()` and returns `[]` outright if Strava isn't connected.
- **`getWeatherForDeparture(lat, lng, departureIso, durationHours)`** (`lib/open-meteo.ts`)
  — always the forecast endpoint (never archive, since a planned departure is always in
  the future); averages `temperature_2m`/`relative_humidity_2m` across the exact hour
  blocks the ride will be *in progress* — a ride leaving 08:00 and lasting 3h averages the
  08:00/09:00/10:00 readings, not the 11:00 arrival hour (`hourDate >= start && hourDate <
  end`, half-open interval).
- **`POST /api/fueling/plan`** — the compute endpoint the planner's "Calcular estrategia"
  button calls via `fetch` (a JSON API, not a form-POST-redirect, since this is a
  read/compute operation whose result should render in place rather than trigger a
  navigation — the one deliberate departure from this codebase's usual
  progressive-enhancement form convention). Body is either route mode
  (`{ mode: "route", distanceKm, elevationGainM, startLat, startLng, intensity,
  departureIso }`, using `estimateRideDurationHours()` for the duration and a named
  intensity level for the target %FTP) or quick mode (`{ mode: "quick", durationHours,
  averageWatts, departureIso }`, using the real watts directly via
  `getRelativeIntensity()`). Dynamic weather is only sampled in route mode (needs start
  coordinates); quick mode always uses the fixed "typical training day" planning default
  (22°C/55% humidity). Re-fetches `ftp`/`weight_kg`/`sweat_rate` from `athlete_profiles`
  server-side rather than trusting client-supplied values.
- **`components/fueling-planner.tsx`** (`"use client"`) — the interactive planner UI:
  a route/quick mode toggle, a route `<select>` (built from the routes passed down as
  props) or duration+watts inputs, a `datetime-local` departure input (defaults to
  tomorrow 08:00 via `defaultDepartureLocal()`), and a result panel rendering whatever
  `/api/fueling/plan` returns — carb/sodium targets, the DIY recipe, and the money-saved
  comparison, plus which weather source was used (`dynamic` vs `planning_default`).

### Athlete profile

**`app/api/athlete-profile/update`** — the plain-form-POST route behind the
Physiological Profile card's inline edit form (weight/FTP/sweat rate, all in one Card,
no separate view/edit toggle). Uses `.upsert({ id: userId, ... })` rather than a
select-then-update/insert branch, since `athlete_profiles.id` is the primary key and
Supabase's upsert already handles "create if missing, update if present" in one call.
Redirects to `/?profile_error=<code>` on invalid input or an RLS block, same
non-silent-failure convention as everywhere else.

### Dashboard (app/page.tsx)

- **`PhysiologicalProfileCard`** — reads `getAthleteProfile()` and renders an inline
  edit form (weight/FTP/sweat rate, pre-filled with current values) POSTing to
  `/api/athlete-profile/update` — see "Athlete profile" above.
- **`FuelingPlannerSection`** — fetches the athlete profile and `getStravaRoutes()`,
  handing the route list to the client `FuelingPlanner` (see "Fueling planner" above).
  Shows a "configure your profile first" prompt instead if there's no `athlete_profiles`
  row yet, since the plan endpoint requires one.
- **`RecoveryCard`** — reads the most recent synced activity (`getRecentActivities(8)`,
  same `React.cache` dedup trick as `RideHistorySection` calling with the same `limit`)
  and shows its stored `carbs_burned_g`/`fluid_loss_ml`/`sodium_loss_mg` plus the athlete's
  post-ride recovery target. Falls back to a prompt to set up an FTP if the latest ride
  has no nutrition figures attached (synced before `athlete_profiles` existed, or before
  FTP was set).
- **`RideHistorySection`** — the ride lookbook (numbered rows, hairline dividers, no
  per-row card chrome), each row showing distance, a humidity/rain weather label, and
  carbs burned when available.

### Route dynamic rendering

`app/page.tsx` exports `dynamic = "force-dynamic"` because it reads live Supabase data —
without it Next prerenders the dashboard at build time and the figures would be frozen
from whenever `next build` last ran.

## Code style

- Functional components, no class components.
- Server Components by default; add `"use client"` only where interactivity/state is
  needed (e.g. the sidebar toggle in `components/dashboard-shell.tsx`, the fueling
  planner's route/quick-mode inputs). Prefer a plain `<form action="...">` POSTing to a
  Route Handler over a client component + `fetch` when a native form covers it (see the
  "Sincronizar rutas" button and the Physiological Profile edit form) — reserve the
  `fetch`-based pattern for read/compute operations like `/api/fueling/plan` that should
  render a result in place rather than trigger a navigation.
- Compose UI from `components/ui` primitives rather than raw HTML where one exists.
- Tailwind utility classes only — no CSS modules, no styled-components.
- Design tokens (`--brand`, `--status-good`, `--status-warning`, `--status-critical`)
  live in `app/globals.css` alongside the shadcn theme variables; reuse them instead of
  hardcoding hex colors so the light, Rapha/Pas Normal Studios-inspired editorial look
  stays consistent.

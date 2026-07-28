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
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, never prefix with `NEXT_PUBLIC_`, never
  import outside `lib/supabase-admin.ts`. Bypasses RLS entirely; its only legitimate use
  in this app is the Strava→Supabase auth bridge (see "Real auth" below) — Strava isn't a
  supported Supabase OAuth provider, so establishing a real session for a Strava login
  requires the Admin API. Find it at Supabase Dashboard → Project Settings → API →
  Project API keys → `service_role` `secret`.
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
`'low' | 'medium' | 'high'`; `gut_training_level` — `'beginner' | 'intermediate' |
'advanced' | 'pro'`; `athlete_type` — `'diesel' | 'balanced' | 'explosive'`, a simplified
VLaMax-style metabolic phenotype — all three `CHECK`-constrained self-reported categories
rather than real sweat-test/gut-test/lactate-curve values, `gut_training_level`/
`athlete_type` each defaulting (`'intermediate'`/`'balanced'`) so the columns could be
added `NOT NULL` without a separate backfill step; `bottle_count` — `1 | 2`, the athlete's
real number of bottle cages; `bottle_capacity_ml` — `500 | 600 | 750 | 950`, their real
per-bottle capacity, both defaulting (`2`/`750`) for the same reason; `is_salty_sweater` —
boolean, defaulting `false`, self-reported ("cercos blancos en el maillot / escozor en los
ojos") rather than a real sweat-test value, same convention as the other self-reported
categories above — see "Metabolic engine", "Gut Training Scale", "Metabolic phenotype", and
"Bottle architecture & osmolarity control" below for how each field is used), `activities`
(`profile_id` FK; `id` is `text` — either a real Strava activity id or the seed script's
synthetic one; `average_watts`/`rain_mm`/`humidity_avg`/`temperature_avg` capture the
ride's own conditions; `carbs_burned_g`/`fluid_loss_ml`/`sodium_loss_mg` are computed once
at sync time from those plus the athlete's profile — `null` on rides synced before an FTP
was set, since carb oxidation can't be estimated without one), `fueling_logs` (`profile_id`
FK; `kind` — `'pre_ride' | 'post_ride'`; `activity_id` nullable FK to `activities`, only
set for `post_ride` rows; `total_carbs_g`/`fluid_ml`/`sodium_mg` — the raw
physiological burn/loss figures at log time, see "Weekly Performance Panel" below;
`carbs_consumed_g`/`fluid_consumed_ml`/`sodium_consumed_mg` — nullable, populated later by
`POST /api/post-ride/consumption` once the athlete fills in what they actually ate/drank
during that specific ride, see "Weekly Performance Panel" below for what this unlocks).
RLS is enabled and ownership-scoped (`auth.uid() = profile_id`/`id`) on all of them —
SELECT, INSERT, and UPDATE on `profiles` and `athlete_profiles`, SELECT and INSERT on
`activities` and `fueling_logs`, plus DELETE on `activities` (needed for the Strava token
exchange and retry flows) and, since real auth landed, **UPDATE on `fueling_logs`** too
(added specifically for the consumption-save flow above). There is no public/anon read or
write access. No generated types yet — if the schema stabilizes, generate them with
`supabase gen types typescript` and type the client instead of guessing column shapes.

Every one of those non-SELECT/INSERT policies got added reactively, mid-implementation,
because the default (RLS on, no policy for that command) fails *silently* — the write
matches zero rows instead of erroring. If a new write starts mysteriously not sticking,
check for a missing policy before anything else; `app/api/strava/sync/route.ts` shows the
pattern for surfacing that as a visible error instead of a silent no-op.

### Real auth: Strava-exclusive login via a Supabase Admin API bridge

Real per-user auth landed — every page and API route now runs as whoever is actually
signed in, not a single hardcoded dev user. Strava is deliberately the *only* login
method (no email/password form of this app's own), which creates one hard technical
constraint worth understanding before touching any of this: **Strava is not a supported
Supabase Auth OAuth provider** (Supabase's provider list is a fixed enum — Google,
GitHub, Discord, etc. — and Strava isn't on it), and it also isn't bridgeable as a
generic custom OIDC provider either, since Strava's OAuth implementation predates and
never adopted OpenID Connect (no signed `id_token`, no discovery document). So
`supabase.auth.signInWithOAuth({ provider: 'strava' })` — the obvious first thing to
reach for — simply cannot work. Instead:

- **`app/api/strava/connect`** and **`app/api/auth/strava/callback`** still run Strava's
  *own* OAuth handshake exactly as before real auth existed (unchanged: exchange the code
  for Strava tokens, fetch the athlete's profile). The callback then bridges that into a
  real Supabase Auth session server-side, using the **Admin API** (`lib/supabase-admin.ts`
  — `getSupabaseAdminClient()`, a `service_role`-keyed client that bypasses RLS entirely,
  gated behind `SUPABASE_SERVICE_ROLE_KEY` and never imported outside this one callback):
  1. `admin.auth.admin.generateLink({ type: 'magiclink', email })` — Supabase's Admin API
     docs note this call "handles the creation of the user for `signup`, `invite` and
     `magiclink`," so a single call both provisions a brand-new Supabase Auth user *and*
     locates an already-existing one, keyed by `email`.
  2. **The `email` used is not always the synthetic placeholder.** Before generating the
     link, the callback checks whether a `profiles` row already exists for this exact
     Strava `athlete_id` (via the admin client, bypassing RLS) — if one does (e.g. this
     app's original dev/seed user, connected before real auth existed), it resolves
     *that* account's real email via `admin.auth.admin.getUserById()` and reuses it, so
     the athlete's existing data (activities, fueling logs, physiological profile) is
     preserved instead of silently forking into a new, empty identity. Only a genuinely
     new Strava athlete gets the deterministic synthetic email,
     `strava-{athleteId}@strava.users.motormetabolico.internal` — a domain that never
     receives mail, existing purely as a stable dedup key.
  3. **The returned `verification_type` must be read from the response, not assumed.**
     A brand-new user's link comes back as `verification_type: "signup"`; a returning
     user's comes back as `"magiclink"` — verified against the live API while building
     this (a hardcoded `type: "magiclink"` throws `otp_expired` for a new user, a
     genuinely confusing error for what's actually a type mismatch). `supabase.auth.
     verifyOtp({ token_hash, type: linkData.properties.verification_type })`, called on
     the *request-scoped* client from `getAuthenticatedSupabaseClient()` (so the
     resulting session cookies land on this exact response), is what actually
     establishes the real session.
  4. Only then does the callback upsert `profiles` (Strava tokens) and `athlete_profiles`
     (zero-friction weight sync) — unchanged from before, just now running with a real
     session backing the RLS `auth.uid()` check rather than the old dev-user singleton.
- **`middleware` is `proxy` in this Next.js version** (v16 renamed and deprecated
  `middleware.ts`/`export function middleware` — see `node_modules/next/dist/docs/01-app/
  03-api-reference/03-file-conventions/proxy.md`; AGENTS.md's warning about this repo's
  Next version having training-data-breaking changes is exactly why this got checked
  before writing any code). `proxy.ts` at the project root refreshes the Supabase session
  on every request (`supabase.auth.getUser()`, which revalidates the JWT server-side,
  not `getSession()`, which would trust a possibly-stale cookie) and redirects to
  `/login` whenever there's no valid session outside the public paths (`/login`,
  `/api/strava/connect`, `/api/auth/strava/callback`) — this is what makes "Conectar con
  Strava" a real login gate rather than cosmetic UI.
- **`lib/supabase-server.ts`** — `getAuthenticatedSupabaseClient()` is no longer a
  module-level singleton signed in as one hardcoded dev user; it's a request-scoped
  `@supabase/ssr` `createServerClient` that reads the real session from cookies via
  `next/headers`'s `cookies()`. Every existing caller across `lib/dashboard-data.ts` and
  every `app/api/**/route.ts` handler *already* derived `userId` from `supabase.auth.
  getUser()` rather than assuming a fixed one, so nothing downstream needed to change —
  only this file's internals did. Cookie writes are wrapped in a try/catch since Server
  Components can only *read* cookies (`proxy.ts` already handles refreshing/persisting
  the session on every request, so a Server Component's own write attempt silently
  no-op'ing is safe); Route Handlers and Server Actions, which *can* set cookies, apply
  normally.
- **`lib/supabase-browser.ts`** — the only client-side Supabase client in the app
  (`createBrowserClient`, anon key), used exclusively by the sidebar's logout button.
- **`lib/auth-actions.ts`** — `logout()`, a `"use server"` Server Action
  (`supabase.auth.signOut()` then `redirect("/login")`) wired directly as a `<form
  action={logout}>` in `components/dashboard-shell.tsx`'s sidebar, below the identity
  card.
### Login & loading screens (`app/login/page.tsx`, `app/auth/callback/page.tsx`)

**`app/loading.tsx`** is Next's route-level `loading.tsx` boundary at the true app root —
the fallback for `/login`, `/auth/callback`, and `/privacidad`, none of which have a
persistent shell of their own (each renders its own full-bleed `AuthPageShell` or, for
`/privacidad`, a plain top bar), so a full-screen fallback is correct here: `min-h-screen
w-full flex items-center justify-center bg-[#FDFCF9]`, just the brand mark, no
"Cargando..."/status text — a purist loading state that reads as part of the app's own
chrome rather than a generic spinner screen. The mark (`size-14`) uses a custom
`animate-logo-breathe` keyframe (`app/globals.css`) rather than Tailwind's own
`animate-pulse` — a bare opacity fade alone read flatter than pairing it with a scale
shift. An initial `scale(0.98) → scale(1)` / opacity `0.85 → 1` version read as too subtle
in practice — closer to "frozen" than "loading" — widened to a clearly visible
`scale(0.9) → scale(1.05)` / opacity `0.6 → 1` swing over a faster `1.4s` cycle, still a
smooth ease-in-out breathing motion rather than a sharp pulse.
A second, differently-styled copy of this same fallback lives at
**`app/(app)/loading.tsx`** — see "Sidebar navigation vs. Dashboard tabs" below for why the
authenticated Dashboard shell needed its own route group and its own nested `loading.tsx`
rather than reusing this root one as-is.

**`app/login/page.tsx`** is the only entry point when `proxy.ts` finds no session: a
centered screen (value prop + a single "Conectar con Strava" CTA linking to
`/api/strava/connect`) with its own `stravaLoginErrorMessages` map for login-time
failures (`missing_code`, `token_exchange_failed`, `missing_athlete_id`,
`auth_bridge_failed`, `save_failed`) — distinct from `app/(app)/page.tsx`'s own
`stravaErrorMessages`, which now only covers errors from the already-logged-in
"Sincronizar rutas" action (`not_connected`, `no_rides`), since a logged-out visitor
can never reach that page to see them.
  A Pas Normal Studios-inspired redesign pass went through three iterations before
  landing on the current **full-bleed, card-free editorial layout** (no floating white
  box, no shadow, no background pattern at all — a single flat `bg-[#FDFCF9]` for the
  entire viewport): a first attempt tried a full-bleed illustrated road-perspective SVG
  behind a `bg-[#FDFCF9]/90 backdrop-blur-sm` overlay, but the overlay opacity needed to
  keep the page's light/cream palette left the image all but invisible on a phone (a
  flat blurred smudge, not a recognizable texture); a second attempt replaced it with a
  faint CSS dot-grid (`radial-gradient`) behind a floating white `Card`, but the result
  read as a generic SaaS/Google-login template rather than this app's editorial identity
  — floating boxes with shadows are exactly the "consumer SaaS" look this app's whole
  design system otherwise avoids. The current version has no card and no texture at all:
  three horizontal bands (top bar, centered hero, bottom bar) stacked in one `flex-col`
  page, divided only by thin `border-neutral-300/80` rules — structure communicated
  through typography and hairlines, not containers.
  - **Top bar** — brand mark + "Motor Metabólico" **centered** (`justify-center` on the
    header itself, not a `justify-between` split) with the "V1.0 · Nutrición de precisión"
    badge `absolute right-6`, hidden below `sm:` entirely rather than collapsing to just
    "V1.0" — an earlier version kept the badge on mobile at a shortened "V1.0", but a
    left-aligned brand competing with a right-aligned badge is exactly the asymmetric,
    "cargado" look this pass was meant to fix, and dropping the badge on mobile lets the
    brand mark sit genuinely centered instead of visually off-center against an invisible
    counterweight. `components/dashboard-shell.tsx`'s own mobile sticky header got the
    identical treatment — the hamburger button moved from an inline flex item (which
    pushed the brand mark left, `Menu` icon + logo + text reading as one lopsided cluster)
    to `absolute left-6` against a `justify-center` header, so the authenticated app's
    header now uses the same centered-brand language as the logged-out screens.
  - **Hero** — centered via `flex-1 items-center justify-center` in the remaining space
    between the two bars. "NUTRICIÓN DE PRECISIÓN PARA CICLISTAS" replaces the old
    shorter title now that there's no card width constraining it. The old paragraph-style
    value prop is a 3-line checkmark list (`✓ Recetas exactas de glucosa y fructosa` /
    `✓ Ajuste por meteorología en tiempo real` / `✓ Pautas listas para tu mezcla casera`,
    `font-mono text-xs`) — terser and more scannable, matching the PNS convention of short
    declarative benefit lines over descriptive prose. Every checkmark is `font-bold
    text-terracotta` (the design-system accent token, `#c85231` — not a hardcoded hex,
    per this app's own "reuse tokens" convention) rather than the muted default text
    color, so the three benefits read as a deliberately branded list rather than plain
    body copy. The checklist, error banner, and Strava button all share one fixed
    `max-w-70` (280px, the canonical Tailwind spelling of `max-w-[280px]`) block width —
    narrower than the `max-w-xs` (320px) used everywhere else in this app, specifically so
    this one screen's central column reads as a tight, deliberate column rather than
    stretching to an arbitrary utility width never chosen for this exact layout. The error
    banner (`stravaLoginErrorMessages`) renders inline here, no card chrome around it.
  - **Bottom bar** — three technical specs, always one line, never wrapped/stacked.
    `specsFull` ("01 / Ratio 1:0.8 optimizado", "02 / Meteorología en vivo", "03 / Mezcla
    casera") renders at `sm:` and up; below it, `specsShort` ("01 / Ratio 1:0.8", "02 /
    Clima en vivo", "03 / Mezcla casera") — two entirely separate rows (`sm:hidden` /
    `hidden sm:flex`), not one row whose text swaps, since the two variants need different
    `gap`s to each fit their own viewport. This exists because the full specs measured
    388px of content against only 342px available at a 390px viewport — every version
    tried before this one either wrapped unevenly (a bare `flex-wrap` row, one spec alone
    on its own line) or silently clipped both edges (`justify-center` truncating an
    overflowing row from both sides equally, verified live: "01 / Ratio 1:0.8 optimizado"
    losing its "01 / Ratio 1:" and "03 / Mezcla casera" losing its "asera"). Shortened
    labels below `sm:` — same "shorter label on mobile" convention as the Sync button and
    the Carbos/Carbohidratos stat label elsewhere in this app — was the fix that actually
    fits with room to spare (measured: exactly 342px of 342px available).
  `components/strava-login-button.tsx` is a solid `bg-neutral-900`/`hover:bg-black`
  technical button (`rounded-md`, `py-3 px-5`), sizing itself (`max-w-xs mx-auto w-full`
  directly on the `<a>`, no wrapping div needed at the call site) with `StravaMark` left
  at its default corporate-orange fill (`#FC4C02`) — the icon is the only spot of color on
  an otherwise monochrome button, same "one accent color, used deliberately" restraint as
  the rest of this app's palette. Verified live at both a 390×844 mobile viewport (zero
  scroll, with and without the error banner) and desktop — no element on the page carries
  a `box-shadow` anywhere, confirmed via computed style, and the old
  `public/login-road-bg.svg` asset was deleted once nothing referenced it.

**Root-level scroll lock (`h-dvh` + `overflow-hidden`, not `min-h-screen`).** An earlier
version of `AuthPageShell` used `min-h-screen`, which measures against the *largest*
possible viewport iOS Safari can report — the moment a touch-drag revealed/hid Safari's
address-bar chrome (which resizes the *visual* viewport without the page re-rendering),
the page's own fixed height no longer matched the now-shrunk `100vh`, leaving a sliver of
extra scrollable height and letting one stray swipe scroll the whole screen by a few
pixels. `h-dvh` (the *dynamic* viewport height unit, which iOS Safari itself keeps in
sync as its chrome shows/hides) plus `overflow-hidden` on the same root element closes
that gap outright — verified live at a 390×844 viewport (`html.scrollHeight ===
html.clientHeight`, `canScroll: false`) and additionally at a smaller 360×640 viewport,
since the failure mode here is specifically about *tight* vertical budgets. `justify-
between` on the root flex column with `flex-none` on both the header and footer is what
keeps `<main>` (the sole `flex-1`) as the only region that actually flexes — the bars
never grow/shrink regardless of their own content's natural height.

**Footer spec row, bullet-separated.** The three specs render as one `•`-separated line
at every viewport now (`01 / Ratio 1:0.8 • 02 / Meteo en vivo • 03 / Mezcla casera`,
already the shortened mobile-friendly wording from the previous pass) rather than two
separate `sm:hidden`/`hidden sm:flex` rows — simpler markup, one row instead of two. The
`gap` between items had to shrink further than expected to actually guarantee zero
overflow at every real phone width: `gap-2` fit at 390px but measurably overflowed
(330px of content against 328px available) at a smaller 360px viewport — narrow enough
that Android devices still ship at it. Settled on `gap-0.5` below `sm:` (`sm:gap-8` once
there's real room), verified to fit with zero overflow (`scrollWidth === clientWidth`)
at both 360px and 390px.

**`components/auth-page-shell.tsx`**'s `AuthPageShell` holds the top bar/hero-wrapper/
bottom bar frame described above as a single shared component, once `/auth/callback`'s
own transition screen needed the *identical* bars — extracted so a future copy or style
change to either only has to happen in one place rather than two copies drifting apart. A
plain component (no `"use client"`, no server-only APIs), so it's safe to import from
`/login`'s `async` Server Component and from `/auth/callback`'s `"use client"` one alike;
each page passes only its own hero content as `children`. **`app/auth/callback/page.tsx`**
now renders `AuthPageShell` with a pulsing `AppLogo`, a "Conectando con Strava..." status
title, and a "Sincronizando perfil fisiológico y recalculando datos de rutas recientes."
subtitle in place of the old standalone dual-logo card (`AppLogo` + three sequenced
pulsing dots + `StravaMark` inside its own `rounded-2xl` white card) — the transition
screen and the login screen it leads into (or back to, on failure) now read as the exact
same surface rather than two differently-styled auth screens.

### Seeding dev data

`npm run seed` (`scripts/seed.ts`) still signs in with `SEED_USER_EMAIL`/
`SEED_USER_PASSWORD` directly (its own client, independent of `lib/supabase-server.ts`)
and, only if missing, inserts: a `profiles` row, an `athlete_profiles` row (FTP 250W,
72kg, medium sweat rate — a plausible amateur-racer fixture, not this specific user's
real numbers), and one activity ("Serra de Tramuntana Loop") with hand-computed nutrition
figures matching `lib/metabolic-engine.ts`'s formulas for that ride's watts/humidity/
temperature. It's safe to re-run — every insert is guarded by an existence check first,
matching the pattern the Strava sync route also uses for `activities`. This is now purely
a local dev-data bootstrap, disconnected from the real login flow above — the seed user
only becomes *usable* in the browser once they also complete the real Strava OAuth login
(which, per the account-reuse logic above, resolves back to this same seeded row as long
as its `strava_athlete_id` matches).

### Strava OAuth

- `GET /api/strava/connect` — redirects to Strava's authorize URL (`lib/strava.ts`).
- **`/auth/callback`** (`app/auth/callback/page.tsx`) — `getStravaRedirectUri()` points
  Strava's redirect here rather than straight at the Route Handler below, so the browser
  has a real page to render (a "Conectando con Strava..." transition screen, sharing the
  exact same full-bleed `AuthPageShell` frame as `/login` — see "Login & loading screens"
  below — with a pulsing `AppLogo` and status copy in place of the login CTA) for however
  long the token-exchange/Supabase-bridge work below takes, instead of a blank tab.
  Strava's "Authorization Callback Domain" setting only ever validates the *domain*, never
  the path, so this needed no change on Strava's side. The page does no work itself: a
  `useEffect` (guarded by a `hasStartedRef` against React Strict Mode's dev-only double
  effect invocation, since Strava's `code` is single-use) forwards the exact same query
  string to `/api/auth/strava/callback` via `fetch` and navigates to whatever it
  redirects to (`window.location.href = res.url`) — the same "fetch, then follow its
  redirect" pattern `components/sync-button.tsx` already uses, so the Route Handler below
  and its cookie-setting are completely unchanged.
- `GET /api/auth/strava/callback` — exchanges the returned `code` for tokens, bridges into
  a real Supabase Auth session (see "Real auth: Strava-exclusive login" above for the
  full Admin API dance), saves the tokens on that user's `profiles` row, then redirects
  to `/`. On any failure it redirects to `/login?strava_error=<code>` instead of
  pretending it worked — see `stravaLoginErrorMessages` in `app/login/page.tsx` for the
  human-readable copy per code. Also does a best-effort, zero-friction weight sync:
  fetches `/athlete` (`fetchAthlete()`
  in `lib/strava.ts`) and upserts its `weight` (kg) into `athlete_profiles.weight_kg` —
  `UPDATE` if the athlete already has a profile row (never overwrites their own `ftp`/
  `sweat_rate`), otherwise `INSERT`s a fresh row with placeholder `ftp: 200` /
  `sweat_rate: 'medium'` (Strava has no concept of either) so the row satisfies the
  table's `NOT NULL` columns until the athlete edits their real numbers via the
  Physiological Profile form. A failure here is logged but never undoes an otherwise-
  successful Strava connection.

  **First-login onboarding bootstrap** — immediately after the token/weight-sync work
  above, and only when `isNewAccount` is `true` (a Strava athlete genuinely never seen
  before, the same flag the account-reuse logic already computes — never on a returning
  login), the callback also pre-warms the athlete's saved-routes cache (see "Strava
  saved-routes cache & manual refresh" below — an `unstable_cache` call with the exact
  same `stravaRoutesCacheTag(userId)`/`STRAVA_ROUTES_REVALIDATE_SECONDS` the Dashboard's
  own `getStravaRoutes()` uses, so it's genuinely the same Data Cache entry, not a second
  one) and syncs their single most recent ride via `syncLatestActivity()`
  (`lib/strava-sync.ts`, see below). Both are independent best-effort `try/catch` blocks —
  a failure in either is logged but never undoes the login or blocks the final redirect —
  so the Dashboard, "Al llegar," and Historial all have real data from the very first
  render instead of sitting empty until the athlete manually hits "Sincronizar Strava."
- `POST /api/strava/sync` and the first-login bootstrap above both call
  **`syncLatestActivity()`** (`lib/strava-sync.ts`) — extracted into its own module so the
  two callers share one identical weather-sampling/nutrition-calculation pipeline instead
  of a second hand-copied implementation drifting out of sync with the first. It pulls the
  athlete's latest cycling activity (`fetchLatestRideActivity()`, `lib/strava.ts` —
  `per_page=30`, not the original `10`: an athlete who's logged several other-sport
  activities — a run, a swim, a gym session — between rides could otherwise push their
  last real ride past a smaller window, surfacing a misleading "no rides" error even
  though a recent cycling activity exists a bit further back in their feed; the sport-type
  filter itself, `CYCLING_SPORT_TYPES`, was already broad enough) and writes it into
  `activities` if it isn't there yet via
  `.upsert(..., { onConflict: "id", ignoreDuplicates: true })` (`id` *is* the Strava
  activity id) rather than a plain insert — the `!existing` check below still gates
  whether weather/nutrition get computed at all, but the write itself is race-safe against
  a rapid double-click on "Sincronizar rutas": two requests that both see `!existing`
  before either finishes would otherwise hit a duplicate-key error on the second insert;
  with `ignoreDuplicates`, the loser of that race is a silent no-op instead. Only for a
  genuinely new activity (the `!existing` branch) it also:
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
  `POST /api/strava/sync/route.ts` itself is now a thin wrapper: auth check, resolve a
  valid access token, call `syncLatestActivity()`, map its `{ status: "no_rides" }` /
  `{ status: "synced", ... }` result onto the route's existing JSON response shape.
- The Dashboard header shows "Conectar Strava" or "Sincronizar Strava" depending on
  whether `profiles.strava_athlete_id` is set (`getProfile()` in `lib/dashboard-data.ts`).
  The sync button (`components/sync-button.tsx`, `"use client"`) still hits the exact same
  `POST /api/strava/sync` route as a native form would, but through a client action
  function instead of a plain string `action` — `useFormStatus` only tracks pending state
  for function actions, so this is what makes the "Sincronizando..." spinner text real.
  **The route is a plain JSON API** (`{ error: code }` with a 4xx/401/404 status, or
  `{ success: true, activityName, isNew }`), not a redirect — it used to redirect (to `/`
  or `/?strava_error=<code>`) and the client followed that via `window.location.href`,
  which was a real bug: a full page navigation on every sync click, discarding whatever
  the athlete was mid-typing into the Fueling Planner (pocket food selections, departure
  time, an already-calculated result) and causing a visible flash. Fixed by having the
  action call `router.refresh()` on success instead — the App Router's own "re-run every
  Server Component on this route, patch the result into the tree, no full reload"
  primitive, so `getRecentActivities()`/the Weekly Performance Panel re-fetch the freshly
  synced data while every client component below (`FuelingPlanner` chief among them) keeps
  its own React state completely untouched, since `router.refresh()` never remounts them.
  A self-dismissing toast reports success or a per-error-code message, replacing the old
  `?strava_error=` query-param banner on this page entirely (that mechanism, and
  `app/(app)/page.tsx`'s own `stravaErrorMessages` map, existed *only* to surface this route's
  redirect errors — now dead code once the route stopped redirecting, so both were removed
  rather than left stubbed out). The toast is a solid `bg-white` pill (`rounded-xl`,
  `shadow-xl`, `border-neutral-200/90`, `z-10000`) fixed to the bottom-center of the
  viewport — an earlier semi-transparent version let the Leaflet map show through behind
  it, and a since-reverted dark `bg-neutral-900` version broke with the app's light
  editorial palette (every other surface in the app is white/cream, never a dark card).
  A small `bg-emerald-50`/`bg-red-50` icon chip (a soft tint, not a saturated fill) plus a
  two-line title/message (e.g. "Sincronización completada" / "Rutas y datos de Strava
  actualizados", dark text on the white background) auto-dismisses after 3s, same timing
  as before.
  On mobile, the button itself collapses from the full "Sincronizar Strava" label to just a
  `RefreshCw` icon (Strava-orange, `#FC4C02`) plus a short "Sync" label — the full label
  next to the Dashboard header's own greeting (e.g. "Buenas tardes, Alejandro" — see
  "Dynamic greeting" below) was wide enough to clip the greeting text on a narrow phone;
  `sm:` and up show the full label again.

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

### Strava saved-routes cache & manual refresh

`GET /athlete/routes` was being called on every single Dashboard load (via
`getStravaRoutes()` in `lib/dashboard-data.ts`) purely to populate the Fueling Planner's
route `<select>` — routes an athlete stars on Strava change maybe a few times a month, so
that's a lot of passive API traffic for data that's almost always identical to the last
call. `getStravaRoutes()` now wraps the actual `fetchAthleteRoutes()` network call in
`unstable_cache`, keyed only by `stravaRoutesCacheTag(userId)` (a small exported helper,
`` `strava-routes-${userId}` ``) — deliberately *not* by the access token, which rotates
roughly every 6h, so a token refresh never defeats the cache; the wrapped closure just
keeps using whichever token was valid at cache-population time. `STRAVA_ROUTES_REVALIDATE_SECONDS`
(24h, both exported from `lib/dashboard-data.ts`) is the natural expiry, cutting this
specific call by roughly 99% against calling it on every load. `getAuthenticatedSupabaseClient()`/
`auth.getUser()` still run *outside* the cached function on every call — `unstable_cache`
throws if a dynamic API like `cookies()` is used inside it, so only the plain `fetch` to
Strava is ever wrapped.

An athlete who just starred a new route on Strava shouldn't have to wait up to a full day
for it to appear, though — **`refreshStravaRoutes()`** (`lib/strava-actions.ts`, a
`"use server"` Server Action) calls `updateTag(stravaRoutesCacheTag(userId))` to bypass the
cache on demand. `updateTag`, not `revalidateTag`, is the deliberate choice: this Next.js
version requires `revalidateTag`'s second `profile` argument and only offers
stale-while-revalidate semantics from a Route Handler, whereas `updateTag` (callable only
from a Server Action) expires the tag immediately and makes the *next* request wait for
genuinely fresh data — exactly the "read-your-own-writes" case a manual refresh click is.
`components/fueling-planner.tsx`'s route `<select>` gets a small "Recargar" icon button
next to its label (calls the action, then `router.refresh()`, with a spinning `RefreshCw`
while pending) — the same manual-bypass button also appears, larger, in the "sin rutas
guardadas" empty state (see below) as "Buscar rutas de nuevo," since a rider connecting
Strava mid-session with zero starred routes yet is the case most likely to want an
immediate re-check rather than waiting for the 24h window.

The empty-state copy itself ("Sin rutas en Strava — usa la calculadora rápida o sube un
GPX.") replaced an earlier version that only mentioned the quick calculator, not the GPX
uploader — by the time GPX mode existed, that message was stale.

### Strava API compliance: privacy policy, scopes, and data-use disclosure

Three things Strava's API Agreement expects from any app using their API, all satisfied
together:

- **Branding** — `components/strava-login-button.tsx`'s CTA already carries both the
  official Strava icomark (`components/strava-mark.tsx`, corporate `#FC4C02` orange) and
  explicit "Conectar con Strava" text, satisfying the requirement to visibly identify
  Strava as the connected service rather than a generic "Conectar cuenta" button.
- **A published, publicly-reachable privacy policy** — `app/privacidad/page.tsx`, added to
  `PUBLIC_PATH_PREFIXES` in `proxy.ts` so it's reachable with *no session at all* (the
  requirement is specifically that a visitor can read it *before* connecting their
  account, not only after logging in). Deliberately not built on `components/
  auth-page-shell.tsx` despite living alongside `/login` conceptually — that shell locks
  the whole viewport to `h-dvh overflow-hidden` for its own single-screen hero layout,
  which would be wrong for a long-form policy document that needs to scroll normally
  (verified live: `/privacidad`'s `scrollHeight` is ~1891px against an 844px viewport,
  genuinely scrollable, unlike every `AuthPageShell` screen). Plain top bar (brand mark +
  a "Volver" link back to `/login`) plus a normal scrolling `<article>`-style `<main>`.
  Linked from `/login`'s own footer note ("Acceso seguro mediante OAuth. Solo lectura de
  rutas — nunca vendemos ni compartimos tus datos. **Política de Privacidad**") — verified
  the added text doesn't reintroduce mobile scroll on the login screen itself.
- **Data-use disclosure, matching the real scopes** — the policy states the exact three
  OAuth scopes this app actually requests (`read`, `activity:read_all`,
  `profile:read_all` — see `STRAVA_SCOPES` in `lib/strava.ts`), what each is used for, and
  states plainly that no write scope is ever requested and no data is sold or shared with
  third parties — both true statements about this codebase (there's no write call to
  Strava's API anywhere, and no analytics/ads SDK or data-export mechanism exists) rather
  than aspirational copy. The contact email (`arodriguuij@gmail.com`) is the developer's
  real address, not a placeholder — asked explicitly rather than inventing a
  `@motormetabolico.app` address that domain doesn't actually have configured.

### Metabolic engine

`lib/metabolic-engine.ts` turns physiological inputs into a fueling plan — all pure
functions, no I/O, safe to import from both server components (the Dashboard cards) and
client components (`FuelingPlanner`/`PostRideAnalysis`'s live recompute in the browser).
Heuristic and documented as such throughout, grounded in mainstream sports-nutrition
guidance rather than a clinical or individually-calibrated model:

- **`getCarbOxidationRateGPerHour(relativeIntensity)`** — carb burn rate (g/h) banded by
  %FTP: 30g/h below 50% FTP up to a 100g/h practical gut-absorption ceiling at/above 110%
  FTP. `relativeIntensity` comes from either `getRelativeIntensityFromLevel(level)` (the
  pre-ride planner's assumed %FTP per named intensity — recovery 55%, endurance 70%, tempo
  85%, threshold 98%, vo2max 115%) or `getRelativeIntensity(averageWatts, ftp)` (real
  data, used for the Post-Ride Analysis and the pre-ride planner's quick-calculator mode).
  `getPersonalizedCarbOxidationRateGPerHour(relativeIntensity, athleteType)` wraps this
  with the athlete's metabolic phenotype adjustment (see "Metabolic phenotype" below) and
  is the actual entry point every call site uses. This personalized figure is what
  `getGutCappedCarbTarget` (see "Gut Training Scale" below) then clamps down to what the
  athlete's gut can actually absorb.
- **`getFluidLossMlPerHour(sweatRate, temperatureC, humidityPct)`** — a baseline ml/h by
  sweat-rate category (low 500 / medium 750 / high 1000, at a comfortable ~18°C/50%
  humidity) scaled up by `getHeatHumidityMultiplier`: a gentle +2%/°C slope between 18°C
  and `HIGH_HEAT_THRESHOLD_C` (25°C), above which the body's cooling demand no longer
  scales gradually — a flat `HIGH_HEAT_MULTIPLIER` (+20%) replaces the slope entirely
  rather than compounding on top of it, so 25.1°C jumps straight to ×1.2 instead of
  continuing from the slope's ×1.14 at 25°C. Humidity always scales gently, +0.4%/point
  above 50%, independent of which heat regime applies. `getSodiumLossMgPerHour(fluidLossMlPerHour,
  isSaltySweater?)` multiplies that fluid volume by a flat sweat-sodium concentration — 700mg/L
  for a typical athlete, or 1200mg/L when `athlete_profiles.is_salty_sweater` is set (see
  "Athlete profile" below) — a genuine heavy sweater's real concentration sits meaningfully
  above the app-wide average, and under-dosing sodium for one risks cramping and, on long hot
  rides, hyponatremia. Threaded through every call site that computes sodium loss: `POST
  /api/fueling/plan`, `POST /api/strava/sync`, and `POST /api/post-ride/analysis`.
- **`getHomeLabRecipe()`** — the "Receta de Laboratorio Casero": splits the ride's total
  carb target into a maltodextrin:fructose mix by weight whose ratio scales with the
  ride's own carb rate via `getMaltodextrinFraction(carbsGPerHour)` — below 45g/h a single
  glucose-polymer transporter (SGLT1) isn't saturated yet, so pure maltodextrin (100:0);
  45-75g/h uses a 2:1 split to start recruiting the fructose-specific GLUT5 transporter;
  above 75g/h — where SGLT1 alone is genuinely maxed out — the ratio shifts to 1:0.8, the
  split most dual-transporter research settles on for near-maximal (~90g/h+) combined
  oxidation — plus the sodium and water targets for the same duration, one bottle recipe
  covering both carbs and hydration.
- **`getTableSaltGrams(sodiumMg)`** — every sodium figure elsewhere in this file is a
  *pure sodium* target, but a kitchen scale weighs salt, not sodium, and common table salt
  (NaCl) is only ~39.3% sodium by weight — this converts to the actual number of grams to
  weigh out (`sodiumG × 2.54`). Used everywhere the DIY recipe's sodium is displayed or
  exported (the recipe card, per-bottle figures, the Ziploc reload dose, and
  `formatRecipeForSharing()`'s clipboard text) so nothing shows a sodium milligram figure
  with no way to actually measure it out at home.
- **`getGlycogenBurnedGrams(relativeIntensity, movingTimeSeconds, athleteType?)`** — the
  personalized oxidation rate integrated over the ride's actual duration; this is what the
  sync route stores as `activities.carbs_burned_g`.
- **`getRecoveryDebt({ carbsBurnedG, carbsConsumedG, fluidLossMl, fluidConsumedMl,
  sodiumLossMg, sodiumConsumedMg })`** and **`getMacroRecoveryTarget({ weightKg,
  recoveryDebt })`** — the post-ride "Objetivo de Recuperación por Macronutrientes",
  split into a debt step (nets each burned/lost figure against what the rider says they
  actually consumed *during* the ride, floored at 0, with fluid scaled by a ~120%
  ACSM-style post-exercise rehydration factor before netting) and a target step (turns
  that net debt into carbs capped at the lower of the debt or a ~1.2g/kg ceiling —
  replacing more than was burned doesn't speed resynthesis, it's just extra calories —
  plus a weight-only protein target at ~0.35g/kg clamped to 22-35g and a soft fat limit
  at ~0.15g/kg clamped 10-20g, both unaffected by in-ride intake since they're about
  muscle repair/gastric-emptying speed rather than replacing a measured deficit; fluid
  and sodium targets are the net debt figures directly). See "Net recovery debt" under
  "Post-Ride Analysis" below for where each input comes from and why it's split this way.
- **`estimateRideDurationHours({ distanceKm, elevationGainM, ftp, weightKg, intensity })`**
  — sizes the fueling window for a saved Strava route, which has no real moving-time of
  its own. A simplified two-term heuristic, not a physical simulation: a flat-road speed
  estimated from W/kg (~22km/h at 2.5 W/kg, +5km/h per extra W/kg) plus a
  Naismith's-rule-style climbing time bonus from an estimated VAM (~700 vertical m/h at
  2.5 W/kg, scaling with W/kg) — `flatTimeHours + climbTimeHours`, both clamped to
  plausible ranges.
- **`getGlycogenBurnedFromPowerZones(buckets, ftp, athleteType?)`** — sums oxidation rate ×
  time across real Strava time-in-power-zone buckets instead of one ride-average watts
  figure, since oxidation isn't linear in power: a ride spent half at recovery pace and
  half at threshold burns more glycogen than a steady ride at the same average. Each
  bucket's own midpoint watts picks its rate via `getPersonalizedCarbOxidationRateGPerHour`
  — no fixed Z1-Z5 relabeling, since Strava's bucket boundaries are whatever the athlete
  configured, not a standard 5-zone split. Feeds the Post-Ride Analysis (see below).

### Metabolic phenotype

A simplified VLaMax-style classification (`athlete_profiles.athlete_type`) — a "diesel"
athlete's higher fat-oxidation efficiency and an "explosive" athlete's higher glycolytic
rate both show up mainly at low-moderate intensity; above tempo everyone burns
glycolytically regardless of phenotype, so `getPersonalizedCarbOxidationRateGPerHour`
only applies the multiplier (diesel ×0.85, balanced ×1.0, explosive ×1.15) while
`relativeIntensity` is below the same 0.8 aerobic-zone threshold `getCarbOxidationRateGPerHour`
already uses internally for its own bands — at/above it, every phenotype converges to the
unadjusted rate. `athleteTypeLabels`/`athleteTypeDescriptions` hold the plain-text
display copy (no emoji — the interface is monochrome throughout) for the Physiological
Profile tab's one-click selector (3 radio-styled cards using Tailwind's `has-checked:`
variant, no JS needed; the selected card's `has-checked:border-neutral-900
has-checked:bg-neutral-100` gives a fine dark border plus a subtle fill rather than a
heavy block color).

### Net Carb Deficit (replacing the old glycogen-battery simulator)

An earlier pass modeled the ride as a "glycogen battery" — a simple tank (fixed 8g/kg
liver+muscle glycogen estimate) draining at the body's burn rate, reporting a "Batería
final: Y%" / "Pájara en el km X" comparison. Removed as its own kind of "humo": a
percentage of an *estimated* total store on top of an *estimated* burn rate is two layers
of approximation stacked before the athlete ever sees a number, and "bonk" is a binary
framing for what's really a continuous, auditable quantity. `getNetCarbDeficit()`
(`lib/metabolic-engine.ts`) replaces it with a direct, three-line breakdown in grams:
`estimatedBurnG` (the ride's real phenotype-adjusted, *uncapped* carb burn — deliberately
not the gut-capped recommended intake, since the gut cap limits what can be absorbed, not
what the body actually burns), `plannedIntakeG` (the recipe's recommended, gut-capped
intake over the same duration), and `netDeficitG` (`estimatedBurnG - plannedIntakeG` —
positive means the plan doesn't fully cover the ride's real demand, which is expected and
fine as long as it's within what the body's own reserves can cover; negative/zero means
intake covers or exceeds the burn). Rendered in `components/fueling-planner.tsx` as a
3-column "Gasto estimado de HC / Ingesta planificada / Déficit neto al finalizar" stat row
(replacing the old two-column noFuel/withRecipe comparison), plus a compact "Déficit neto:
±Xg HC" line in the Hero Card — a `TrendingDown` `lucide-react` icon in both spots rather
than the old `BatteryCharging`/`TriangleAlert` pairing.

### Hybrid nutrition (pocket food)

A rider eating solid food from their jersey pocket doesn't need those same carbs *also*
dissolved in their bottles — recommending the full ride target in both places would
overshoot the gut's absorption ceiling for no benefit. `pocketFoodLabels`/
`pocketFoodCarbsG` (`lib/metabolic-engine.ts`) hold fixed, illustrative carb figures for
seven catalog items — 🍌 Plátano 22g, 🍫 Barrita energética 30g, 🍙 Bollo de arroz/Rice
cake 25g, 🌴 Dátiles (2 uds) 18g, and three commercial-gel dose tiers modeled as separate
entries rather than one flat figure (🧃 Gel pequeño 25g, Gel estándar 30g, Gel alta
carga/Hydro 45g — a rider can mix doses in the same ride, e.g. 1 standard + 1 high-carb) —
not a real nutrition database, same convention as the recovery meal options.
`PocketFoodSelection` also carries an optional `customCarbsG` (free grams entry for
anything outside the catalog — a homemade snack, an unlisted brand — capped server-side at
`MAX_CUSTOM_CARBS_G` (500g) against an absurd/abusive value). `getPocketFoodTotalCarbsG(selection)`
sums the catalog quantities (`{ banana: 1, gel_standard: 2 }`-shaped) plus `customCarbsG`
into a total; `getHomeLabRecipe()`'s `pocketFoodCarbsG` param subtracts that from the
ride's carb target *before* splitting into maltodextrin/fructose, so the bottle recipe
automatically recalculates down to only what solid food doesn't already cover — see
`POST /api/fueling/plan` below for where the selection is sanitized and threaded through.
`getBottlePlan()` treats a resulting `totalCarbsG` of zero (pocket food covers the whole
ride) as needing zero fuel bottles rather than forcing a minimum of one, since there may
be nothing left to dissolve at all. `getPocketFoodMilestones()` spreads each individual
selected item (2 gels → 2 separate milestones) plus one milestone for any `customCarbsG`
evenly across the ride's duration/distance, never right at the start or finish, feeding
the "Hitos de Nutrición" in both nutrition-export mechanisms below. The Pre-Ride UI
(`PocketFoodStepperRow` in `components/fueling-planner.tsx`) renders the four non-gel
items, the three gel doses, and the custom entry as a compact `grid grid-cols-1
md:grid-cols-2 gap-3` — each its own soft `border-neutral-200` cell rather than one
harder-edged block, keeping the form short even with 8 catalog entries. Each cell's
food name is rendered without emoji, in the same clean sans as everything else (via a
local `pocketFoodName()` helper that calls `stripEmoji()`, imported from
`lib/gpx-export.ts` and reused rather than duplicated, on `pocketFoodLabels[type]` at
render time — `pocketFoodLabels` itself keeps its friendly emoji-prefixed copy
unchanged, since that's what feeds the clipboard/GPX nutrition exports elsewhere; only
this one UI surface strips it), with its carb figure directly underneath in `font-mono`
— monospace is reserved for the numeric readout, never the food name, so a name like
"Bollo de arroz" stays unambiguous instead of rendering in a terminal-style face where
similar letterforms (o/u) are easy to misread. The stepper buttons themselves are a
soft `bg-neutral-100` pair, not a stark black-bordered block. The result panel still
shows a one-line "Comida de bolsillo cubre Xg de Yg HC — el resto va en el bidón" (with a
small `Utensils` icon, not an emoji) whenever any item is selected —
that summary line isn't part of the pocket-food *catalog* UI, so it keeps its emoji.

### Fueling mode selector (Óptimo / Mi Inventario / Híbrido)

Three ways of arriving at the same DIY-recipe pipeline above, differing only in *where
the pocket-food selection comes from* before `getHomeLabRecipe`'s existing
`pocketFoodCarbsG` subtraction runs — `FuelingMode` (`lib/metabolic-engine.ts`) is
`'optimal' | 'inventory' | 'hybrid'`, sent as `fuelingMode` in `POST /api/fueling/plan`'s
body (validated against `VALID_FUELING_MODES`, defaulting to `'inventory'` for any
unrecognized value). The `'inventory'` mode/label was originally `'pantry'`/"Mi Despensa" —
renamed app-wide for a more technical/professional tone, with zero data-migration concern
since `fuelingMode` is a request/response field only, never persisted to `fueling_logs` or
anywhere else in Supabase:

- **Mi Inventario (`'inventory'`, the default)** — the athlete's own manual catalog
  selection, used exactly as-is. This was this app's only behavior before modes existed,
  so nothing changed here except giving it an explicit name alongside the other two.
- **Óptimo (`'optimal'`)** — a high-digestive-efficiency strategy composed *exclusively* of
  the DIY bottle plus fast-absorption gels, never solid food (banana/energy bar/rice cake/
  dates) — solids slow gastric emptying relative to a gel, which matters more on the
  harder/longer rides this mode targets. The athlete makes no choice at all;
  `getOptimalPocketFoodSelection(durationHours)` picks automatically once `durationHours`
  is known server-side (the route ignores whatever `pocketFood` the client sent for this
  mode and recomputes it, same "server never trusts client-computed values" convention as
  re-fetching the athlete profile). Below ~2.5h there's nothing to gain from any pocket food
  at all — an all-liquid DIY bottle is simpler and just as effective — so the selection is
  empty; 2.5-4h adds one standard gel, 4-6h two
  standard gels, past 6h one standard + one high-carb "hydro" gel — gel count/tier scaling
  with duration as a proxy for total carb demand, a fixed, modest allowance, not a full
  combinatorial optimizer (this file's "heuristic, not clinical" convention throughout).
  `components/fueling-planner.tsx` hides the solid-food catalog rows and the custom-carbs
  input entirely in this mode (rather than just disabling them — they're categorically
  excluded, not merely locked to the last manual value), showing only the three gel rows
  (disabled, `PocketFoodStepperRow`'s `disabled` prop) reading the *server's* chosen
  quantities from `result.pocketFood` once a result comes back (the disabled steppers would
  otherwise still show the athlete's last manual selection, not the auto-selected one).
- **Híbrido (`'hybrid'`)** — the athlete's manual selection is treated as a fixed base
  (used as-is, exactly like `'inventory'`), and `getHybridGelSuggestion(remainingCarbsG)`
  additionally computes how many standard gels (30g each, a simple greedy fill with one
  gel size, not a full optimizer) would close whatever gap is left after that base
  selection — returned as `hybridGelSuggestion` in the response and rendered as a purely
  advisory line ("Alternativa: N geles estándar... cubrirían la brecha en vez del
  bidón — o deja que el bidón la absorba"). The bottle recipe itself is unaffected by this
  suggestion either way — it always covers the true remaining gap, exactly like
  `'inventory'` mode — this is just naming an alternative way to close the same gap, not
  auto-adding gels to the actual recipe.

`components/fueling-planner.tsx` renders these as a 3-pill segmented control (`FUELING_MODE_OPTIONS`)
directly above the pocket-food block, and a live "OBJETIVO: Xg HC | CUBIERTO: Yg HC |
RESTANTE: Zg HC" counter above that — populated from the last calculated `result`
(`totalRideCarbsG`/`pocketFoodCarbsG`/their difference) rather than a client-side
re-implementation of the duration-estimation and gut-cap logic that would otherwise be
needed to preview it before calculating; a neutral placeholder ("Calcula tu estrategia
para ver el desglose...") shows until the first calculation.

### Bottle architecture & osmolarity control

`getBottlePlan(recipe, bottleSizeMl)` splits the DIY recipe into concentrated "fuel"
bottles and plain water/electrolyte bottles rather than reporting one lump of grams.
`bottleSizeMl` is the athlete's *real* bottle capacity — `athlete_profiles.bottle_capacity_ml`
(500/600/750/950ml, configured on the Profile tab, defaulting to `DEFAULT_BOTTLE_SIZE_ML`
750 if the param is omitted) — not a fixed assumption, so a rider running smaller
600ml bottles correctly needs more of them for the same carb target.
`MAX_BOTTLE_CARB_CONCENTRATION` (8% of whatever that real bottle size is) keeps a safety
margin below the ~10-12% concentration widely cited as the threshold for
hypertonic-solution gastric distress/delayed emptying. Independently of that GI-comfort
cap, `MAX_SOLUBILITY_G_PER_L` (140g/L) encodes the hard physical ceiling above which
maltodextrin/fructose powder simply stops fully dissolving in cold water — `getBottlePlan`
sizes each fuel bottle to whichever of the two caps is stricter (`Math.min` of both,
expressed per-bottle), rather than assuming the GI cap alone will always be the binding
one. At every currently-supported bottle size (500-950ml) the 8% GI cap is in fact always
the stricter of the two, so today's fuel-bottle counts are unchanged by this — the
solubility check exists as an explicit, independent safety floor so a future change to the
GI-comfort cap alone couldn't silently recommend a bottle that wouldn't physically
dissolve. `fuelBottleCount = ceil(totalCarbsG / maxCarbsPerBottle)` (zero when
`totalCarbsG` is already zero — see "Hybrid nutrition" above) determines how many
concentrated bottles are needed to stay under that effective cap (each carrying an even
share of the recipe's maltodextrin/fructose/sodium); any additional fluid target beyond
what those bottles hold is covered by plain water/electrolyte bottles. Whenever either cap
pushes `totalBottles` above the athlete's real bottle-cage count, "Reload strategy" below
automatically forces the Ziploc reload plan instead of ever recommending an over-strength,
undissolvable single bottle.

`BottlePlan.fuelBottles.concentrationPct` exposes the *actual achieved* per-bottle
concentration — computed independently of the caps above (`(maltodextrinGPerBottle +
fructoseGPerBottle) / bottleSizeMl × 100`), a transparent readout rather than one that
silently trusts the engine's own internal capping. `components/fueling-planner.tsx`
compares this against `HYPERTONIC_THRESHOLD_PCT` (12%, the widely-cited gastric-emptying
threshold) and renders a "Solución hipertónica" warning banner if it's ever exceeded. Under
every currently-supported bottle size this can't actually happen — `MAX_BOTTLE_CARB_CONCENTRATION`
above already keeps every generated recipe at ≤8% — so this is a defense-in-depth check, same
"explicit and independent even if it never currently fires" convention as the solubility
cap two paragraphs up, not a warning users are expected to routinely see.

### Reload strategy (Ziploc bags)

A road bike only has a small, fixed number of bottle cages — `athlete_profiles.bottle_count`
(1 or 2, also configured on the Profile tab) — and `getBottlePlan()`'s `totalBottles`
figure is a *nutritional* requirement, not a statement about what's physically mounted on
the bike at once. `getReloadStrategy({ bottlePlan, durationHours, distanceKm,
maxBottlesOnBike })` (`lib/metabolic-engine.ts`, `maxBottlesOnBike` defaulting to
`DEFAULT_MAX_BOTTLES_ON_BIKE` 2 if omitted) returns `null` whenever `totalBottles <=
maxBottlesOnBike` (no reload needed — refill-from-a-musette framing in the section above
is enough); otherwise it returns `startingBottleCount` (the real cage count, echoed back
so the UI never has to hardcode "2 bidones"), how many pre-measured Ziploc sachets to
carry (`totalBottles - maxBottlesOnBike`, each reusing the exact same per-bottle
malto/fructose/sodium grams `getBottlePlan()` already computed, so a sachet mixes into a
fresh bottle at the same safe 8% concentration), and when to stop: `reloadAtKm`/
`reloadAtHours` is the point the starting bottles would run dry, estimated as
`maxBottlesOnBike / totalBottles` of the way through the ride (assuming roughly even
consumption) — `reloadAtKm` only set in route mode, where a real distance exists.
`POST /api/fueling/plan` always calls this with the athlete's real
`athleteProfile.bottle_count` as `maxBottlesOnBike` — never the 2-bottle default — so the
reload trigger and `startingBottleCount` both reflect the rider's actual cage count (1 or
2), not an assumption. Rendered in `components/fueling-planner.tsx` as a numbered
"Estrategia de Recarga en Ruta" block (a `Fuel` icon in the header, only shown when
`reloadStrategy` isn't `null`), led by a one-line plain-language summary — "N bidón(es) en
bici + M dosis de recarga en maillot" — before the numbered "1. Inicio de ruta.../2. En el
maillot..." steps, so the headline takeaway doesn't require reading the full breakdown
first: `startingBottleCount` bottles at the start, N Ziploc bags in the jersey, and the
estimated stop point (marked with a `MapPin` icon).

**`isImpractical`** — a small bottle (e.g. 500ml, at the 8% concentration cap only ~40g of
carbs) combined with a long/high-carb ride can correctly compute a genuinely large sachet
count (verified live: a 5.6h ride at 60g/h with 500ml bottles needs 8 Ziploc bags) — the
arithmetic itself isn't wrong, but "mix in a new bottle 8 times mid-ride" isn't a plan a
rider would actually follow. Rather than capping or hiding that real number,
`ziplocBagsCount > MAX_PRACTICAL_ZIPLOC_BAGS` (4) sets `isImpractical: true`, and the UI
renders an additional warning line below the reload steps naming the actual constraint
(bottle size too small for this carb target) and two concrete ways out — bigger bottles,
or shifting more of the load to solid food/gels via Híbrido/Óptimo mode — rather than
silently presenting an unworkable reload schedule as if it were a normal recommendation.

### 3-point route weather sampling (start / summit / finish)

A single start-coordinate weather lookup silently assumes the whole route sits at that
altitude — overestimating temperature (and therefore sweat rate/sodium loss, see
`getFluidLossMlPerHour`/`getSodiumLossMgPerHour`) on a route that climbs into the
mountains, and missing whatever the actual high point's conditions are entirely.
`POST /api/fueling/plan` samples three real points instead, whenever it can:

1. **Inicio** — the route's start coordinates (`startLat`/`startLng`, already decoded from
   the route's polyline by `getStravaRoutes()`) at the departure time.
2. **Cota máxima / puerto** — `fetchRoutePeakPoint(accessToken, routeId)`
   (`lib/strava-routes.ts`) calls Strava's `/routes/{id}/streams` (a *second*, on-demand
   Strava call — only made when the athlete actually clicks "Calcular estrategia" for a
   route, never eagerly, so it doesn't add to passive Strava call volume) for the route's
   `altitude`/`latlng`/`distance` streams, finds the highest-altitude index, and returns
   that point's coordinates plus its `distanceFraction` (0-1) along the route. **Strava's
   route-streams endpoint always returns an array of `{type, data}` entries regardless of
   a `key_by_type` query param** (verified against the live API — unlike
   `/activities/{id}/zones`, which does honor equivalent keying), so `fetchRoutePeakPoint`
   finds each stream by `.find(s => s.type === "...")` rather than assuming a keyed
   object — getting this wrong silently returns `null` with no error (a 200 response with
   array data just doesn't match a keyed-object shape), which is exactly the failure mode
   hit and fixed while building this.
3. **Llegada** — the route's *end* coordinates (`endLat`/`endLng`, decoded from the last
   point of the same polyline in `fetchAthleteRoutes()`, alongside the already-existing
   start point) at departure + estimated duration.

Each point's estimated pass-through time is `departure + duration × distanceFraction`
(0 for start, the peak's own fraction, 1 for finish) — the same "distance fraction ≈ time
fraction" convention `getRouteSamplePoints()` already uses for post-ride sampling. The 3
points are passed straight to the existing `getWeatherForRoute()` (`lib/open-meteo.ts`,
shared with the post-ride sync flow), which now also returns `temperatureMaxC` (the
hottest of the sampled points) alongside its existing `temperatureAvgC`/`humidityAvg`.
**The average, not the max, still drives the fluid-loss calculation** — a peak reading
represents a genuinely brief stretch of the ride, not its whole duration, so sizing the
*entire* ride's sweat rate off the hottest single sample would systematically overshoot;
`temperatureMaxC` is surfaced to the UI as an informational "(máx X°C)" figure alongside
the average instead. When this 3-point sample succeeds, the response's
`weather.multiPointSample` is `true` and the older single-point `getLapseRateAdjustedTemperature()`
math correction is skipped entirely — a real altitude-based reading at the actual summit
makes that elevation-gain-based approximation redundant. Falls back gracefully at every
step (no `routeId`/end coordinates, no Strava connection, the streams call fails, or
Open-Meteo has no data for one of the 3 points) to the original single start-point
`getWeatherForDeparture()` reading plus the `getLapseRateAdjustedTemperature(baseTemperatureC,
elevationGainM)` correction (~6.5°C per 1000m, `LAPSE_RATE_C_PER_1000M`, using total
elevation gain as a proxy for how high the route's peak sits above its start, since
Strava's route summary doesn't expose real `elev_high`/`elev_low` the way a completed
activity does) — applied in route mode only (quick mode has no elevation data at all).
The response's `weather.lapseRateAdjustmentC` carries the signed correction (negative =
colder, `0` whenever the 3-point sample succeeded) so the UI can show a `Mountain` icon
plus "−X°C por altitud" next to the weather summary whenever it's non-zero, and
`weather.multiPointSample` drives an "inicio/puerto/llegada" note in that same summary
line when `true`.

### Seasonal average weather (departures beyond the forecast horizon)

The planner's `DeparturePicker` (see "Fueling planner" below) lets an athlete pick any
future date via "Elegir fecha," not just today/tomorrow — planning a target event or trip
weeks or months out is a real use case, and Open-Meteo's forecast endpoint has nothing to
say about a date that far out (`isBeyondForecastRange(departureIso)`, `lib/open-meteo.ts`,
`FORECAST_RANGE_DAYS` 14). `POST /api/fueling/plan` checks this *before* attempting any of
the 3-point/single-point forecast sampling above — for a departure beyond that horizon, it
skips forecast sampling entirely (which would otherwise just fail per-point against dates
Open-Meteo can't forecast) and calls `getSeasonalAverageWeather(lat, lng, referenceDate)`
instead: a "climate normal" built from the *same calendar day* (month/day) across the last
`SEASONAL_AVERAGE_YEARS_BACK` (5) years, queried from Open-Meteo's archive/reanalysis
endpoint in parallel and averaged — real historical data for that location and time of
year, not a fabricated placeholder. Deliberately a single representative point (the
route's start) rather than a multi-point sample, and rain is excluded from the estimate
entirely (a single historical day's rain is far too noisy a signal to average meaningfully
across only 5 years) — callers should treat this as dry. Returns `null` only if every
year's archive request failed, in which case the response falls through to the existing
fixed planning-default temperature/humidity, same graceful-degradation convention as
every other weather fallback in this codebase.

The response's `weather.source` gains a third value, `"seasonal_average"` (alongside the
existing `"dynamic"`/`"planning_default"`), which `WeatherImpactCard` reads to show "media
histórica estacional" in its summary line and an explicit micro-text below the stat grid
("Clima estimado mediante medias históricas estacionales — la fecha elegida está fuera del
rango de previsión en vivo (14 días).") rather than silently presenting a historical
average as if it were a real forecast. The elevation-gain lapse-rate correction (see
"3-point route weather sampling" above) still applies on top of this baseline exactly as
it would for any other single-point estimate, since a seasonal average is no more
altitude-aware than the single start-point forecast fallback it replaces in this branch.

### Weather Impact Card & dynamic thermal note

`components/weather-impact-card.tsx` (`WeatherImpactCard`) replaces the pre-ride planner's
old one-line weather summary with a small dedicated block: Temp/Viento/Humedad as three
`font-mono` stat readouts, plus the direct hourly hydration/sodium targets those
conditions translate to. Wind is new: `lib/open-meteo.ts`'s `getWeatherAtPoint`/
`getWeatherForDeparture` both now also request Open-Meteo's `wind_speed_10m` field
(`RouteWeather.windSpeedKmhAvg`/`DepartureWeather.windSpeedKmhAvg`, averaged across
whichever points were sampled — the 3-point start/summit/finish sample or the single
departure-window average) and `POST /api/fueling/plan` threads it through as
`weather.windSpeedKmh`. Wind is informational only — it doesn't feed
`getFluidLossMlPerHour`/`getSodiumLossMgPerHour`, which stay driven by temperature and
humidity exactly as before.

An earlier version reported an isolated percentage instead ("Tasa de sudoración
incrementada un +31% por estrés térmico", via a since-removed `getThermalImpactNote()`) —
a number with no unit of *what* is increasing and no actionable figure to act on. Replaced
with `WeatherImpactCard`'s own "Hidratación objetivo: X ml/h · Sodio objetivo: Y mg/h" line,
fed directly from the response's existing `fluidLossMlPerHour`/`sodiumMgPerHour` fields —
the same real per-hour targets the recipe is already built from, not a new computation.

### Household measures, dynamic ingestion timeline & scientific tooltips

Three more pure, no-I/O additions to `lib/metabolic-engine.ts`, all consumed directly by
`components/fueling-planner.tsx` from data `POST /api/fueling/plan` already returns — none
of them needed their own API round-trip:

- **`calculateHouseholdMeasures({ saltG, maltodextrinG, fructoseG })`** — converts the
  recipe's gram figures into kitchen-counter measures (`SALT_G_PER_TEASPOON` 5,
  `POWDER_G_PER_SCOOP` 30) for a rider mixing a bottle with no scale to hand. Always
  rendered *alongside* the gram figure, never instead of it (e.g. "29 g (~1 cazos)*"), with
  a fixed footnote ("*Equivalencias de referencia: 1 cazo = 30 g de polvo | 1 cdta. de café
  = 5 g de sal.") — applied to the total recipe, the per-bottle fuel-bottle breakdown, and
  the Ziploc reload dose, each computed independently from that block's own grams (a
  bottle's per-bottle scoop count isn't the total recipe's count divided evenly, since
  `getBottlePlan`/`getReloadStrategy` may round each bottle's share differently).
- **`generateTimingTimeline({ selection, durationHours, distanceKm, fluidLossMlPerHour,
  peakFraction })`** — unlike `getPocketFoodMilestones` (which just spreads every selected
  item evenly across the ride), this places each *kind* of food where it's actually most
  useful: `getHydrationIntervalMinutes(fluidLossMlPerHour)` (`max(10, min(20, round(180 /
  (L/h × 10))))`) as a standalone recurring sip-reminder frequency (not a point in time),
  slow-digesting solids (banana/energy bar/rice cake/dates + any custom entry) somewhere in
  the first third of the ride, fast-absorption gels from the halfway point through the
  finish, and one caffeine milestone (only on rides ≥1.5h) — always at or after 65% of the
  ride (`CAFFEINE_WINDOW_START_FRACTION`), midpoint of a fixed 65-75% window by default, or
  timed 45 minutes before the route's real elevation peak *only* when that peak sits in the
  second half of the ride (`peakFraction >= LATE_CLIMB_MIN_FRACTION`, 0.5) — `peakFraction`
  comes from the same `fetchRoutePeakPoint` distance fraction the 3-point weather sample
  above already resolves (or a parsed GPX's own peak, see below). An earlier version used
  the peak fraction directly with no lower bound, which meant a route whose highest point
  sits near the very start (a climb straight out of the departure point) could suggest
  caffeine as early as km 5 / minute 12 — defeating the entire point of a late-ride
  alertness boost; the 65% floor fixes that unconditionally, regardless of where any early
  climb sits. Returned as `timingTimeline` and rendered as a
  "Cronograma Dinámico de Ingesta" block: the hydration frequency line plus a chronological
  list of solid/gel/caffeine entries, each with a `lucide-react` icon and its km/min marker.
  Each entry's `label` is built from `pocketFoodLabels` (e.g. "Comer 🍙 Bollo de arroz..."),
  which keeps its emoji prefix for the clipboard/GPX export text — this on-screen list
  strips it at render time via `stripEmoji(entry.label)` (same "keep emoji in source data,
  strip only at the one on-screen render site" convention `pocketFoodName()` already uses
  for the pocket-food stepper rows), so the visible schedule reads "Comer Bollo de arroz..."
  with no emoji anywhere in the app's own UI chrome.
- **`getCarbRatioContextNote(carbsGPerHour)`** — the plain-language *why* behind whichever
  maltodextrin:fructose ratio `getMaltodextrinFraction` picked (reusing that function's own
  `HIGH_CARB_RATE_THRESHOLD_G_PER_HOUR`/`MODERATE_CARB_RATE_THRESHOLD_G_PER_HOUR`
  thresholds, now exported so both stay in sync), rendered via
  `components/fueling-context-tooltip.tsx`'s `FuelingContextTooltips` — a small `Info` icon
  next to the "Carbohidratos" stat with a hover/focus-revealed tooltip (pure Tailwind
  `group-hover`/`group-focus-within`, no tooltip primitive exists in `components/ui` yet).

### Carb-loading protocol (Día −1)

`getCarbLoadingTarget(weightKg)` returns the classic 8-10g/kg carb-loading target for the
day before a long/target event, plus three fixed low-fiber, low-fat/protein guidelines
(`CARB_LOADING_GUIDELINES` — static advisory copy, not computed). `POST /api/fueling/plan`
only includes this in the response (`carbLoading: null` otherwise) when
`durationHours > 3.5` or the planner's optional "Ruta objetivo / Competición" checkbox
(`isTargetEvent`) is checked — shown in the UI as a collapsible native `<details>` block
so it doesn't add visual weight to rides that don't need it. `isTargetEvent` also forces
`getHomeLabRecipe()`'s `forceHighCarbRatio` — the 1:0.8 near-maximal maltodextrin:fructose
split (see "Metabolic engine" above) applies unconditionally rather than only above 75g/h,
since squeezing out the last few g/h of dual-transporter absorption is worth it on a target
event regardless of the ride's own carb rate. The checkbox shows a micro-text explaining
this exact adjustment ("Ajustado a ratio Fructosa:Maltodextrina 1:0.8 y límite máximo de
absorción por alta intensidad...") once checked — the "límite máximo de absorción" half
refers to the gut-training cap that already applies to every calculation (see "Gut Training
Scale" below), not something newly toggled by this checkbox.

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
  (`{ mode: "route", distanceKm, elevationGainM, startLat, startLng, endLat, endLng,
  routeId, intensity, departureIso, isTargetEvent, pocketFood, fuelingMode }`, using
  `estimateRideDurationHours()` for the duration and a named intensity level for the
  target %FTP) or quick mode (`{ mode: "quick", durationHours, averageWatts, departureIso,
  isTargetEvent, pocketFood, fuelingMode }`, using the real watts directly via
  `getRelativeIntensity()`) — see "Fueling mode selector" below for what `fuelingMode` does
  — `pocketFood` is sanitized via a route-local `sanitizePocketFoodSelection()` (unknown
  keys/non-positive quantities silently dropped, same "degrade gracefully" convention as
  `getStravaRoutes()` returning `[]`) rather than trusted as-is. Dynamic weather is only
  sampled in route mode (needs start coordinates); quick mode always uses the fixed
  "typical training day" planning default (22°C/55% humidity) — route mode additionally
  samples the route's real summit and applies a lapse-rate fallback (see "3-point route
  weather sampling" above) before computing fluid/sodium loss. Re-fetches
  `ftp`/`weight_kg`/`sweat_rate`/`gut_training_level`/`athlete_type` from
  `athlete_profiles` server-side rather than trusting client-supplied values, runs the
  intensity-driven carb target through `getGutCappedCarbTarget()` before building the
  recipe (so the recipe itself never recommends more than the athlete's gut can handle),
  subtracts the pocket-food carb total before splitting into malto/fructose (see "Hybrid
  nutrition" above), and logs the resulting totals to `fueling_logs` (`kind: 'pre_ride'`)
  on every successful calculation — see "Weekly Performance Panel" below. The response also
  carries `totalRideCarbsG` (the unadjusted target, for the UI's "covers X of Y" line),
  `pocketFoodCarbsG`, `bottlePlan`, `reloadStrategy`, `nutritionMilestones`,
  `timingTimeline`, `netCarbDeficit`, and `carbLoading` (see their respective sections
  above) alongside the original recipe/weather/gut-training fields. Route mode also accepts
  an optional `durationHoursOverride` (skips `estimateRideDurationHours()` entirely when
  present) and optional `peakLat`/`peakLng`/`peakDistanceFraction` (used instead of calling
  `fetchRoutePeakPoint()` when present) — both exist for the GPX Híbrido uploader below,
  which has neither a Strava `routeId` nor an FTP-based duration to estimate from, but
  reuses every other piece of route-mode's pipeline unchanged.
- **`components/fueling-planner.tsx`** (`"use client"`) — the interactive planner UI:
  a route/quick/GPX mode toggle (see "GPX Híbrido parser" below for the third), a route
  `<select>` (built from the routes passed down as props) or duration+watts inputs, a
  `DeparturePicker` quick-select — a 3-way `Hoy`/`Mañana`/`Elegir fecha` segmented control
  (`DepartureDayMode`) plus a plain hour `<select>` (`DEPARTURE_HOUR_OPTIONS`, 05:00-20:00
  hourly), replacing an earlier plain `datetime-local` input. The two quick pills only ever
  cover the next day, which doesn't fit planning a real event or trip weeks/months out —
  `Elegir fecha` reveals a native `<input type="date">` (`min` floored at today) for that
  case, with no upper bound on how far out it can be set. `buildDepartureLocal(dayMode,
  customDate, hour)` combines whichever mode is active into the same local datetime string
  the calculation request expects, so nothing downstream of `departureLocal` needed to
  change — the pocket-food catalog (see "Hybrid nutrition"
  above), an optional "Ruta objetivo / Competición" checkbox (`isTargetEvent`, with a
  micro-text explaining its real effect once checked — see "Carb-loading protocol" above),
  and a result panel rendering whatever `/api/fueling/plan` returns — carb/sodium targets,
  the DIY recipe with its bottle architecture and pocket-food coverage line, the Net Carb
  Deficit breakdown (see "Net Carb Deficit" above), the reload-strategy block when
  applicable, which weather source was used (`dynamic` vs `planning_default` vs
  `seasonal_average` — see "Seasonal average weather" below, plus the
  lapse-rate note when non-zero), a "Gut Training" warning banner whenever
  `gutTraining.isGutLimited` is true, the collapsible carb-loading module when applicable,
  and the nutrition-export button (see "Nutrition export" below) — see "Result panel visual
  hierarchy" below for how these are actually arranged on screen.

### Result panel visual hierarchy (Hero card + collapsible technical breakdown)

The result panel used to be one long flat column of same-weight text — every section from
weather to the reload plan competed for the same attention, so the actual headline numbers
(what to mix, how often to drink, whether it's working) were no easier to find than any
supporting detail. Restructured around a "glance vs. dig deeper" split instead:

- **Hero card** — a dark (`bg-[#343334]`, a literal one-off brand-charcoal fill, not a
  reusable token — same convention as `components/app-logo.tsx`'s and Strava's own
  `#FC4C02` one-off hex usages elsewhere in this app) card rendered first, directly under
  the result header. Shows only the four numbers an athlete actually needs mid-prep: the
  per-bottle malto/fructose dose in the brand's bright orange (`text-[#FD5A08]` —
  deliberately not `--terracotta`, which is this app's muted UI accent color; this is the
  one spot that intentionally pops with the brighter mark color instead), the hydration
  frequency, the finishing glycogen battery %, and the money saved. Falls back to
  "Cobertura completa vía comida de bolsillo" instead of a nonsensical "0g Malto + 0g
  Fructosa" line whenever `bottlePlan.fuelBottles.count` is `0` (pocket food alone covers
  the ride — see "Hybrid nutrition" above).
- **OBJETIVO / EN BOLSILLO / DÉFICIT EN BIDÓN progress bar** — replaces three separate
  badge pills with a single two-segment rail (`bg-sage` for the covered fraction,
  `bg-terracotta/20` for the remainder) plus the three raw figures above it. Stacks to one
  column below `sm:` — an earlier three-column-with-`truncate` version cut the numbers
  themselves off on a narrow phone (verified: "DÉFICIT EN BIDÓN 336g HC" truncated to
  "DÉFICIT EN …"), which defeats the entire point of a scannable metric; letting each
  figure take its own full-width row instead never truncates, at the cost of a slightly
  taller block on mobile only.
- **Comida de bolsillo en maillot accordion** — the pocket-food catalog/stepper grid (see
  "Hybrid nutrition" above) is now behind a `<details>` closed by default, headed by a
  live "N items · Mg HC" summary computed from `getPocketFoodTotalCarbsG()` against
  whichever selection is actually in effect (the athlete's own `pocketFood` state in every
  mode except Óptimo, where it's `result.pocketFood` — the server-computed selection —
  since the athlete never edits it there).
- **Collapsible technical breakdown** — the DIY recipe + bottle architecture (+ the
  hypertonic-concentration warning, when it fires), the dynamic ingestion timeline, and
  the reload strategy (when applicable) are each their own `<details>`, closed by default,
  alongside the pre-existing carb-loading `<details>`. Weather, the duration/carbs/sodium
  stat row, the gut-training warning, and the no-fuel-vs-with-recipe battery comparison
  stay always-visible above the accordions — compact enough already, and each one is a
  quick safety/sanity check an athlete would want without an extra tap. The standalone
  "Ahorras X €" banner that used to sit between the reload strategy and the carb-loading
  module was removed outright rather than folded into an accordion — it's the same figure
  the Hero card already shows at the top, so keeping both was pure duplication working
  against the whole point of this pass.
- **Nested "Copiar receta" button inside the recipe accordion's `<summary>`** — a native
  `<details>`/`<summary>` toggles open/closed on any click within the summary, which would
  otherwise also collapse the accordion every time the copy button is pressed. Its
  `onClick` calls `e.stopPropagation()` before `handleCopyRecipe()` so the click never
  reaches the summary's own toggle handler — verified live (clicking "Copiar receta"
  leaves the accordion open both before and after the click).
- Every new accordion reuses the exact chevron pattern (`ChevronDown` rotated via
  `group-open:rotate-180` on a `<details className="group">`) rather than the plain
  browser-native disclosure triangle the pre-existing carb-loading `<details>` uses — a
  deliberate visual upgrade applied consistently across all the *new* accordions, though
  the carb-loading one was left as-is rather than restyled purely for consistency's sake
  on a pass that wasn't asked to touch it.

### GPX Híbrido parser (auto-cálculo + tiempo editable)

A third planner mode for a route with no Strava presence at all — somewhere the athlete's
never ridden, or a route file shared by someone else — sitting alongside "Ruta guardada de
Strava"/"Calculadora rápida" as "Subir GPX":

- **`lib/gpx-import.ts`** — `parseGpxFile(xmlText, fileName)`, pure client-side parsing via
  the browser's own `DOMParser` (no server round-trip needed for the geometry itself).
  Extracts `trkpt` coordinates (falling back to `rtept` for a planned-route-only file with
  no track), sums consecutive-point haversine distances for `distanceKm`, sums positive
  elevation deltas for `elevationGainM`, and — critically, unlike a Strava route's summary
  polyline, which has no per-point altitude and needs a second Strava API call
  (`fetchRoutePeakPoint`) to locate the summit — finds the track's own highest-elevation
  point locally, returning it plus its distance fraction along the route
  (`peakLat`/`peakLng`/`peakDistanceFraction`) with zero extra network calls. Returns
  `null` (never throws) for a file with fewer than 2 usable coordinates or malformed XML.
- **`fetchAthleteStats(accessToken, athleteId)`** (`lib/strava.ts`) calls Strava's
  `/athletes/{id}/stats`, and **`getAthleteAverageSpeedKmh()`** (`lib/dashboard-data.ts`,
  cached, auth-aware like `getStravaRoutes()`) turns its `recent_ride_totals`
  (preferred — the athlete's *current* pace, last 4 weeks) or `all_ride_totals`
  (fallback) into a plain km/h figure (`distance / moving_time × 3.6`). `null` (never a
  fabricated number) when Strava isn't connected or the athlete has no ride history yet —
  `FuelingPlannerSection` (`app/(app)/page.tsx`) fetches this alongside `getStravaRoutes()` and
  passes it into `<FuelingPlanner avgSpeedKmh={...} />`.
- A GPX upload's estimated duration is `distanceKm / avgSpeedKmh` (a fixed
  `FALLBACK_AVG_SPEED_KMH` of 25km/h when `avgSpeedKmh` is `null`, with an explicit "sin
  historial de Strava suficiente" note so the athlete knows it's generic) rather than
  `estimateRideDurationHours()`'s FTP/W-per-kg heuristic — a GPX file has real distance but
  no power-target relationship the way a saved Strava route + intensity level does.
  Rendered as an editable "Tiempo Estimado" number input (`Pencil` icon, a live `formatHoursMinutes()`
  caption alongside it), pre-filled with the estimate but freely overridable — whatever
  value is in that field at "Calcular estrategia" time is sent as `durationHoursOverride`
  in the request body (see "Fueling planner" above), so an edit takes effect on the next
  calculation exactly like every other planner input (this codebase's established
  button-triggered-recompute convention, not a live per-keystroke recalculation).
- The uploaded file's own `peakLat`/`peakLng`/`peakDistanceFraction` are sent alongside
  `distanceKm`/`elevationGainM`/`startLat`/`startLng`/`endLat`/`endLng` as `mode: "route"`
  (no `routeId`) — `POST /api/fueling/plan` prefers a client-supplied peak point over
  calling `fetchRoutePeakPoint()`, so the 3-point start/summit/finish weather sample (see
  above) works identically for a GPX upload as for a real saved Strava route.
- Deliberate scope boundary: a GPX upload has no Strava route id, so
  `handleDownloadGpx()`'s condition (`mode === "route" && selectedRoute?.summaryPolyline`)
  is never true for this mode — nutrition export falls back to the clipboard/Garmin-text
  path (see "Nutrition export" below) rather than regenerating a course GPX from the
  athlete's own uploaded track, which was out of scope for this pass.
- **Bug fixed alongside the map preview below**: the route/quick-mode input block was a
  plain `mode === "route" ? <route fields> : <quick fields>` ternary from before GPX mode
  existed — once GPX became a third `mode` value, that `: <quick fields>` else-branch
  silently rendered the quick-calculator's Duración/Vatios/Salida fields *underneath* the
  GPX dropzone too (any non-"route" mode fell into it). Fixed to
  `mode === "route" ? ... : mode === "quick" ? ... : null`, so GPX mode shows only its own
  dedicated fields.

### Route map preview (`RouteMapPreview`)

`components/route-map-preview.tsx` renders the actual shape of the selected Strava route
or uploaded GPX track — a distance/elevation figure alone doesn't tell an athlete whether
a ride is a flat loop or a mountain out-and-back the way seeing its line on a map does.
Format-agnostic by design: it takes already-decoded `points: [number, number][] | null`
regardless of source, so it doesn't need to know whether they came from a Strava
`summary_polyline` or a GPX file.

- **`lib/polyline.ts`** — `decodePolyline()` moved here (from `lib/strava.ts`, which
  re-exports it for every existing import) since it has no `"server-only"` marker,
  unlike `lib/strava.ts` — a client component decoding a Strava route's polyline for the
  map can't import from a `"server-only"` file at all (`lib/strava.ts` throws at build/
  bundle time if pulled into client code). `lib/gpx-import.ts`'s `ParsedGpxRoute` gained
  its own `points: [number, number][]` field for the same reason in the other direction —
  a GPX file already has every coordinate in hand locally, no decoding needed at all.
- **Leaflet + `react-leaflet`** (added as real dependencies — no lightweight alternative
  covers "pannable tile map with a fitted polyline" as directly) render the map itself:
  `MapContainer`/`TileLayer`/`Polyline`, plus a small `FitBoundsToRoute` child component
  that calls the underlying Leaflet map's `fitBounds()` imperatively via `useMap()` inside
  a `useEffect` — `react-leaflet` has no declarative "fit to these bounds" prop, so this
  is the documented pattern for it. Tile layer is CartoDB Positron (`light_all`) — a clean,
  low-saturation basemap with no busy POI icons/labels to compete with the route line,
  which is drawn in the app's own terracotta accent (`#C85231`) rather than Leaflet's
  default blue.
- **Must be dynamically imported with `ssr: false`, never statically**: Leaflet reads
  `window`/`document` at module scope, which breaks Next's server-render pass for the
  initial HTML — this is true even inside a `"use client"` file, since every client
  component still renders once on the server unless its *import* is wrapped in
  `next/dynamic(..., { ssr: false })`. `components/fueling-planner.tsx` does this once at
  module scope (`const RouteMapPreview = dynamic(() => import(...), { ssr: false, loading:
  () => <Skeleton .../> })`) rather than at every call site.
- Rendered directly below the "Ruta" `<select>` in route mode (decoding
  `selectedRoute.summaryPolyline` via a `useMemo`, re-decoded only when the selected route
  changes — a long ride's polyline can be a few hundred points) and directly below the GPX
  dropzone in GPX mode (using the parsed file's own `points` — `null` before any file is
  selected, which is what triggers the component's built-in neutral placeholder: "Selecciona
  una ruta de Strava o sube un GPX para visualizar el trazado."). Not shown in quick-
  calculator mode, which has no geographic data at all. A floating `bg-white/90
  backdrop-blur-sm` badge in the map's bottom-left corner echoes the same distance/D+
  figures the route `<select>`/GPX filename line already show, for at-a-glance reference
  without needing to scroll back up.
- **Stacking-context isolation**: Leaflet assigns its own internal panes/controls
  z-indexes up to `1000` (tile pane, overlay pane, the zoom `+`/`−` control, etc.) —
  comfortably higher than this app's own chrome layers, which meant the map's zoom
  buttons rendered *on top of* the mobile sidebar drawer (`components/dashboard-shell.tsx`)
  whenever both were visible at once, since the drawer's `z-40`/`z-50` never had to
  compete with anything above `z-50` before Leaflet arrived. Fixed two ways together: the
  drawer's backdrop and `<aside>` were bumped to `z-9999`/`z-10000` (comfortably above
  Leaflet's own internal max), and independently, `RouteMapPreview`'s outer container
  gained `relative z-0 isolate` — `isolate` (`isolation: isolate`) gives the map its own
  stacking context so none of Leaflet's internal z-indexes can ever escape upward past
  their own container in the first place, regardless of what other z-index this app's
  chrome uses in the future. Belt-and-suspenders: either fix alone would have solved the
  immediate bug, but only the `isolate` containment is robust against a *future* z-index
  regression elsewhere in the app.

### No cost/savings framing

The app deliberately carries no euro/price comparison anywhere — an earlier pass had a
"Ahorras X € frente a geles comerciales" figure (`getMoneySavedVsGels()` in
`lib/metabolic-engine.ts` and a Hero Card line) that was removed outright: the product is
meant to read as precision nutrition/performance science, not marketing/savings framing,
and a cost-comparison figure competing for attention with the actual physiological numbers
undercut that. `fueling_logs.money_saved` was dropped to nullable (`ALTER TABLE
fueling_logs ALTER COLUMN money_saved DROP NOT NULL`) once the feature was fully removed,
so `logFuelingPlan()` (`lib/fueling-logs.ts`) no longer writes to it at all — no vestigial
field threaded through for a column that no longer requires one.

### Offline strategy cache ("Modo Cobertura Limitada")

A rider is often planning or re-checking their fueling strategy with poor or no signal —
climbing into the mountains before a descent to reception, or on the exact ride the
strategy is for. `FuelingPlanner` writes every successfully calculated result to
`localStorage` under `last_fueling_strategy` (in `handleCalculate`'s success branch,
immediately after `setResult`), wrapped in a try/catch since `localStorage` can throw in
private browsing or when quota is exceeded — the whole point is graceful degradation, so a
storage failure there must never break the just-completed calculation. On mount, and again
on the browser's own `offline` event, a `useEffect` checks `!navigator.onLine` and — if
true and a cached entry exists — loads it via `setResult(JSON.parse(cached))` and sets
`isOfflineCache`, which renders a small "⚡ Estrategia guardada en caché (Modo Offline)"
badge above the result panel. This is `localStorage`-only, not a service worker: it covers
a tab that's already open and loses signal mid-session (the `offline` event fires
regardless of remounting), and any fresh load where the browser still happens to have the
JS bundle cached — but a true offline *document* reload (no service worker registered)
can't work at all, since the browser can't fetch the HTML itself without a network
connection. That's a deliberate scope boundary: this feature is the readable, low-effort
`localStorage` fallback that was asked for, not a full offline-first PWA rebuild.

### Nutrition export: clean GPX course + clipboard fallback

Route mode has real ride geometry to export; quick mode doesn't — the export button
switches mechanism accordingly rather than pretending both modes are the same. An earlier
version injected a `<wpt>` per nutrition milestone/reload stop into the downloaded GPX —
removed outright: a GPS course file is for navigation, and a one-shot waypoint doesn't
even match how nutrition timing actually works (a recurring interval, not a single point
on the map) — the head unit's own native repeating alert is the correct mechanism for that,
not a fake waypoint standing in for a turn. `lib/gpx-export.ts`'s `buildRouteGpx()` (pure,
renamed from the old `buildNutritionGpx()`) now writes only a `<trk>` of the route itself,
nothing else.

- **Route mode (`selectedRoute.summaryPolyline` present)** — "Descargar GPX de la ruta"
  downloads an actual `.gpx` course file. `lib/strava-routes.ts`'s `StravaRoute` carries
  the route's raw `summaryPolyline` string alongside its already-decoded start point (free
  — it's already in the `/athlete/routes` list response, no extra Strava call).
  `POST /api/fueling/gpx` (auth-checked like every other route, but doesn't need the
  athlete's profile data) decodes it via the existing `decodePolyline()` (`lib/strava.ts`)
  and passes the coordinates straight to `buildRouteGpx()` — no milestones/reload-strategy
  data is even sent in the request body anymore. The client (`handleDownloadGpx()`)
  triggers the download via a `Blob` + object URL + a temporary `<a download>` click — no
  server-rendered redirect, since this is a binary file response, not a JSON API.
- **Quick mode (no route/polyline)** — falls back to the original clipboard-text export:
  "Exportar a Garmin / Wahoo / Strava" copies `formatGarminExportText()`'s plain-text
  "ficha técnica" (fixed 15-min frequency-alarm reminder, g/h carb/sodium targets, and a
  "📍 Hitos de Nutrición" list built from `nutritionMilestones` plus the reload stop) via
  `navigator.clipboard.writeText()`, flipping to "✓ Ficha copiada" for 2s — the same
  clipboard-plus-flip-label pattern as "Copiar Receta," with its own `exportCopied` state.
  This text-only mechanism is unaffected by the GPX cleanup above — it was never writing
  into an actual navigation file, just a note the athlete pastes wherever's convenient.

A fixed guidance line ("Configura en tu GPS las Alertas Nativas de Comer/Beber con
temporizador repetitivo de 15 o 20 min — el GPX de la ruta es solo para navegación.", with
an `AlarmClock` icon) always renders under the export button regardless of mode — this is
now the *only* mechanism this app recommends for in-ride nutrition timing on a real head
unit, the GPX file itself carrying none of it.

- **"Copiar Receta"** — a button next to the recipe header calls
  `navigator.clipboard.writeText()` with the output of
  `formatRecipeForSharing()` (`lib/metabolic-engine.ts`, pure/no I/O like the rest of the
  engine): a plain-text summary with exact per-bottle grams (not just totals) so it's
  readable pasted into WhatsApp/Notes or read straight off the phone at the kitchen
  counter. The button label flips to "✓ Receta copiada" for 2s (local `copied` state,
  `setTimeout`-reset) instead of a separate toast element.

### Gut Training Scale

The gut's carb-absorption rate is itself trainable — a rider who's never practiced fueling
at 90g/h will likely feel GI distress even if their legs/lungs could support that
intensity, so recommending more than the gut can currently handle just causes distress
without extracting more usable energy. `athlete_profiles.gut_training_level` caps the
*recommendation*, never the ride's own demands:

- **`getGutTrainingCapGPerHour(level)`** — the upper bound of each level's advertised
  range (`gutTrainingLevelRanges`, shown in the Physiological Profile tab): beginner 50,
  intermediate 75, advanced 90, pro 120 g/h.
- **`getGutCappedCarbTarget(relativeIntensity, gutTrainingLevel, athleteType?)`** —
  computes the ride's uncapped, phenotype-adjusted target via
  `getPersonalizedCarbOxidationRateGPerHour`, then clamps it to the level's cap. Returns
  both figures plus `isGutLimited` so callers can show the didactic warning ("Tu intestino
  está limitado a X g/h...") exactly when the ride would otherwise have called for more.
- Used by `POST /api/fueling/plan` (see above) — the DIY recipe is always built from the
  *capped* figure, so a beginner's bottle is never scaled to more carbs than they can
  currently absorb, even for a hard ride.

### Post-Ride Analysis

**`POST /api/post-ride/analysis`** — given an `activityId` (the athlete's own, ownership
checked via `activities.profile_id`), computes that specific ride's "Deuda de Glucógeno"
and a macro recovery target, preferring the most precise data source available and
falling back gracefully:

1. **Real time-in-power-zone data** — `fetchActivityPowerZones()` (`lib/strava-zones.ts`)
   calls Strava's `/activities/{id}/zones`, returning `null` (not throwing) on a 404/no-
   scope/not-configured response. If present, `getGlycogenBurnedFromPowerZones()` gives
   the most accurate glycogen figure (`source: 'zones'`).
2. **Heart-rate estimate ("Plan A")** — if zones aren't available, `fetchActivityDetail()`
   (`lib/strava.ts`) pulls the activity's `device_watts`/`has_heartrate`/
   `average_heartrate`/`max_heartrate` straight from Strava's `/activities/{id}` (again
   `null`-on-failure, never throwing). When the ride genuinely has no power meter
   (`device_watts` false) but does have heart-rate data, `getGlycogenBurnedFromHeartRate()`
   estimates intensity from %HRmax (`averageHeartrate / maxHeartrate`, using the ride's own
   `max_heartrate` as a same-ride proxy for true HRmax) and feeds it through the same
   oxidation-rate bands as every other estimate in this file (`source: 'heartrate'`) —
   preferred over trusting Strava's own *estimated* wattage, since real HR reflects actual
   physiological effort. `getRelativeIntensityFromHeartRate()` guards against a zero/
   missing `maxHeartrate` so this can never divide by zero and return `NaN`.
3. **Ride-average watts ("Plan B")** — if there's no zones data and either the ride does
   have a real power meter or there's no HR data either, falls back to the same
   `getRelativeIntensity` + `getGlycogenBurnedGrams` path the sync route already uses
   (`source: 'average_watts'`) — `average_watts` here may be real or Strava's own
   speed/grade-estimated figure, whichever Strava actually returned.

All three paths thread the athlete's `athlete_type` (see "Metabolic phenotype"
below) through to `getGlycogenBurnedFromPowerZones`/`getGlycogenBurnedFromHeartRate`/
`getGlycogenBurnedGrams`, defaulting to `"balanced"` if unset, so the "Deuda de Glucógeno"
figure reflects the same diesel/balanced/explosive adjustment the pre-ride planner
applies.
4. **Stored sync-time figure** — if none of the above work, falls back to whatever
   `activities.carbs_burned_g` was already computed at sync time (`source: 'stored'`).
5. **Self-reported RPE ("Plan C")** — a genuinely sensor-less ride (no power meter, no
   heart-rate strap, and nothing usable was even stored at sync time) has no real data
   left to fall back to — the one remaining source of a real number is the rider telling
   the app how hard the ride felt. If the request body includes an `rpeLevel` (one of
   `"endurance" | "tempo" | "threshold"` — deliberately only 3 of the 5 `IntensityLevel`
   values the pre-ride planner offers, since a post-hoc "how did that feel" reads as
   Suave/Moderado/Duro, not 5 finely graded target-power zones chosen in advance),
   `getRelativeIntensityFromLevel(rpeLevel)` feeds the same `getGlycogenBurnedGrams` path
   every other tier uses (`source: 'rpe'`) — needs no FTP at all, unlike zones/Plan B,
   since the intensity comes directly from the self-reported level rather than a %FTP
   figure derived from real watts.
6. **`needs_rpe`** — if none of tiers 1-5 produced a number and no `rpeLevel` was given
   yet, the route returns this (not `no_data`) specifically so the client renders the RPE
   picker instead of a dead-end error message — there's still a path to a real number, it
   just needs one more piece of input from the rider. `components/post-ride-analysis.tsx`
   resubmits the exact same request with `rpeLevel` added the moment a picker button is
   clicked. **`no_data`** is now reserved for the one case even RPE can't save: the
   resulting figure somehow isn't finite (the route explicitly checks
   `Number.isFinite(carbsBurnedG)` before ever returning a result), which given the RPE
   math's inputs should never actually happen in practice.

**Empty state** — `PostRideAnalysis` (`components/post-ride-analysis.tsx`) renders a
prompt to sync rather than a bare "sin actividades" line when `activities.length === 0`:
short copy plus the exact same `<SyncForm />` (`components/sync-button.tsx`) the Dashboard
header's own "Sincronizar Strava" button uses, reused as-is rather than a second
hand-rolled fetch/toast implementation — a first-time visitor with nothing synced yet gets
a real, working sync action right in "Al llegar" instead of only in the header.

### Telemetry card: graceful degradation for missing sensors

Before the "Deuda de Glucógeno" breakdown itself, the result panel now opens with a
**"Ruta sincronizada desde Strava" telemetry summary** — a bordered `bg-surface` block
led by a small emerald status pill (a colored dot + text, not a literal 🟢 glyph, matching
this app's no-emoji convention — see `athleteTypeLabels`/historial's compliance badges)
plus the ride's name and date, then a `grid-cols-2 sm:grid-cols-4` row of Distancia (+D+),
Tiempo en movimiento (`formatHoursMinutes()`, a small local duplicate of
`fueling-planner.tsx`'s own file-local helper of the same name — both are 4-line pure
formatters, not worth sharing a module over), Potencia (+NP when available), Gasto
energético, and Frecuencia cardíaca — with a fixed footer note ("Cálculo de deuda
metabólica generado a partir de la telemetría real de tu ciclocomputador."). This
supersedes the narrower 3-stat (Energía/Potencia/FC) "Telemetría" block that used to sit
*after* the glucógeno numbers — removed outright rather than kept alongside the new card,
since every figure it showed is now covered (plus distance/elevation/time, which it
didn't have) by the summary at the top; showing both would have been pure duplication.
`elevationGainM` is a new field on `POST /api/post-ride/analysis`'s `activity` response
object (Strava's `total_elevation_gain`, already read server-side for the energy-estimate
formula below, just not previously returned to the client).

The same response also carries a `telemetry` object — the *raw* sensor readings
themselves (energy, power, heart rate), a separate concern from which tier above actually
produced `carbsBurnedG`. `fetchActivityDetail()` (`lib/strava.ts`) is now always called
when there's a valid Strava token, not only when the zones/FTP path is unavailable, since
a rider whose glycogen figure came from real power-zone data might still want to see
their actual average heart rate from that same ride:

- **Energía** — `kilojoules` (Strava's own figure for a power-meter ride) if present,
  else `calories` (Strava's metabolic-energy estimate, present far more often since it
  doesn't need a power meter), else a last-resort formula
  (`hours × (weightKg × 10) + elevationGainM × 0.75`) when Strava has genuinely nothing —
  `energySource` (`"kilojoules" | "calories" | "estimated"`) tells the UI whether to show
  the "Estimado" tag. Roughly, kilojoules of mechanical work ≈ kcal burned for a cyclist
  is a widely-used coaching approximation, not a clinical conversion — same
  "heuristic, not clinical" convention as the rest of `lib/metabolic-engine.ts`.
- **Potencia** — `deviceWatts === true` shows the real ride-average watts plus Normalized
  Power (`weightedAverageWatts`, only ever meaningful for a real power-meter ride) when
  Strava returned one; `deviceWatts === false` with a non-null `average_watts` shows that
  same figure tagged "Estimado" (Strava's own speed/grade/weight-derived guess, not a real
  power meter); no wattage at all renders a clean "N/A" — plus the RPE level the rider
  picked, when that's what actually produced the glycogen figure (`powerSource: "device" |
  "estimated" | "none"`).
- **FC media** — the ride's real `average_heartrate` if Strava has it, else a clean
  "-- ppm" rather than a blank cell or a `NaN` — verified live with a fully mocked
  sensor-less response (`powerSource: "none"`, `heartrateAvg: null`) that the card renders
  as "N/A" / "-- ppm" without disturbing the surrounding grid, and with three other mocked
  variants (real device power + NP, Strava-estimated watts, real heart rate) all rendering
  correctly with zero `NaN` anywhere on the page.
- **NaN safety** — `athlete_profiles.weight_kg` is `NOT NULL` in the schema, but the energy
  formula still falls back to a `FALLBACK_WEIGHT_KG` (70) constant rather than trusting
  that guarantee blindly, and `activity.total_elevation_gain` defaults to `0` — neither
  value the energy formula multiplies against can ever be `null`/`undefined`.

Fluid/sodium loss for the ride reuses its *stored* `humidity_avg`/`temperature_avg`
(the real weather sampled at sync time) with the athlete's current `sweat_rate`. The
route computes an initial `recoveryTarget` assuming zero in-ride intake (see "Net
recovery debt" below for why the client immediately recomputes this live), and returns
`weightKg` alongside it so the client can rerun the same math locally. Logs to
`fueling_logs` (`kind: 'post_ride'`, `activity_id` set) — but only the *first* time this
activity is analyzed (`hasPostRideLog()` check in `lib/fueling-logs.ts`), so re-viewing
the same past ride's analysis doesn't inflate the lifetime totals; the logged figures are
always the ride's raw `carbsBurnedG`/`fluidLossMl`/`sodiumLossMg` (physiological burn/
loss), never the net debt, since the debt is a volatile, user-editable, post-hoc quantity
and the append-only log is written once, likely before the athlete has entered any
consumption data at all. `components/post-ride-analysis.tsx` (`"use client"`) is the UI:
an activity `<select>` (defaulting to the most recent) plus an "Analizar" button
(matching the same manual-trigger interaction pattern as the pre-ride planner rather than
auto-fetching on mount), and — once analyzed — the net-debt breakdown and recovery-target
grid described next.

#### Net recovery debt ("¿Qué consumiste realmente durante la ruta?")

A ride's raw burn/loss figures overstate what's actually left to replace whenever the
rider fueled *during* the ride itself (bottles, gels, electrolyte tabs) — recommending a
full post-ride carb/fluid/sodium target on top of in-ride intake would double-count
whatever was already consumed. `lib/metabolic-engine.ts` splits this into two pure
functions, both safe to call from the client with zero network round-trip (this file's
long-standing "no I/O, safe from client or server" contract, already used by
`fueling-planner.tsx`):

- **`getRecoveryDebt({ carbsBurnedG, carbsConsumedG, fluidLossMl, fluidConsumedMl,
  sodiumLossMg, sodiumConsumedMg })`** — nets each burned/lost figure against what was
  actually consumed, floored at 0 (a rider who drank more than they sweat out doesn't get
  a "negative" debt, they just don't have one). Fluid is scaled by the existing
  `POST_RIDE_FLUID_REPLACEMENT_FACTOR` (~120%, ACSM-style post-exercise rehydration
  guidance) *before* netting against what was drunk, since the deficit itself — not the
  raw sweat figure — is what needs replacing. Returns `{ carbsDebtG, fluidTargetMl,
  fluidDebtMl, sodiumDebtMg }` — `fluidTargetMl` (the post-replacement-factor figure,
  pre-subtraction) is exposed specifically so the UI can render the "GASTADO" side of the
  equation without hardcoding the 1.2 multiplier itself.
- **`getMacroRecoveryTarget({ weightKg, recoveryDebt })`** — restructured to take a
  `RecoveryDebt` instead of raw burn/loss figures. Carbs are capped at the lower of
  `recoveryDebt.carbsDebtG` or a ~1.2g/kg ceiling (replacing more than was actually burned
  doesn't speed glycogen resynthesis, it's just extra calories); fluid and sodium targets
  are the net debt figures directly. Protein (~0.35g/kg, clamped 22-35g) and fat limit
  (~0.15g/kg, clamped 10-20g) are untouched by in-ride consumption — they're about muscle
  repair and gastric-emptying speed, not about replacing a measured deficit, so consuming
  more carbs/fluid on the bike doesn't change how much protein the post-ride window calls
  for.

`components/post-ride-analysis.tsx` renders three consumed-input rows (Carbohidratos g,
Agua L, Sodio mg — all starting at 0, reset to 0 on every fresh `handleAnalyze()` call so
a previous activity's entries don't leak into a new one), then feeds them through
`useMemo`-wrapped `getRecoveryDebt`/`getMacroRecoveryTarget` calls (re-imported from
`lib/metabolic-engine.ts` directly, reusing the server's initial numbers as the burned/
lost inputs and `weightKg` from the API response) for instant per-keystroke recompute. A
"Balance neto de recuperación" block spells out the arithmetic per metric — e.g.
`GASTADO 250g − INGERIDO EN RUTA 180g = DEUDA NETA A REPONER 70g` — immediately above the
"Objetivo de recuperación post-ruta" section (see "Biphasic recovery window" below), now
reading from the locally-recomputed `recoveryTarget` instead of the raw API response, with
a footer note that the target is "calculado sobre la deuda neta real."

#### Biphasic recovery window ("Fase 1" vs "Fase 2")

A single lump carb figure hides that post-exercise glycogen replenishment isn't uniform
over the recovery window — the first ~30-45 minutes are the only stretch where muscle
glucose uptake happens largely through insulin-independent GLUT-4 translocation
(exercise-induced, not diet-induced), so a fast liquid source (a shake, juice, fruit)
capitalizes on a window that then closes, rather than waiting for a slower solid meal.
`getBiphasicRecoveryTarget(recoveryTarget)` (`lib/metabolic-engine.ts`, pure) splits
`recoveryTarget.carbsG` by a fixed `RECOVERY_PHASE_1_CARB_FRACTION` (35%, the midpoint of
the commonly-cited 30-40% GLUT-4 window) into `phase1.carbsG` (immediate) and
`phase2.carbsG = recoveryTarget.carbsG - phase1.carbsG` (the remaining ~65%, so the two
always sum back to the original target with no rounding leakage). Protein is untouched by
this split and rides entirely in `phase2` — same rationale as `getMacroRecoveryTarget`
itself: it's about muscle repair, not the carb debt, so spreading it across an all-liquid
phase 1 dose isn't standard practice. `components/post-ride-analysis.tsx` renders this as
two side-by-side blocks ("⚡ Fase 1 · 0-45 min · inmediata" and "🍽️ Fase 2 · 1.5-2h · comida
principal", `Zap`/`Utensils` icons) above a smaller 2-card row for Grasas límite and
Rehidratación — `biphasicRecoveryTarget` is its own `useMemo` derived from the already-live-
recomputed `recoveryTarget`, so editing the in-ride-consumption inputs updates the phase
split instantly along with everything else on this card.

### Estadísticas (`/estadisticas`) & Weekly Performance

`fueling_logs` is an append-only log — both `POST /api/fueling/plan` (every calculation,
unconditionally — each one represents a genuinely considered ride) and
`POST /api/post-ride/analysis` (once per activity, deduped) insert one row via
`logFuelingPlan()` (`lib/fueling-logs.ts`). The Dashboard used to show a lifetime-totals
bar summed from this table (€ saved, kg glycogen, L fluid, g sodium) — replaced by a
gamification-oriented "Rendimiento Semanal" panel over the *last 7 days*, which itself
later moved off the Dashboard entirely onto its own `/estadisticas` route (reached from
the sidebar, `BarChart3` icon) — a forever-accumulating total, and later a permanently-
visible weekly panel, both fought the Dashboard's actual job (the daily pre/post-ride
actions) for space and attention; a once-a-week glance-back belongs on its own screen,
not baked into the screen an athlete opens before every ride.

`app/(app)/estadisticas/page.tsx` is three Server Component cards, numbered the same way
`/perfil` is (`01 · Resumen 7 días`, `02 · Desglose de ingesta`, `03 · Recomendación
biológica`):

- **`SummaryCard`** — the exact same four figures the old Dashboard panel showed
  (Cumplimiento 7D, Promedio ingesta, Gut Training, Balance hídrico), moved here verbatim
  — see the figures' own documentation below, unchanged.
- **`IntakeBreakdownCard`** — real consumed-vs-target carbs per ride, for the most recent
  rides that actually have consumption data logged. **`getRecentIntakeBreakdown()`**
  (`lib/dashboard-data.ts`) queries `fueling_logs` (`kind: 'post_ride'`, non-null
  `activity_id`/`carbs_consumed_g`) and `activities` as two separate queries joined
  client-side via a `Map` (same pattern `getWeeklyPerformance` already uses) rather than a
  single PostgREST embedded-relation select — this codebase has no generated Supabase
  types yet to verify the FK's exact constraint name against, so the two-query join is the
  safer bet. Rendered as one two-tone progress rail per ride (`bg-sage` fill, `bg-badge`
  rail — same visual language as the Fueling Planner's own objetivo/en-bolsillo/déficit
  bar), consumed capped at 100% width even when real intake exceeded the target (a rider
  who ate more than planned isn't a rendering bug).
- **`RecommendationCard`** — **`getIntakeRecommendationNote()`** (`lib/metabolic-engine.ts`)
  compares `avgIntakeGPerHour` (real logged intake) against the athlete's own
  `getGutTrainingCapGPerHour()` and returns one of three plain-language notes: meaningfully
  under their cap (below `INTAKE_HEADROOM_FRACTION`, 85%) suggests room to push the dose on
  endurance rides; within that headroom band suggests holding steady and considering a
  level-up; above the cap entirely suggests they may already be ready to advance a Gut
  Training level. `null` average (no consumption data logged yet) returns a plain
  "not enough data" note rather than fabricating a comparison with nothing real to compare.

**`getWeeklyPerformance()`** (`lib/dashboard-data.ts`) computes four figures, and is
strict about never fabricating a plausible-looking number for data that doesn't exist:

- **Cumplimiento 7D** and **Balance hídrico** both need to know what the athlete actually
  consumed during a ride, not just what they burned/lost — data that was, until now, only
  ever computed live in the browser and never persisted (`components/post-ride-analysis.
  tsx`'s "¿Qué consumiste realmente?" inputs). **`POST /api/post-ride/consumption`**
  (→ `saveConsumedAmounts()` in `lib/fueling-logs.ts`) closes that gap: a "Guardar consumo
  real" button next to those inputs `UPDATE`s the matching `post_ride` log's new
  `carbs_consumed_g`/`fluid_consumed_ml`/`sodium_consumed_mg` columns (requires the
  `fueling_logs` UPDATE RLS policy mentioned above — without it this silently matches
  zero rows, the exact same gotcha as everywhere else in this app, so the route explicitly
  checks the updated-row count and returns `409` rather than pretending it worked). The
  button's "✓ Guardado" confirmation clears itself the moment any of the three inputs
  changes again, so it can never show stale confirmation for numbers that no longer match
  what's saved.
- **Cumplimiento 7D** — average of `min(100%, carbs_consumed_g / total_carbs_g)` across
  this week's `post_ride` logs that actually have consumption data logged. `null` (not
  `0`) when there's none yet, rendered as "Sin datos de consumo aún" instead of a
  fabricated percentage.
- **Promedio ingesta** — average real consumed-carb rate (`carbs_consumed_g` ÷ that
  ride's own `activities.moving_time`) across those same logs — genuine intake, not the
  planned target.
- **Gut training** — read straight from `athlete_profiles.gut_training_level` via
  `gutTrainingLevelLabels`/`gutTrainingLevelRanges` (see "Gut Training Scale" above);
  always real, never depends on any week's ride data.
- **Balance hídrico** — average of `min(100%, fluid_consumed_ml / fluid_ml)` and
  `min(100%, sodium_consumed_mg / sodium_mg)` (both against the *raw* stored loss, not the
  post-exercise-replacement-factor-adjusted target, for a direct "how much of what you
  lost did you replace" reading) across the same logs, scaled to a `/10` score with a
  qualitative label (`hydrationLabel()` in `app/(app)/estadisticas/page.tsx`: ≥9 Óptimo, ≥7
  Bueno, ≥5 Mejorable, else Bajo).

When `ridesThisWeekCount` is `0`, the whole panel collapses to a single onboarding line
("0 km registrados esta semana — sincroniza tu primera salida...") instead of four empty
stat cards — the empty-state the "Auth, Logout & Empty States" work asked for. Independently
of that, when there *are* rides this week but `compliancePct`/`avgIntakeGPerHour` are both
still `null` (no `post_ride` consumption logged yet), the Cumplimiento/Promedio-ingesta
cells collapse into one `col-span-2` friendly card ("Calcula tu primera estrategia de
nutrición para empezar a registrar tu balance semanal.") rather than two separate "Sin
datos de consumo aún" stat blocks — Gut Training and Balance Hídrico still render as their
own cells regardless, since gut training is always real data independent of any week's
rides.

### Onboarding banner (Perfil incompleto)

`components/profile-check-banner.tsx`'s `ProfileCheckBanner` is a dismissible top-of-
Dashboard nudge whenever `athlete_profiles` still looks untouched, so a new athlete
understands *why* their fueling numbers might look generic before they've ever opened the
Physiological Profile form. `getMissingProfileFields(profile)` (`lib/dashboard-data.ts` —
not the banner component itself, since it's a `"use client"` file and a Server Component
can't call a function exported from one) returns `["ftp", "sweat_rate", "weight"]`
outright when there's no `athlete_profiles` row at all yet, or `["ftp", "sweat_rate"]`
when the row exists but still carries the *exact* zero-friction Strava-sync placeholder
pair (`ftp === 200 && sweat_rate === "medium"` — the literal values
`app/api/auth/strava/callback/route.ts`'s `DEFAULT_FTP`/`DEFAULT_SWEAT_RATE` insert for a
brand-new athlete with no physiological data yet). Checking *both* together, not either
field alone, is deliberate: a real athlete whose genuine sweat rate happens to be "medium"
would otherwise get flagged forever. `app/(app)/page.tsx`'s `ProfileCheckBannerSection` calls
`getAthleteProfile()` (already `cache()`-deduped, so this costs no extra query) and passes
the result straight to `ProfileCheckBanner`, which shows a single fixed message whenever
that array is non-empty ("Tu estrategia actual usa valores estimados. Configura tu FTP y
Peso en Perfil Fisiológico." — deliberately not built per-missing-field, since the
actionable takeaway is the same regardless of which exact fields are still placeholders),
a link to `/perfil`, and a dismiss (`×`) button. The dismiss preference is
`localStorage`-only (`profile_check_banner_dismissed`, same convention as the planner's
offline-strategy
cache) — a private-browsing/quota failure just means the dismiss doesn't persist across
sessions, never a broken banner.

### Athlete profile

**`app/api/athlete-profile/update`** — the plain-form-POST route behind the
Physiological Profile card's inline edit form (weight/FTP/sweat rate/gut training
level/athlete type/bottle count/bottle capacity/salty-sweater flag, all in one Card, no
separate view/edit toggle). Validates `athlete_type` against `VALID_ATHLETE_TYPES`
(`'diesel' | 'balanced' | 'explosive'`), `bottle_count` against `VALID_BOTTLE_COUNTS`
(`1 | 2`), and `bottle_capacity_ml` against `VALID_BOTTLE_CAPACITIES_ML` (`500 | 600 |
750 | 950`), redirecting the matching `invalid_*` code on anything else.
`is_salty_sweater` has no validation branch of its own — an unchecked HTML checkbox
simply isn't present in `FormData` at all, so `formData.get("is_salty_sweater") != null`
is the entire check (checked or not, never invalid). Uses `.upsert({ id: userId,
... })` rather than a select-then-update/insert branch, since `athlete_profiles.id` is the
primary key and Supabase's upsert already handles "create if missing, update if present"
in one call. On success, redirects to `/perfil?profile_saved=1` (same query-param
convention as `profile_error`/`strava_error`) rather than a bare `/perfil`, which
`components/profile-saved-toast.tsx` (`"use client"`) reads to render a self-dismissing
confirmation toast ("✓ Perfil fisiológico actualizado en Supabase") — fixed bottom-right,
`--status-good` toned, auto-hides after 3s and strips the query param via
`router.replace(pathname)` (the *current* path via `usePathname()`, not a hardcoded one,
so the same component stays correct if it's ever reused from another page) so a manual
refresh doesn't keep re-showing a stale confirmation. On invalid input or an RLS block,
redirects to `/perfil?profile_error=<code>` instead, same non-silent-failure convention as
everywhere else. `PhysiologicalProfileCard` itself is already a Server Component that
`await getAthleteProfile()`s on every request (`app/(app)/perfil/page.tsx` exports `dynamic =
"force-dynamic"`, and this Next.js version's `fetch` calls are uncached by default — see
"Route dynamic rendering" below) and pre-fills every form field via `defaultValue`/
`defaultChecked`, so a save is immediately reflected on the next load; there is no
separate client-side fetch-on-mount step to keep in sync. `components/profile-saved-toast.tsx`
reads that same query param to render its self-dismissing "Perfil metabólico actualizado
correctamente" toast.

`/perfil` is split into 3 numbered `Card`s (`01 · Métricas físicas y equipamiento`,
`02 · Fenotipo metabólico y sudoración`, `03 · Adaptación digestiva (gut training)`) all
inside one `<form>`, with a single full-width `Guardar cambios` button at the bottom — the
page used to be one giant card with its own `CardTitle` ("Perfil fisiológico") sitting
directly under the page's own `<h1>` of the same text, a literal visible duplicate. Gut
Training's selector (`components/gut-training-selector.tsx`, `<GutTrainingSelector
defaultLevel={...} />`) is the one `"use client"` island on an otherwise plain Server
Component form — a real native radio group (`name="gut_training_level"`, still submits
with the rest of the form exactly like the plain `defaultChecked` version it replaced), but
promoted to client-side `useState` specifically so the helper line below it ("El motor
limitará las recomendaciones a un máximo de N g/h...") can update live as the athlete
clicks between levels, before ever hitting "Guardar cambios" — a `defaultChecked`-only
version has no client state to read from for that. This also absorbed the old standalone
"Escala de Adaptación Digestiva" reference table that used to sit at the very bottom of the
page below the form — every level's own g/h range is already shown on its own selector
card now, so a second static list repeating the same 4 ranges was pure duplication.

### Sidebar navigation vs. Dashboard tabs (app/(app)/page.tsx, app/(app)/perfil/page.tsx, app/(app)/estadisticas/page.tsx, app/(app)/historial/page.tsx)

**The `(app)` route group and its persistent shell layout.** These four routes used to each
render `<DashboardShell>` themselves, individually, at the top of their own page component.
That worked fine for a normal render, but it meant Next's nearest `loading.tsx` — which
wraps a route segment's `{children}` in a Suspense boundary — replaced the *entire* page,
`DashboardShell` included, every time that page's own data fetch was still in flight: the
header and sidebar would flicker out and back in on every navigation between Dashboard
routes, a jarring "app shell" break. Fixed by moving all four pages under a `(app)` route
group (a folder name in parens — purely organizational, contributes nothing to the URL, so
`/`, `/perfil`, `/estadisticas`, `/historial` are unchanged) with **`app/(app)/layout.tsx`**
now the one place that renders `<DashboardShell>` — it wraps `{children}` once, at the
layout level, so it mounts immediately and independently of whatever page is loading below
it. **`app/(app)/loading.tsx`** is the fallback for exactly that `{children}` slot (i.e.
`DashboardShell`'s own `<main>`) — contained to the content area (`flex min-h-[50vh] w-full
flex-1 flex-col items-center justify-center py-12`, no background of its own, so it blends
into `DashboardShell`'s `bg-background` instead of painting a visible box), never the whole
viewport (`min-h-screen`/`fixed inset-0`, what the *root* `app/loading.tsx` still correctly
uses for the shell-less `/login`/`/auth/callback`/`/privacidad` segment — see "Login &
loading screens" above). Each of the four page components had their own `<DashboardShell
identitySlot={...}>...</DashboardShell>` wrapper and its `ViewerIdentity`/`Suspense`
plumbing stripped out to just their own inner content, now that the layout supplies both.

The Dashboard's tabs are daily-action surfaces (something a rider does before/after every
ride); the Physiological Profile, Estadísticas, and Historial are all setup-once/glance-
back surfaces, so they live on their own routes (`/perfil`, `/estadisticas`, `/historial`)
reached from the sidebar rather than as Dashboard tabs — mixing "things I do every ride"
with "things I configure or review occasionally" in the same `TabsList` was the wrong
information architecture once there were only two genuine daily tabs left. Ride history
used to be the second half of the Dashboard's "Al llegar" tab (see below) — moved out to
its own route for the same reason Estadísticas got its own route: a backward-looking log
isn't a pre/post-ride action, so it was competing for space in a tab that should stay
focused on the just-finished ride's analysis.
`components/dashboard-shell.tsx`'s `SidebarContent` renders `NAV_ITEMS` (`Dashboard` →
`/`, `Estadísticas` → `/estadisticas`, `Historial` → `/historial`, `Perfil fisiológico` →
`/perfil`) as real `next/link` `Link`s, using `usePathname()` to give the active item a filled pill
(`bg-surface text-terracotta`) and the rest a subtle hover fill — a client component
already (it owns the mobile drawer's `mobileOpen` state), so this needed no new
`"use client"` boundary. Each `Link` takes an `onNavigate` callback that closes the mobile
drawer (`setMobileOpen(false)`) on click, since without it a mobile visitor tapping a nav
item would navigate underneath a still-open overlay. The same `SidebarContent` header
(`AppLogo` + "Motor Metabólico") and the mobile top header's own logo+text are both
wrapped in a `<Link href="/">` (the sidebar one also firing `onNavigate` to close the
drawer) so clicking the brand mark always returns to the Dashboard, a near-universal web
convention this app was missing. **Clicking it while already on the Dashboard** doesn't
navigate at all — `scrollToTopIfHome()` intercepts the `Link`'s `onClick`, and if
`usePathname() === "/"` calls `e.preventDefault()` plus `window.scrollTo({ top: 0,
behavior: "smooth" })` instead, since a same-page `Link` click is a no-op route change
anyway and a logo click is a near-universal "take me back to the top" gesture on
editorial sites. Both brand `Link`s (`SidebarContent`'s, which covers the always-visible
desktop sidebar *and* the mobile drawer since it's the same component; and the mobile-only
sticky header's own) share this one function rather than duplicating the pathname check —
verified live at both a 1280px and a 390px viewport: scrolling down, then clicking the
brand mark, lands back at `scrollY === 0` with the URL unchanged, while the same click
from `/perfil` navigates to `/` normally. That mobile top header is `sticky top-0 z-40` with a
translucent `bg-white/90 backdrop-blur-md` — pinned in place as the page content scrolls
underneath it, rather than scrolling away with the rest of the page — so the hamburger
menu and brand mark stay reachable without scrolling back up. Layered correctly against
everything else that can render above the page on mobile: the drawer backdrop/`<aside>`
are `z-9999`/`z-10000` (well above the header's `z-40`, so opening the drawer fully covers
it) and `RouteMapPreview`'s Leaflet container is `relative z-0 isolate` (so its internal
panes/zoom-control z-indexes, up to `1000`, stay contained below the sticky header and can
never escape upward past their own container while scrolling).

The sidebar's bottom identity card (`components/viewer-identity.tsx`) is a separate,
Suspense-streamed Server Component (`ViewerIdentity`/`ViewerIdentitySkeleton`) rather than
markup baked into `DashboardShell` — `DashboardShell` is `"use client"`, so it takes an
`identitySlot: ReactNode` prop instead, and both `app/(app)/page.tsx` and `app/(app)/perfil/page.tsx`
pass the same `<Suspense fallback={<ViewerIdentitySkeleton />}><ViewerIdentity /></Suspense>`
so the (possibly network-bound, if it hits Strava) identity fetch never blocks the rest of
the shell from rendering. **`ViewerIdentity`/`ViewerIdentitySkeleton` carry no border of
their own** — `SidebarContent`'s own wrapping `<div className="border-t ... pt-4">` is the
single divider above the identity block; `ViewerIdentity` used to *also* draw its own
`border-t`, stacking two divider lines right above the avatar (a real bug, since the two
components' borders are independent and both rendered). A second wrapper div (`mt-4
border-t ... pt-3`) around the "Cerrar sesión" form supplies the divider *below* the
identity block that was missing entirely before — exactly one line above the identity
card, exactly one below it. `getViewerIdentity()` (`lib/dashboard-data.ts`) still fetches
the display name/avatar live from Strava rather than reading them off the Supabase Auth
user object — the real auth bridge (see "Real auth: Strava-exclusive login" above) never
stores a firstname/lastname/avatar in Supabase's `user_metadata`, since the synthetic
email it creates carries none of that, so Strava's own `/athlete` endpoint
(`fetchAthlete()` in `lib/strava.ts`, extended beyond its original weight-only fields to
also return `firstname`/`lastname`/`profileMedium`) remains the real source of truth for
the currently-authenticated user's identity; otherwise it falls back to the auth user's
own email local-part — never a hardcoded placeholder name — with a subtitle that states
the real connection status ("Conectado con Strava" / "Cuenta de desarrollo" / "Sin
sesión") instead of a made-up bio line.

- **`app/(app)/page.tsx`** — the Weekly Performance Panel (see above) sits above two
  `components/ui/tabs.tsx` (`@base-ui/react/tabs`) panels, labeled "Antes de salir"/"Al
  llegar" (the `value`s stay the internal `"pre-ride"`/`"post-ride"` identifiers — only
  the visible label text changed, as part of the app's full Spanish-only pass, see
  "Spanish-only UI text" below) — both panels' Server Component data fetches still run on
  every page load regardless of which tab is active (Tabs hides the inactive panel with
  CSS, it doesn't unmount/defer its Suspense boundary):
  - **Antes de salir tab** — `FuelingPlannerSection` fetches the athlete profile and
    `getStravaRoutes()`, handing the route list to the client `FuelingPlanner` (see
    "Fueling planner" above). Shows a prompt linking to `/perfil` instead if there's no
    `athlete_profiles` row yet, since the plan endpoint requires one.
  - **Al llegar tab** — `PostRideAnalysisSection` fetches `getRecentActivities(8)` and
    hands the list to the client `PostRideAnalysis` (see "Post-Ride Analysis" above).
    Ride history used to also live here (`RideHistorySection`) — moved to its own
    `/historial` route (see below), so this tab now holds only the just-finished ride's
    analysis.
- **`app/(app)/historial/page.tsx`** — its own page under the `(app)` shell layout (own
  header, reached from the sidebar's `Historial` nav item, `History` `lucide-react` icon).
  Redesigned from a plain Strava ride lookbook (name/distance/weather, no nutrition
  angle) into a "Diario de Rendimiento Nutricional" — two numbered cards, same
  `01 · .../02 · ...` convention as `/perfil` and `/estadisticas`:
  - **`01 · Resumen nutricional`** — 3 all-time KPIs from `getNutritionDiary()`
    (`lib/dashboard-data.ts`): **Cumplimiento medio** (average consumed/target ratio,
    capped per-ride before averaging, across *every* logged `post_ride` entry with real
    consumption data — not just the displayed page); **HC procesados** (total carbs
    actually consumed across every logged ride, `formatCarbsTotal()` switching to kg
    display above 1000g); **Gut training** — a `Nivel 1/2/3` badge (`30-45` / `60-75` /
    `90+` g/h) derived from real average logged intake. Deliberately a *different* scale
    from `athlete_profiles.gut_training_level` (the 4-tier self-reported
    Principiante/Intermedio/Avanzado/Pro field shown elsewhere) — this one reflects
    demonstrated real intake across logged rides, not a category the athlete picked once.
    All three collapse to a single "sin datos aún" line when nothing's logged yet, same
    "never fabricate" convention as `getWeeklyPerformance`.
  - **`02 · Diario de rutas`** — one `NutritionRideCard` per synced activity (`getNutritionDiary`'s
    `displayLimit`, default 20). A ride with logged consumption shows a color-coded
    compliance badge (`≥90%` emerald "X% cumplido", `60-89%` amber "Sub-nutrido", `<60%`
    red "Déficit crítico" — plain bordered pills, no emoji glyphs, matching this app's
    monochrome-chrome-plus-accent-color convention rather than literal 🟢/🟡/🔴) plus
    Ingesta (g/h) / Hidratación (L) / Sodio (mg) for that specific ride, uncapped (a ride
    can genuinely show >100% if the athlete over-fueled — verified live: a real
    "118% cumplido" case rendered correctly, not clamped). A ride with no consumption
    logged yet renders a muted variant instead — name/date/distance plus a "Sin datos de
    consumo — analiza esta ruta en 'Al llegar'" note — so every synced ride is still
    listed, just visually distinguished by whether it has a nutrition angle yet. Every
    card keeps a small external-link icon through to the real Strava activity.
  - `getNutritionDiary()` queries `activities`/`fueling_logs` with **no limit** for the
    summary KPIs specifically (only slicing to `displayLimit` for the rendered card list
    afterward) — an athlete with more synced rides than the display limit would otherwise
    get an all-time figure skewed toward only their most recent few.
  - The zero-activities empty state ("02 · Diario de rutas" with nothing synced yet)
    reads "Diario metabólico preparado. Tus salidas sincronizadas desde Strava aparecerán
    aquí." — a forward-looking onboarding line rather than the earlier flat "Sin
    actividades registradas todavía," so a brand-new athlete's first-ever visit to this
    route reads as "this is ready and waiting for you" rather than "there's nothing here."
- **`app/(app)/perfil/page.tsx`** — its own page under the `(app)` shell layout (own header,
  own `profile_saved`/`profile_error` query-param handling — see "Athlete profile" above)
  rather than a tab panel. `PhysiologicalProfileCard` reads `getAthleteProfile()` and
  renders an inline edit form (weight/FTP/sweat rate/gut training level/bottle
  count/bottle capacity/salty-sweater checkbox, pre-filled with current values) POSTing to
  `/api/athlete-profile/update`, plus a static reference table of the four Gut Training
  levels and their g/h ranges (see "Gut Training Scale" above), plus a full-width 1-click
  metabolic phenotype selector (three `has-checked:`-styled radio cards, see "Metabolic
  phenotype" below). The "Sudo mucha sal" checkbox (`is_salty_sweater`) feeds
  `getSodiumLossMgPerHour`'s elevated concentration tier (see "Metabolic engine" above).
  The bottle count/capacity selects feed "Bottle architecture &
  osmolarity control" and "Reload strategy" above — real bike equipment, not a physiology
  field, but persisted on the same row since it changes about as often as FTP does.

### Page header typography (H1)

Every top-level route's `<h1>` shares one exact class string —
`text-xl font-bold font-mono text-neutral-900 uppercase tracking-tight sm:text-2xl` — and
every subtitle paragraph below it shares `text-xs font-mono text-neutral-500 mt-1
leading-relaxed`. Before this, `/perfil` and `/estadisticas` hardcoded a bare `text-2xl`
with no smaller mobile step, and `/estadisticas`'s own title ("Análisis de metabolismo &
cumplimiento") was long enough to wrap onto 3 lines at that fixed size on a narrow phone —
verified live via Playwright at a 390px viewport, both regressions are gone (all three
routes render their `<h1>` on a single line at 20px/`text-xl`, matching the Dashboard's
own header, which already used the responsive pair). `/estadisticas`'s title was also
shortened to "Análisis & cumplimiento" so it reads cleanly at the smaller mobile size
without relying on wrapping. `app/(app)/page.tsx`'s Dashboard header keeps its own slightly
different structure (a greeting eyebrow line above the `<h1>`, no subtitle line below it)
since that's a deliberate, already-compact pattern, not the `<h1>` + subtitle shape the
other two routes use.

### Dynamic greeting

The Dashboard's eyebrow line above the `<h1>` used to be a hardcoded "Buenas tardes,
Alejandro" — always the wrong time-of-day prefix outside actual afternoon hours, and
always this one developer's name regardless of who's actually signed in.
`GreetingSection` (`app/(app)/page.tsx`) replaces it with `getGreetingPrefix(new
Date().getHours())` (`05:00-11:59` "Buenos días", `12:00-19:59` "Buenas tardes",
`20:00-04:59` "Buenas noches") plus the real signed-in athlete's first name, taken from
`getViewerIdentity()` (`lib/dashboard-data.ts` — the same Strava-backed identity source
`components/viewer-identity.tsx`'s sidebar card already uses; `cache()`-deduped, so
calling it a second time this request costs no extra Strava round-trip). It's its own
`Suspense` boundary (`GreetingSkeleton` fallback), same pattern as `StravaButton`/
`ProfileCheckBannerSection` below, so the greeting's Strava-dependent fetch never blocks
the rest of the Dashboard from rendering. Computed and rendered entirely server-side with
no client component involved, so there's no hydration mismatch risk — the server-rendered
markup is the only markup, never re-computed client-side against a possibly different
`Date()`.

### Spanish-only UI text

A pass removed the remaining "Spanglish" — English words left over in otherwise-Spanish
copy, mostly from this project's original English feature names bleeding into
user-visible strings. Only actual UI text/copy changed (headers, card titles, badges,
error messages, the clipboard/export text, PWA manifest/meta descriptions); internal
TypeScript identifiers, types, and code comments (`FuelingMode`, `fuelingMode` state,
`logFuelingPlan`, `recoveryDebt`, the `"pre-ride"`/`"post-ride"` `Tabs` `value`s, etc.)
were deliberately left alone — renaming those has no user-visible effect and would be a
large, risk-only mechanical refactor across API routes/DB-adjacent code. Changes:

- Dashboard tabs: "Pre-Ride"/"Post-Ride" → "Antes de salir"/"Al llegar".
- "Planificador de fueling" → "Planificador de nutrición" (both the Fueling Planner's own
  `CardTitle` and the no-profile-yet fallback card in `app/(app)/page.tsx`).
- "Receta DIY"/"Dosis DIY"/"(DIY)" → "receta casera"/"Dosis casera" (`fueling-planner.tsx`
  UI text, the DIY-recipe accordion header, and the clipboard-exported recipe's own
  `"🚴 RECETA DIY..."` header line in `lib/metabolic-engine.ts`'s
  `formatRecipeForSharing()`) — "DIY" was the one loanword with no natural one-word
  Spanish equivalent already in use elsewhere in the app, so "casero/a" (already used
  throughout, e.g. "Receta de laboratorio casero") replaces it everywhere instead of
  leaving two names for the same concept.
- "Modo de fueling" → "Estrategia nutricional" (the label above the Óptimo/Mi
  Inventario/Híbrido pills — the pill names themselves were already Spanish).
- "Gut Training" → "capacidad digestiva" everywhere it appeared as an English parenthetical
  or standalone label (`/perfil`'s section 03 header — the parenthetical was simply
  dropped rather than translated 1:1, since "Adaptación digestiva (capacidad digestiva)"
  is redundant with itself; the profile-save error message; `/estadisticas`'s stat label;
  and the recommendation note in `getIntakeRecommendationNote()`). The level names
  themselves (Principiante/Intermedio/Avanzado/Pro) were already Spanish.
- `SyncButton`'s mobile-collapsed label: "Sync" → "Sincronizar" (the loading state,
  "Sincronizando...", was already Spanish and unchanged).
- The sidebar footer's "Precision Fueling" tagline → "Nutrición de precisión"; the PWA
  manifest/meta descriptions (`app/manifest.ts`, `app/layout.tsx`) and `/login`'s value-
  prop heading also had their own "fueling"/"DIY" mentions translated the same way.

### Dashboard header spacing & date-pill height

Two small layout fixes bundled with the translation pass above:

- **Header-to-tabs whitespace** — `app/(app)/page.tsx`'s outer page wrapper was `gap-10` with an
  additional `mb-6` on the header itself, stacking to a large gap before the "Antes de
  salir"/"Al llegar" tabs even though the header already ends in its own `border-b pb-4`.
  Reduced to a single `gap-4` on the wrapper with the header's redundant `mb-6` removed.
- **`DeparturePicker`'s Hoy/Mañana/Elegir fecha buttons** — sized taller than the hour
  `<select>` directly below them, but not because of their own padding: "Elegir fecha" is
  long enough to wrap onto two lines inside its `grid-cols-3` column, and since CSS grid
  rows share height, that wrap stretched all three buttons taller than the field beside
  them (verified live: 49px vs. the field's 42px). Fixed with a fixed `h-10`, a smaller
  `text-[10px]` (`sm:text-xs`), and `whitespace-nowrap` so no label can ever wrap and
  re-trigger the same row-height stretch. A later pass shrank this further to `h-9` (36px,
  `px-3`, a fixed `text-[11px]`, `rounded-md`) — still comfortably above the "Elegir
  fecha" wrap-trigger height, but visually more compact/proportionate next to
  "Intensidad objetivo"'s plain `<select>` (42px) in the same `sm:grid-cols-2` row; the
  shared `fieldClass`/`selectableFieldClass` was deliberately left untouched rather than
  also shrunk to match exactly, since that class is reused by every input/select
  app-wide and a few px of visual difference in this one row reads as compact/aligned
  regardless (verified live at both viewports).

### Segmented-control responsiveness (`segmentedButtonClass`/`segmentedButtonLabelClass`)

Even at the shrunk `h-9`/`text-[11px]` size above, a real narrow-phone test (320-390px,
via a temporary unauthenticated Playwright route rendering `FuelingPlanner` in isolation —
removed again once verified, not a permanent fixture) still found "Elegir fecha" and "Mi
Inventario" tight enough to clip on the narrowest supported width. `components/
fueling-planner.tsx` now exports two shared classes used by every 3-column segmented
control in the file (Salida's Hoy/Mañana/Elegir fecha, the Ruta Strava/Calculadora/Subir
GPX mode toggle, and Estrategia nutricional's Óptimo/Mi Inventario/Híbrido — the last of
which used to be a wrapping `flex flex-wrap` row of variable-width pills, converted here to
a `grid grid-cols-3` matching the other two so all three groups share one row-alignment
convention): `segmentedButtonClass` on the `<button>` itself (`h-9 w-full min-w-0 flex
items-center justify-center`, `text-[10px] sm:text-xs font-mono font-bold tracking-tight`,
`px-1 sm:px-3` — each call site layers its own `rounded-*`/border/active-state colors via
`cn()`) and **`segmentedButtonLabelClass`** (`block w-full truncate`) wrapping the label
text in its own `<span>`.

The label needing its own wrapped `<span>`, rather than just adding `overflow-hidden
text-ellipsis whitespace-nowrap` straight onto the button, was a real bug caught by that
same Playwright check: a `flex items-center justify-center` button clips overflowing
content from *both* sides equally, since the flex box centers the content first and only
then clips whatever doesn't fit — verified live, "Mi Inventario" at exactly 320px rendered
as the nonsensical "i Inventario" (the leading "M" silently gone, no ellipsis marker at
all, since `text-overflow: ellipsis` doesn't apply cleanly to centered flex content).
Tailwind's `truncate` utility on a `block w-full` child span instead gives the label its
own left-aligned single-line box to truncate against, so any overflow now reads as a
proper "Mi Inventa…" — confirmed via `scrollWidth`/`clientWidth` measurement across
320/360/390px: every other label (`Elegir fecha` included) fits with zero truncation at
all three widths, and "Mi Inventario" — the one label that's still genuinely a few px too
wide for a 320px screen after already being pushed to `text-[10px]` — degrades to a clean
ellipsis rather than a broken/garbled clip, with the button's own height and border
unaffected either way.

### Route dynamic rendering

Both `app/(app)/page.tsx` and `app/(app)/perfil/page.tsx` export `dynamic = "force-dynamic"` because
each reads live Supabase data — without it Next prerenders the route at build time and
the figures would be frozen from whenever `next build` last ran.

### Mobile-first layout

The multi-column grids across the Dashboard and Perfil pages (profile form, planner
inputs, result-panel stat rows, the Net Carb Deficit breakdown) stack to a single column
at the default breakpoint and only go multi-column at `sm:` — mobile is the default
layout, not an afterthought squeezed into a desktop grid. The `app/(app)/page.tsx` header
(greeting/title + Strava button) keeps both on one row (`justify-between`) with the
greeting/title in their own `min-w-0` truncating column — an earlier `flex-col`-wrapping
version let a long label clip the greeting text on a narrow phone; truncating each side
independently instead of wrapping the whole row fixed that. The Sync button itself
(`components/sync-button.tsx`) has since shrunk to one ultra-compact style at every
breakpoint (`h-8 px-3 rounded-md border border-neutral-300/80 bg-white shadow-2xs`, a
single "Sincronizar" label, no separate mobile/desktop text variants) — small enough now
that the old responsive two-label split (a short mobile-only label vs. a longer desktop
one) was no longer needed to avoid clipping. The planner's
route/quick/GPX mode toggle is a compact
`grid grid-cols-3 gap-1 rounded-lg bg-neutral-100 p-1` segmented control (an inner
`rounded-md bg-neutral-900 shadow-sm` pill marks the active mode) rather than a row of
individually bordered, wrapping pill buttons — three columns fit in one row even on a
narrow phone, which a wrapping flex row of longer labels didn't reliably do. Numeric inputs
carry
`inputMode="decimal"` (weight, duration — anything with a fractional step) or
`inputMode="numeric"` (FTP, watts — integers only) so mobile keyboards show the right
keypad; shared input classes across `page.tsx`/`fueling-planner.tsx`/
`post-ride-analysis.tsx` use `py-2.5` rather than `py-2` for a more comfortable touch
target. `app/layout.tsx`'s `<body>` carries `overflow-x-hidden` as a defensive backstop
against any stray horizontal overflow, on top of (not instead of) fixing the actual
layouts above.

**Bottom safe-area padding for iOS Safari's floating bottom bar.** `components/
dashboard-shell.tsx`'s shared `<main>` — used by every interior route (Dashboard,
`/perfil`, `/estadisticas`, `/historial`) — carries `pb-24 sm:pb-16` (split from the
previous single `py-10 sm:py-14`, top padding unchanged) rather than a symmetric
top/bottom value. iOS Safari's floating bottom chrome (the address bar/tab-switcher
strip) sits *over* page content rather than reserving its own layout space, so a
symmetric padding that looked fine on desktop was tight enough on an iPhone to have the
real bottom bar overlap the last card/button (verified against real device screenshots).
Mobile gets the larger value since that chrome only exists there; desktop keeps a smaller
`pb-16` since there's no floating bar to clear.

**Normalized header-to-first-card spacing (`gap-6` everywhere).** The outer page wrapper
governing the gap between each route's `<header>` and its first content block had drifted
to three different values across four routes that all use the exact same visual
pattern: `/perfil` and `/estadisticas` were `gap-10` (40px), the Dashboard was `gap-4`
(16px), and only `/historial` already matched the intended `gap-6` (24px). All four now
use `gap-6` — chosen because it was already correct on the newest route rather than
picking a new value none of them had. Note this outer gap is deliberately a *different*
concern from the inner `gap-6` that already existed inside `/perfil` and `/estadisticas`
(which spaces their own multiple sibling `Card`s apart from each other) — both happen to
be the same 24px value, but they're two independent spacings that were never in conflict,
only the outer one needed changing.

**Sidebar drawer: click/tap only, no touch-gesture layer.** The drawer opens and closes
exclusively via explicit taps — the hamburger button, the `X` close button, and the
backdrop tap-to-dismiss — with no swipe/drag detection of any kind. A version of this
component briefly added `onTouchStart`/`onTouchMove`/`onTouchEnd` edge-swipe-to-open and
swipe-to-close handling, plus `overscroll-behavior-x: none` on `<html>`/`<body>` to stop
iOS Safari's native swipe-back-to-previous-page gesture from firing during that drag —
both were reverted at explicit request: the priority is 100% respecting iOS Safari's own
native swipe gestures (back/forward navigation) with zero interference from this app,
which a custom edge-swipe handler and an `overscroll-behavior` override necessarily work
against. If drawer gestures are ever revisited, keep in mind this exact tension — a
edge-swipe-to-open drawer and "never touch Safari's own back-swipe" are close to mutually
exclusive on the same edge of the screen.

**Mobile dashboard priority reorder.** A brand-new athlete's first useful action is
calculating a fueling strategy, not reading a week of stats they don't have yet — so on
small screens `app/(app)/page.tsx` renders the Tabs block (Pre-Ride's Fueling Planner is its
default tab) *before* the Weekly Performance Panel, reverting to the original
stats-then-tabs order at `sm:` and up. Both blocks are wrapped in their own `div` (`order-2
sm:order-0` on the Weekly panel's wrapper, `order-1 sm:order-0` on the Tabs wrapper) inside
the page's outer `flex flex-col` container — plain CSS `order` on two siblings, not a DOM
restructure, so neither component needed to change and the Tabs' internal Pre-Ride/Post-Ride
behavior is untouched.

### PWA / "Add to Home Screen"

`app/manifest.ts` (Next's `MetadataRoute.Manifest` file convention — auto-linked into
`<head>`, no manual `<link rel="manifest">` needed) declares `display: "standalone"` so
Android/Chrome's install prompt launches the app without browser chrome. `app/icon.tsx`
(512×512) and `app/apple-icon.tsx` (180×180) both generate a PNG at request time via
`next/og`'s `ImageResponse` — the same brand-mark SVG paths as `components/app-logo.tsx`
(same cropped viewBox, embedded directly as inline `<svg>`/`<path>` elements inside the
`ImageResponse` JSX — `satori` renders raw SVG children natively, no rasterization step
needed) on a `--background` cream square, replacing an earlier flame-emoji placeholder —
rather than needing a hand-exported image asset; Next auto-injects the corresponding
`<link rel="icon">`/`<link rel="apple-touch-icon">` tags. **Deliberately not** a static
`app/icon.svg`/`public/icon.svg` file even though `icon.(svg|png|...)` is also a valid
convention — Next allows only one `icon` resolution per route segment, and this segment
already has the dynamic `icon.tsx`; adding a static file alongside it would conflict
rather than layer. `app/layout.tsx`'s `metadata`
sets `appleWebApp: { title, statusBarStyle: "default" }`, which is what actually gets iOS
Safari's "Add to Home Screen" to launch standalone (Android reads the manifest instead).
`viewport.themeColor` matches `--background` (`#faf9f5`) so the installed app's title/
status bar blends with the page instead of showing a mismatched color.

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
- Design tokens live in `app/globals.css` (`@theme inline` maps each `--color-*` Tailwind
  utility to a plain CSS custom property in `:root`); reuse them instead of hardcoding hex
  colors. As of the Pas Normal Studios-style editorial palette pass, the base is a warm
  cream (`--background` `#f8f7f4`, `bg-background`) rather than a cold white/gray, with
  `--card`/`--popover` pure white (`#ffffff`) so cards visually lift off that base, and
  `--surface` (`#f1efea`, `bg-surface`) one layer between the two for input backgrounds
  and secondary containers. Earth-tone technical accents replace the old monochrome
  black-on-white for anything "active"/"primary": `--terracotta` (`#c85231`,
  `bg-terracotta`/`text-terracotta`/`border-terracotta`, `--terracotta-hover` on hover) is
  the one accent for every primary action button, active tab, and active segmented-control
  pill; `--sage` (`#526553`) marks carb-coverage "cubierto"/positive-progress state,
  distinct from the older, more muted `--status-good` (`#526553` too, same hex, kept as a
  separate token since status banners and the carb-coverage meter may need to diverge
  later); `--sand` (`#d5cfbf`) is the "restante/déficit" tone — deliberately not a second
  red/warning color, since an unfilled carb target isn't an error state; `--slate-tech`
  (`#52606d`) is reserved for future route/weather context, not yet wired into any
  component. `--badge-bg`/`--badge-foreground`/`--badge-border` (`bg-badge`/
  `text-badge-foreground`/`border-badge-border`) style small data pills (weather readouts,
  Gut Training level) via `badgeClass` below.
- **`lib/ui-classes.ts`** is the shared button/field/badge class-string baseline — every
  hand-rolled `<button>`/`<input>`/`<select>` across the Dashboard, Pre-Ride planner,
  Post-Ride analysis, and Physiological Profile form imports `primaryButtonClass`
  (terracotta fill, `rounded-lg`, `font-mono` uppercase — CALCULAR ESTRATEGIA, ANALIZAR,
  GUARDAR, GUARDAR CONSUMO REAL), `secondaryButtonClass` (white/outline counterpart —
  Copiar receta, Descargar GPX, Sincronizar), `fieldClass`/`selectableFieldClass` (every
  plain input vs. every select/date field), or `badgeClass` — plain exported strings
  composed via `cn()` at each call site for its own state-dependent classes (disabled,
  active, etc.), not a wrapping component, since every call site already needs that
  composition anyway. A file-local `const inputClass = fieldClass` alias is fine where a
  file already had many call sites under that name; don't invent a *second* set of
  near-identical classes for a new button/field — import from here.
- Bold uppercase tracked headers (`CardTitle`'s default, the page `<h1>`, `TabsTrigger`
  labels) stay in the same clean geometric sans as everything else — never a monospace/
  retro face for names or labels — with `font-mono` reserved strictly for *displayed
  numeric metrics* (stat blocks, recipe grams, ride distances, the pocket-food carb
  figures — never on user-editable form inputs like a `<select>` full of words, and never
  on a food/label *name*, only the number next to it) and, as of the design-system pass
  above, also the uppercase label text on every shared button/badge class. Structural
  dividers are soft `border-neutral-200`/`border-neutral-300` lines, not `border-neutral-900`
  — a stark black divider reads as heavy-handed/brutalist rather than clean; `border-neutral-900`
  itself is no longer used for "active/selected" states either (that's `border-terracotta`
  now), only for genuinely monochrome one-off elements that have no accent-color reason to
  exist (e.g. the app's own Flame mark). Corners are `rounded-lg` on every shared button/
  field/badge and `rounded-2xl` on auth-flow cards (`/login`, `/auth/callback`) — plain
  `rounded-sm`/square corners are reserved for dense data cards/rows (`Card` itself, ride
  history rows, reference tables) where a softer radius would look inconsistent with their
  tighter internal spacing. Never a bare `rounded-none`/no-radius button — every button
  shares one of the two classes above specifically so this can't regress file-by-file.
  `--font-sans` in `app/globals.css` must stay wired to `var(--font-geist-sans)` (the
  actual variable `next/font/google`'s `Geist` sets in `app/layout.tsx`) — it was
  accidentally self-referential (`var(--font-sans)`) for a long stretch of this project's
  history, which silently fell back to the browser's default serif for every heading; if
  headings ever look serif again, check this line first.

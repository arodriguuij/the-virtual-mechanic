@AGENTS.md

# RATIO

Rebranded from "Motor Metabólico" — same app, same domain, new name (see git history for
the rename commit). Nutrition and physiology planner for cyclists — turns FTP, weight, and
self-reported sweat
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
     `strava-{athleteId}@strava.users.ratio.internal` — a domain that never receives mail,
     existing purely as a stable dedup key.
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
- **`lib/auth-actions.ts`** — `logout()`, a `"use server"` Server Action
  (`supabase.auth.signOut()` then `redirect("/login")`) wired as a `<form
  action={logout}>` in `components/dashboard-shell.tsx`'s sidebar, below the identity
  card. There's no separate client-side Supabase client anywhere in this app (an earlier
  `lib/supabase-browser.ts` existed for this exact purpose but was already dead — no
  longer imported once the logout button moved to the Server Action above — and has since
  been deleted) — sign-out is entirely server-side. See "Immediate logout feedback" below
  for the click→redirect UX built on top of this same action, unchanged.
### Login & loading screens (`app/login/page.tsx`, `app/auth/callback/page.tsx`)

**`app/loading.tsx`** is Next's route-level `loading.tsx` boundary at the true app root —
the fallback for `/login`, `/auth/callback`, and `/privacidad`, none of which have a
persistent shell of their own (`/login` renders the full-bleed `LoginHeroLayout`, see
below; `/auth/callback` renders its own minimal cream+mark screen, see "Strava OAuth"
below; `/privacidad` renders a plain top bar), so a
full-screen fallback is correct here: `min-h-screen
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

**`LoginHeroLayout`'s Pas Normal Studios-style layout** (`components/login-hero.tsx`) is the
full-bleed frame for `/login` — the background video, brand mark, hero copy, and
illustrative telemetry readout, with the CTA slot taking the real "Conectar con Strava"
button. Plain component — no `"use client"`, no server-only APIs. It originally also
rendered the Strava OAuth transition at `/auth/callback` (differing only in the CTA slot —
a disabled "Conectando..." state in place of the login button), on the reasoning that one
shared component can't accidentally drift from itself the way two independent copies
could; that screen has since moved to its own minimal, non-`LoginHeroLayout` design (a
static cream field with a breathing bronze mark, no video/card/CTA at all) — see "Strava
OAuth" below for why. This layout went through several
iterations before landing on its current mobile-card/desktop-split shape — an earlier pass
tried a `fixed`, globally-pinned pill-shaped brand mark plus a fully unwrapped, no-card
content panel at every breakpoint; that was reverted once the brief called for the
opposite structure on mobile specifically — an elevated white modal card over the video,
not a translucent full-bleed panel. Before this, `/auth/callback` rendered its own distinct
`AuthPageShell` frame (a boxed top-bar/hero/bottom-bar shell, since deleted along with the
component itself) with a pulsing `AppLogo` and "Conectando con Strava..." status copy —
replaced entirely so the OAuth transition reads as a continuation of the same screen the
athlete just clicked from, not a jarring switch to a different frame. The current
structure:

- **Root**: `grid grid-cols-1 lg:grid-cols-2 min-h-dvh bg-neutral-950 lg:bg-white` — a
  real CSS grid, one column on mobile (where `BackgroundMedia` is pulled out of flow via
  `fixed`, so the content column is the only element actually participating in the grid),
  two equal columns at `lg:`. The root's own `bg-neutral-950` is a dark fallback scoped to
  this one page (not a change to `app/layout.tsx`'s shared `<body>`, which every other route
  still relies on for its cream `bg-background` — see below for why that shared file was
  deliberately left alone) — whatever briefly shows at the edges during an iOS Safari
  elastic-overscroll bounce, or in the instant before the video paints, is near-black rather
  than a cream flash.
- **`BackgroundMedia`** — `fixed inset-0 h-dvh min-h-screen` on mobile (out of grid flow
  entirely, full-bleed behind everything), `lg:relative lg:h-full` at `lg:` (a normal grid
  column, taking the grid's first implicit track). The video itself is
  `absolute inset-0 h-full w-full object-cover` at **every** breakpoint — no
  `lg:object-contain` letterboxing (a prior pass's approach, which avoided cropping the 9:16
  source clip but left visible dark bars down the sides of the desktop column); an
  edge-to-edge fill with zero visible bars is prioritized over showing the full uncropped
  frame. Opacity differs by breakpoint — `opacity-80` on mobile, `lg:opacity-90` on desktop
  — since mobile dims the video slightly to sit behind an opaque white card (see below),
  while desktop's video *is* the entire left column with no card ever competing against it,
  so it can run brighter. `fixed` rather than `absolute` on mobile, and `lg:relative` rather
  than `lg:static` at `lg:`, are both deliberate: `fixed` anchors against the true viewport
  rather than a containing block that doesn't reliably track iOS Safari's toolbar collapse/
  expand animation (see "Root-level scroll lock" below for the same underlying bug class),
  and `lg:relative` makes this wrapper the containing block for the `bg-black/20` contrast
  overlay's `absolute inset-0`, keeping that tint scoped to the video column instead of
  resolving against the grid root and bleeding across the whole split screen.
  Wrapped in `memo` and takes zero props — a guardrail so clicking "Conectar con Strava"
  can never restart the loop from frame 0. Verified live (a real click, with the OAuth
  navigation itself blocked so the page stayed mounted): the video's DOM node identity and
  `currentTime` are both untouched by `StravaLoginButton`'s own `setConnecting(true)` call,
  since that button is the one Client Component here and its state update only re-renders
  its own subtree — `BackgroundMedia` sits in an entirely separate, server-rendered part of
  the tree, passed into `LoginHeroLayout` alongside it, not as its parent or child. The one
  thing that does stop the video is the real, unavoidable browser navigation away from
  `/login` once the OAuth redirect actually completes (the tab leaving for Strava's own
  domain) — not a bug, just leaving the page.
- **`BrandMark`** — a plain in-flow icon+wordmark lockup (`flex items-center justify-center
  gap-3`, `RatioLogo` at `size-8`, no pill/capsule background on the text), the first child
  inside the centered content block itself rather than a separate globally-`fixed` overlay.
  An earlier pass made this a `fixed top-4 left-1/2 z-50` element specifically because the
  content column back then was a full-bleed translucent panel with no natural centered
  container of its own for it to sit inside — now that the content lives inside one centered
  block (the mobile card, or the desktop column's own `max-w-lg mx-auto`), the mark just
  needs to be that block's first element, no separate positioning layer required.
- **Content column, mobile vs. desktop — through several iterations, settled on
  "ultra-clean, no double cards."** This went through at least three distinct designs. The
  first stripped every card affordance at `lg:` entirely, reasoning "the card is a
  mobile-only necessity." A second pass reversed that once the right column's own
  background changed from cream to plain `bg-white` — a flat-white card on a flat-white
  column had nothing to visually separate it, so it gained its own `rounded-3xl border
  border-zinc-200/60 shadow-2xl shadow-zinc-200/40 bg-zinc-50` box at `lg:` too. A third
  pass reversed *that*: a boxed white-ish card floating inside an already-clean white column
  read as one card nested inside another — redundant, not premium — so `lg:` now drops
  every bit of card chrome again (`lg:rounded-none lg:bg-transparent lg:p-0`), just with
  generous `lg:px-12 lg:py-16` spacing (not card padding, just breathing room) rather than
  a card inset. Mobile (< `lg:`) still needs a real contrast layer over the moving video,
  but even that was trimmed to the minimum: `rounded-3xl bg-white/95 backdrop-blur-md p-6
  sm:p-8` — no border, no drop shadow. The blur plus 95%-opacity fill alone reads as
  "floating over something" without a harder box outline; a border/shadow pairing was
  tried and dropped as one hard edge too many for a screen whose whole point is now "no
  cages, no boxes, just soft contrast and space." Verified live via Playwright at
  375×667/390×844/1280×900: zero scroll overflow at every size (the padding here is
  actually *smaller* than the previous pass's `px-6 py-10`/`lg:px-12 lg:py-16` card-inset
  values, so no risk of reopening the earlier mobile-scroll issue), and the desktop
  screenshot confirms the content now floats directly on the plain white column with no
  visible box at all. The telemetry readout (route name/stats/prescription block) keeps its
  own `text-left` override against the card's `text-center` default — a technical data
  readout reads as a data sheet, not hero copy, the same "hero centered, technical readout
  left-aligned" convention as before.
- **Telemetry readout — divider lines with generous padding, plus a continuous left
  accent.** The route name/distance/elevation/gradient line ("Sa Calobra – Coll dels Reis" ·
  "9.5 km · 670m D+ · 7% avg · 27°C (Calor Alto)"), the 3-column stat grid (Potencia NP /
  Deuda glucógeno / Tasa de sudor), and the "Pauta de ingesta (tolerancia media)" block went
  through three designs. An "ultra-clean" pass first removed every divider line this readout
  used to carry (a `border-y` wrapping the whole block, `divide-x`/`border-y` between the 3
  stat cells, a `border-l-2 border-terracotta` left-accent bar on the ingesta block alone) in
  favor of pure `space-y-4 sm:space-y-5` spacing. A second pass reverted that: the 3
  sub-blocks sit inside a `divide-y divide-zinc-200/80` wrapper again, each with a much more
  generous `py-4 sm:py-5` (not the tight `py-2`/`py-3` rhythm this carried before its brief
  removal). A third pass added the left accent back too, but restructured: instead of a
  `border-l-2` on the ingesta block alone, one continuous `border-l-2 border-terracotta
  pl-4 sm:pl-5` now wraps the *entire* 3-block group from the outside — a single accent
  marking the whole data section as one unit, coexisting with the horizontal `divide-y`
  rules rather than replacing them. Also part of this pass: the gap below `BrandMark` (the
  "RATIO" logo+wordmark) grew from `gap-2` to `gap-8 sm:gap-10` — deliberately much larger
  than the `gap-4 sm:gap-6` separating the 3 top-level sections themselves, so the brand
  mark reads as this screen's own app-level header rather than just the hero copy's first
  line. Still strictly 100% typographic (no icons, no emoji, no colored-dot indicator, no
  `bg-*` box anywhere inside the readout) and still fully static/illustrative data needing
  no network round-trip. Verified live via Playwright at 375×667/390×844/360×640: still zero
  scroll overflow despite both the larger brand-to-title gap and the left-border padding.
  The one-line subheader tag
  above it (`headerTagline` in `components/login-hero.tsx`, "Planificación &
  avituallamiento") went through several revisions before landing here — a 3-pill
  "ADAPTACIÓN DIGESTIVA • IMPACTO TÉRMICO • PLAN DE AVITUALLAMIENTO" line, then briefly an
  English-leaning "Gut training • Impacto térmico • Estrategia de bolsillo," and, separately,
  a version of the ingesta block below it with a `bg-neutral-100`/`border-neutral-200` boxed
  pocket-food line carrying real emoji (🎒/🔄) — all reverted, since this hero is meant to
  read as ultra-clean PNS-style technical typography with zero English loanwords and zero
  decoration competing with the numbers themselves. The 3-pill version was finally condensed
  to this single short tag once a later pass needed to shrink the whole card's vertical
  footprint to fit one mobile screen without scrolling (see "Vertical spacing" below) — one
  line reads faster and takes less height than three pills joined by "•". "EN RUTA: 2 geles
  (40g HC) + 1 bidón/h" (trimmed further from an earlier "...+ 1 bidón electrolitos / h",
  which could wrap onto two lines on a narrow phone) and "POST-RUTA: 65g HC + 30g Proteína"
  share the exact same `text-[11px] font-mono text-neutral-500` treatment. The one deliberate
  icon exception on the whole page remains the Strava icomark on the CTA button
  (`components/strava-login-button.tsx`, `w-full`, no `max-w-70` cap) — Strava's API
  Agreement requires it for brand identification (see "Strava API compliance" below).

  **Vertical spacing and type scale, condensed to fit one mobile screen with real margin to
  spare.** This went through two passes. The first replaced each block's own individual
  `mb-6`/`my-6 sm:my-10`/`mt-6` with a single `space-y-3.5 sm:space-y-5` on their shared
  parent — an improvement, but a follow-up report said the card was *still* causing scroll
  on a real phone, and a closer look found two compounding causes: `BrandMark` still carried
  its own leftover `mb-6` on top of the new `space-y`, silently double-spacing that one gap,
  and the underlying type scale itself (route title, stat values, the telemetry block's own
  internal `py-5 sm:py-8`/`my-4 sm:my-6`) was still sized for a hero that could scroll if it
  needed to, not one that had to fit a single small viewport with margin to spare. The
  second pass fixed both: `space-y-*` was replaced with a plain `gap-2.5 sm:gap-4` flex
  column (functionally the same idea, just the more direct primitive for a flex parent), the
  stray `mb-6` on `BrandMark` was removed outright, and nearly every text size on the card
  was stepped down one notch (route title `text-xs sm:text-sm`, stat labels
  `text-[9px] sm:text-[10px] text-neutral-400`, stat values `text-xs sm:text-sm
  text-neutral-800`, the ingesta label `text-[9px] sm:text-[10px]`, the en-ruta/post-ruta
  lines `text-[10px] sm:text-xs text-neutral-600`) — with one deliberate exception in the
  other direction: the "85 g/h" headline figure grew to `text-lg sm:text-2xl` specifically
  so the one number that matters most still reads as the clear visual anchor even as
  everything around it shrank. The telemetry block's own internal padding/margins
  (`py-5 sm:py-8` → `py-3 sm:py-5`, `my-4 sm:my-6` → `my-2.5 sm:my-4`) were tightened too,
  and each stat cell gained its own explicit `px-2 py-1.5` rather than relying solely on the
  grid's own padding. `BrandMark`'s logo shrank to `size-6 sm:size-8` (from a flat `size-8`),
  and the CTA button (`components/strava-login-button.tsx`) went from `py-4` to
  `py-2.5 sm:py-3`. The outer centering wrapper's own padding shrank from
  `px-4 py-8 sm:p-8 lg:p-12` to `p-3 sm:p-4 lg:p-12`, plus an explicit `overflow-hidden` as a
  defensive backstop. Verified live via Playwright at four mobile viewports (375×667 iPhone
  SE, 390×844, 360×640, and a deliberately conservative 375×600 to approximate a real
  browser's on-screen chrome eating into the visible viewport) — all four report
  `document.documentElement.scrollHeight` exactly matching their own viewport height (no
  overflow), and at 375×667 the card itself measures only ~430px tall against the 667px
  viewport — over 230px of real margin, not a bare fit.

  **Three explicit sections, a third pass.** The flat flex column above (brand mark, hero
  title/tagline, telemetry readout, error banner, CTA+footer — 5 top-level children on one
  `gap-2.5 sm:gap-4`) was regrouped into 3 named sections — `01` Branding & Header (brand
  mark + title + tagline), `02` Vista previa fisiológica (the telemetry readout, unchanged
  internally), `03` Acción / Autenticación (the error banner + CTA + privacy microcopy) —
  each its own wrapping `<div>`, with the inter-section gap widened to `gap-4 sm:gap-6`
  (16px/24px, up from 10px/16px). This reads as a *larger* gap but doesn't reopen the
  overflow just fixed above: grouping into 3 children instead of 5 means only 2 gaps apply
  instead of 4, so the total gap budget is actually roughly flat (verified live: still zero
  scroll at 375×667/390×844/1280×900). Section 2 gained its own subtle boxed treatment at
  `sm:` and up — `sm:rounded-xl sm:border sm:border-neutral-200 sm:bg-surface sm:p-4` (this
  app's existing token set, not a new `pns-*` namespace — see "No `tailwind.config.ts`"
  below) — while staying a plain `border-y`-divided block with no box on mobile, so Sections
  1 and 3 read as clean, unboxed blocks above and below it once there's room for the
  distinction (verified at 1280×900: the route/telemetry block renders as a clearly
  separate bordered card against the borderless outer layout).
- **`app/layout.tsx` deliberately untouched.** The brief also asked for the shared root
  layout's background to go dark, aimed at the same iOS Safari white-strip class of bug —
  not implemented, and deliberately so: `app/layout.tsx` wraps every route in the app, and
  its `<body>` currently has no explicit background of its own beyond `bg-background`
  (cream), which is what every other page's own viewport-bounce color already relies on.
  Setting `<body>` to `bg-neutral-950` globally would flip that fallback to near-black on
  every authenticated route too (Dashboard, Perfil, Estadísticas, Historial), not just this
  one page — a large, highly visible regression against this app's own extensively
  documented cream design-system baseline, for a bug that's specific to this one page's
  full-bleed video. The fix stays scoped to `/login`'s own root div (`bg-neutral-950`) plus
  the proven `fixed`/`h-dvh`/`min-h-screen` video-wrapper technique above.

**`app/auth/callback/page.tsx`'s screen was redesigned off `LoginHeroLayout` entirely** —
the `ConnectingButton` component (a disabled, `cursor-wait` "Conectando con Strava..."
button inside the shared hero frame) and the video-background/card chrome around it are
both gone. In their place: a plain `flex min-h-dvh items-center justify-center` on a flat
`bg-[#FDFCF9]` field, a single breathing `<RatioLogo className="size-12 animate-pulse
text-terracotta" />`, and one status line below it ("Sincronizando perfil fisiológico...",
`font-mono text-xs tracking-wider text-neutral-500 uppercase`) — no icons, no spinner ring,
no CTA slot at all, since there's nothing for the athlete to click on this screen. This
reads as a quieter, more deliberate "we're setting you up" moment than repeating the full
marketing hero the athlete just clicked through on `/login`, and keeps Strava's own
corporate orange (`#FC4C02`) scoped strictly to the login button's icomark — this
transition screen carries only the app's own bronze accent, no Strava branding at all.
`app/auth/callback/page.tsx` itself keeps its pre-existing token-forwarding
`useEffect`/`hasStartedRef` logic entirely unchanged (see "Strava OAuth" below) — only the
rendered JSX changed.

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
  has a real page to render (a minimal "Sincronizando perfil fisiológico..." transition
  screen — a breathing bronze `RatioLogo` on a flat cream field, its own design rather
  than `LoginHeroLayout` — see "Login & loading screens" above) for however long the
  token-exchange/Supabase-bridge work below takes, instead of a blank tab.
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
  fetches `/athlete` (`fetchAthlete()` in `lib/strava.ts`) and, if the athlete already has
  an `athlete_profiles` row, `UPDATE`s its `weight_kg` (never overwrites their own `ftp`/
  `sweat_rate`). **Deliberately does *not* `INSERT` a brand-new row** — an earlier version
  did, filling `ftp`/`sweat_rate` with a placeholder pair (`200`/`'medium'`, since Strava
  has no concept of either) just to satisfy the table's `NOT NULL` columns; removed because
  a fabricated row materializing the instant someone connects Strava, before they've ever
  opened the Physiological Profile form, is exactly the kind of invented data this app must
  never present as real (see "Eliminating profile fallbacks" below). A first-time athlete
  now has no `athlete_profiles` row at all until they submit the real form themselves —
  `getStravaAthleteWeightKg()` (`lib/dashboard-data.ts`) still prefills that form's weight
  field from this same Strava reading, without persisting anything early. A failure here is
  logged but never undoes an otherwise-successful Strava connection.

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
  This button (`SyncForm`) no longer lives in the Dashboard header at all — a later "PNS
  premium redesign" pass (see that section under the Dashboard docs below) moved it into
  the Sidebar's identity card instead, next to "Conectado con Strava," and the header now
  renders only the greeting at full width. See that section for the button's current
  styling and the reasoning for the move.

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
  login-hero.tsx`'s shared `LoginHeroLayout` despite living alongside `/login`
  conceptually — that layout is built around a single compact hero card/video, which would
  be wrong for a long-form policy document that needs to scroll normally (verified live:
  `/privacidad`'s `scrollHeight` is ~1891px against an 844px viewport, genuinely
  scrollable). Plain top bar (brand mark + a "Volver" link back to `/login`) plus a normal
  scrolling `<article>`-style `<main>`.
  Linked from `/login`'s own footer note — originally a full sentence spelling out the
  OAuth/data-use guarantee ("Acceso seguro mediante OAuth. Solo lectura de rutas — nunca
  vendemos ni compartimos tus datos. **Política de Privacidad**"), condensed to a single
  line ("Conexión segura vía OAuth con Strava · **Política de Privacidad**") once the whole
  card needed to shrink to fit one mobile screen without scrolling (see "Login & loading
  screens" above) — the link itself, and the compliance guarantee it points to, are
  unchanged; only the inline legal-sounding prose around it was trimmed. Verified the
  shorter text doesn't reintroduce mobile scroll on the login screen itself.
- **Data-use disclosure, matching the real scopes** — the policy states the exact three
  OAuth scopes this app actually requests (`read`, `activity:read_all`,
  `profile:read_all` — see `STRAVA_SCOPES` in `lib/strava.ts`), what each is used for, and
  states plainly that no write scope is ever requested and no data is sold or shared with
  third parties — both true statements about this codebase (there's no write call to
  Strava's API anywhere, and no analytics/ads SDK or data-export mechanism exists) rather
  than aspirational copy. The contact email (`arodriguuij@gmail.com`) is the developer's
  real address, not a placeholder — asked explicitly rather than inventing a
  `@ratio.app` address that domain doesn't actually have configured.

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
  — sizes the fueling window for a saved Strava route (or an uploaded GPX track), which has
  no real moving-time of its own. Decomposes the route into climb/descent/flat segments
  (rather than one blended distance-plus-elevation-bonus figure) since the selected
  `IntensityLevel` — hence target watts — genuinely changes total duration by tens of
  minutes at the same FTP (an easy Z2 spin vs. a full-gas group ride), and sizing bottles/
  grams off a stale distance-only or historical-average-speed figure would silently
  under- or over-fuel the athlete: `climbDistanceKm = elevationGainM / (AVG_CLIMB_GRADIENT ×
  1000)` (a fixed ~6% average gradient assumption), `descentDistanceKm` mirrors the climb
  distance (a reasonable stand-in for a circular/out-and-back ride), each capped at half the
  total distance so a short, very steep route can't imply a climb longer than the ride
  itself, and `flatDistanceKm` is the remainder. Climb time comes from an estimated VAM
  (vertical m/h, ~700-800 at 2.5 W/kg, scaling with W/kg) against **total-system** W/kg —
  target watts over rider weight *plus* a fixed `ESTIMATED_BIKE_WEIGHT_KG` (8kg; there's no
  real per-athlete bike-weight field yet, so a typical-road-bike constant stands in). Flat
  time comes from a simplified aerodynamic power law (`v ∝ P^(1/3)`, calibrated so ~200W
  lands around ~30km/h flat — roughly matching a CdA≈0.3-0.4 flat-road estimate at that
  power) rather than the older pure-W/kg linear speed guess. Descent time uses a fixed
  `DESCENT_SPEED_KMH` (42). The three segment times sum and get a flat `STOPPAGE_MARGIN`
  (+3%, junctions/traffic lights/brief regrouping) applied on top.
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
Profile tab's one-click selector — 3 cards through the shared `RadioCard` component (see
"Unified `RadioCard` selector" below), a solid `bg-terracotta` fill when selected, same as
every other required-field selector on that page.

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
eight catalog items — 🍌 Plátano 22g, 🍫 Barrita energética 30g, 🍙 Bollo de arroz/Rice
cake 25g, 🌴 Dátiles (2 uds) 18g, 🍬 Gominolas / Chews 30g (added later, sitting between
Dátiles and the gel tiers in every ordered list — `POCKET_FOOD_TYPES` in
`components/fueling-planner.tsx` — since it's a chewable solid, not a gel; it's also
folded into `generateTimingTimeline()`'s own `solidTypes` set alongside banana/energy
bar/rice cake/dates, so it gets scheduled in the first third of the ride like every other
slow-digesting solid, not with the fast-absorption gels), and three commercial-gel dose
tiers modeled as separate entries rather than one flat figure (🧃 Gel pequeño 25g, Gel
estándar 30g, Gel alta carga/Hydro 45g — a rider can mix doses in the same ride, e.g. 1
standard + 1 high-carb) — not a real nutrition database, same convention as the recovery
meal options. Adding a new catalog item touches three places, all kept in sync: the type/
label/carb-figure triad in `lib/metabolic-engine.ts`, the ordering array in
`components/fueling-planner.tsx`, and `VALID_POCKET_FOOD_TYPES` in
`app/api/fueling/plan/route.ts` — missing that last one would silently strip the new item
out of `sanitizePocketFoodSelection()` server-side, since an unrecognized key is dropped
rather than rejected (this codebase's established "degrade gracefully" convention), which
would make the item calculate correctly in the UI but never actually count server-side.
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
md:grid-cols-2 gap-3`. Each row's border is responsive, not a fixed cell shape at every
width: on mobile, a plain `border-b border-neutral-200` (no side/top borders) so a stacked
list of these reads as clean list rows flush to the full available width, rather than a
column of individually boxed cells eating into already-scarce horizontal space; at `md:`,
where the grid becomes 2 columns and width is no longer scarce, each row gets its own full
`border` back, matching the "each its own soft cell" look this always had at wider widths.
Each cell's
food name is rendered without emoji, in the same clean sans as everything else (via a
local `pocketFoodName()` helper that calls `stripEmoji()`, imported from
`lib/gpx-export.ts` and reused rather than duplicated, on `pocketFoodLabels[type]` at
render time — `pocketFoodLabels` itself keeps its friendly emoji-prefixed copy
unchanged, since that's what feeds the clipboard/GPX nutrition exports elsewhere; only
this one UI surface strips it), with its carb figure directly underneath in `font-mono`
— monospace is reserved for the numeric readout, never the food name, so a name like
"Bollo de arroz" stays unambiguous instead of rendering in a terminal-style face where
similar letterforms (o/u) are easy to misread. The stepper itself went through four
designs before landing on its current compact, transparent, delineated geometry: an
earlier design had −/+ as each their own individually bordered/shadowed square flanking a
bare number (three misaligned pieces rather than one compact control); a second, "PNS
Pill Stepper" pass unified those into one `rounded-full` capsule (`border border-zinc-200
bg-white shadow-sm`); a third pass flattened that capsule to match this app's own button/
field geometry (`rounded-md`, `border-zinc-200/80`, `shadow-none`, `h-8 px-2.5 py-1`) but
then dropped that border for a solid `bg-zinc-100` fill instead, as part of the ninth
"zero-border" pass (see "PNS premium redesign" above); a fourth, current pass reverses
that specific choice — an explicit request for the stepper to read as "compact,
transparent, and delineated" rather than filled — dropping `bg-zinc-100` back to
`bg-transparent` in favor of a thin `border border-zinc-200` outline, and shrinking the
whole control further — `h-7` (from `h-8`), `min-w-20` (from `min-w-24`),
`px-2 py-0.5` (from `px-2.5 py-1`), the −/+ buttons and the quantity digit both stepped
down a notch (`size-5`/`text-sm` and `text-xs font-medium text-zinc-800`, from
`size-6`/`text-base` and `text-sm font-semibold`) — reading as a smaller, quieter widget
that differentiates itself from the card purely through its own outline rather than a
background fill. The −/+ buttons themselves still carry no border/shadow of their own
(`text-zinc-600 hover:text-zinc-900`, `disabled:opacity-30`) — only the wrapper's own
geometry/fill changed across all four passes, not this inner button treatment. The result
panel still
shows a one-line "Comida de bolsillo cubre Xg de Yg HC — el resto va en el bidón" (with a
small `Utensils` icon, not an emoji) whenever any item is selected —
that summary line isn't part of the pocket-food *catalog* UI, so it keeps its emoji.

**Each row's own outer wrapper (not the −/+ stepper control above) also went through a
padding-symmetry fix.** This is `PocketFoodStepperRow`'s own outer `<div>` — the one that
lays the food name/carb figure on the left against the stepper on the right and draws the
divider line beneath each row — separate from the stepper control's own border/radius
history above. It used to pair `border-b border-neutral-200 px-1 py-2.5` on mobile with
`md:border md:px-3 md:py-1.5` at `md:` (a full box per cell once the grid went 2-column) —
a reported visual complaint that each row's text/stepper sat closer to its *bottom* divider
than its top one turned out to trace back to this pairing switching breakpoints mid-list
rather than to any single asymmetric value. Fixed with one consistent treatment at every
width: `border-b border-zinc-100 py-3.5 last:border-b-0` — a plain list-row divider with
strictly symmetric vertical padding (Tailwind's `py-*` always sets top/bottom equally) and
no divider after the final item. The "Personalizado" custom-carbs row (a plain `<div>`
inline in the pocket-food grid, not `PocketFoodStepperRow` itself, but immediately adjacent
in the same list) carried the exact same asymmetric pairing and got the identical fix for
consistency — both rows now read as one uniform list regardless of viewport width, rather
than a mobile list flipping to a grid-of-boxes at `md:`.

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

### Numbered-step input layout (01 · / 02 · / 03 ·)

The planner's *input* half (everything before a result exists) used to be one flat
sequence of controls with no explicit reading order — the mode toggle, the route/quick/
GPX fields, Estrategia nutricional, and Comida en bolsillo all sat in the same undifferen-
tiated column. Restructured to mirror `/perfil`'s own numbered-card convention
(`01 · Métricas físicas...`, `02 · Fenotipo metabólico...`, `03 · Adaptación digestiva...`)
exactly: three separate "tarjeta madre" white cards (`bg-white`, `rounded-xl`, zero border,
zero shadow — this app's established flat-card system), each opening with a
`font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase` eyebrow, spaced
apart by `CardContent`'s own `gap-6` (no change needed there — the three step cards and
the closing CTA are just its direct children now, same as any other top-level block).

- **`01 · Selección y origen de ruta`** — the Ruta Strava/Calculadora/Subir GPX mode
  toggle, plus whichever source-specific fields that mode needs: the route `<select>` +
  map (route mode), Duración/Vatios inputs (Calculadora — these read as "manually
  specifying the ride" and belong here, not in Paso 02, even though they don't involve a
  literal route), or the GPX dropzone + map (GPX mode). This card keeps the exact
  "full-bleed map" structure documented under "Route map preview" above (a `p-4 sm:p-6`
  padded div for the label/select/dropzone, `RouteMapPreview` as a padding-less sibling
  bleeding to the card's own edges, `overflow-hidden` on the outer card clipping the map's
  corners) — Paso 01 *is* that same card now, just with the `01 ·` eyebrow and mode toggle
  added inside its padded section, not a separate wrapper around it.
- **`02 · Condiciones de la salida`** — Intensidad Objetivo (Sub-sección A) and Fecha y
  Hora de Salida (Sub-sección B, `DeparturePicker`), laid out per mode: route mode shows
  both side by side (`sm:grid-cols-2`); Calculadora mode shows only Fecha y Hora, since
  real watts already *is* the intensity input there and there's no natural second control
  to put beside it; GPX mode shows Intensidad + Fecha y Hora + the "Tiempo estimado
  (editar)" override together (`sm:grid-cols-3`, only once a file's been parsed — before
  that, a plain one-line placeholder explains what will appear once one is). No nested
  sub-cards inside this one — `DeparturePicker` was never wrapped in its own box to begin
  with, so simple `gap-5` spacing between the sub-sections was already enough.
- **`03 · Estrategia y comida en bolsillo`** — the Óptimo/Mi Inventario/Híbrido selector
  and its explanatory legend, plus the objetivo/cubierto/déficit breakdown (or its
  "sin calcular aún" placeholder) and the "Comida en bolsillo" accordion — all integrated
  directly as this card's own content rather than the intermediate design's separate
  nested white sub-card. Since Paso 03 itself is already the white "tarjeta madre," the
  breakdown/placeholder's own `bg-[#F8F7F5]` porcelain tint is what keeps it visually
  distinct as a sub-block now — removing the old wrapper didn't remove that inner
  differentiation, just one layer of now-redundant white-on-white nesting around it.
- **The final CTA** ("Calcular estrategia nutricional," the "Ruta objetivo / Competición"
  checkbox, the profile-required banner, and the target-event micro-copy) sits *after* all
  three step cards as their own plain block, not inside any of them — matching `/perfil`'s
  own "single full-width action button after the numbered cards" convention exactly.
- **`CardTitle`'s own styling was overridden for this one card specifically** —
  `text-xl font-semibold text-zinc-900 normal-case tracking-normal`, cancelling the shared
  `CardTitle` default (`text-sm font-bold uppercase tracking-wide`) via `cn()`'s
  later-utility-wins merge — so "Planificador de nutrición" reads like a page-level `<h1>`
  now that it introduces a whole numbered-step structure below it, without changing
  `CardTitle`'s own shared default for every other card in the app. `mb-6` (not the
  literal, unconditional value it might look like) is still paired with `sm:mb-0` — the
  documented fix for `flatMobileCardClass` zeroing `--card-spacing` on mobile still
  applies unchanged; only the title's *own* type styling is new.
- Verified live via a temporary unauthenticated route rendering `FuelingPlanner` directly
  (same Playwright pattern used throughout this project's history) across all three modes
  (Ruta Strava, Calculadora, Subir GPX) at both a 390px mobile viewport and 1280px desktop
  — confirmed each mode's Paso 01/02 content renders correctly, the map still bleeds
  edge-to-edge inside Paso 01, and the closing CTA sits cleanly below Paso 03 in every
  mode.

### Result panel visual hierarchy (Hero card + collapsible technical breakdown)

The result panel used to be one long flat column of same-weight text — every section from
weather to the reload plan competed for the same attention, so the actual headline numbers
(what to mix, how often to drink, whether it's working) were no easier to find than any
supporting detail. Restructured around a "glance vs. dig deeper" split instead:

- **Hero card** — a dark (`bg-[#343334]`, a literal one-off brand-charcoal fill, not a
  reusable token — same convention as `app/icon.tsx`'s hardcoded `#171717` and Strava's own
  `#FC4C02` one-off hex usages elsewhere in this app) card rendered first, directly under
  the result header. Shows only the four numbers an athlete actually needs mid-prep: the
  per-bottle malto/fructose dose in the brand's bright orange (`text-[#FD5A08]` —
  deliberately not `--terracotta`, which is this app's muted UI accent color; this is the
  one spot that intentionally pops with the brighter mark color instead), the hydration
  frequency, the finishing glycogen battery %, and the money saved. Falls back to
  "Cobertura completa vía comida de bolsillo" instead of a nonsensical "0g Malto + 0g
  Fructosa" line whenever `bottlePlan.fuelBottles.count` is `0` (pocket food alone covers
  the ride — see "Hybrid nutrition" above).
- **OBJETIVO / EN BOLSILLO / DÉFICIT EN BIDÓN progress bar** — originally replaced three
  separate badge pills with a single two-segment rail (`bg-sage` for the covered fraction,
  `bg-terracotta/20` for the remainder) plus the three raw figures above it, stacking to one
  column below `sm:` (an earlier three-column-with-`truncate` version cut the numbers
  themselves off on a narrow phone — verified: "DÉFICIT EN BIDÓN 336g HC" truncated to
  "DÉFICIT EN …" — which defeats the entire point of a scannable metric). **A later
  "Reestructuración UX/UI: Estrategia y Comida en Bolsillo" pass superseded this rail
  entirely** — see the note under "'Comida en bolsillo' accordion" immediately below for
  the current shape.
- **"Comida en bolsillo" accordion** — the pocket-food catalog/stepper grid (see "Hybrid
  nutrition" above) sits behind a `<details>`, headed by a clear section title ("Comida en
  bolsillo," bold uppercase `font-mono`) plus a live "N items seleccionados · Mg HC" summary
  computed from `getPocketFoodTotalCarbsG()` against whichever selection is actually in
  effect (the athlete's own `pocketFood` state in every mode except Óptimo, where it's
  `result.pocketFood` — the server-computed selection — since the athlete never edits it
  there). An earlier version of this header was a single line of plain `font-medium` text
  on a flat gray-on-white `<summary>` with no visual distinction between title and count —
  it read as a generic, already-collapsed accordion rather than a live section header, so
  it was split into two visually distinct pieces (bold title left, muted count right) the
  way every other section header in this app already reads.

  **The objetivo/cubierto/déficit breakdown moved *inside* this same `<details>`, directly
  below its `<summary>` header row, and was simplified from a 3-column colored grid + a
  progress bar into one discreet single-line porcelain banner.** Before this, it floated as
  its own heavy `space-y-2 rounded-lg bg-[#F8F7F5] p-4` box *above* the entire accordion —
  disconnected from "Comida en bolsillo"'s own header/counter one step below it, so the
  mode selector, the breakdown, and the inventory header/list read as three loosely-adjacent
  sections rather than one continuous flow. Now the sequence inside Paso 03 is: mode
  selector → its explanatory legend → the accordion (`<summary>`: "Comida en bolsillo" +
  "N items seleccionados · Mg HC" counter, unchanged) → immediately inside its content,
  a plain `bg-[#F8F7F5] rounded-lg p-3 text-xs font-mono text-zinc-600` banner reading
  "OBJETIVO Xg HC · CUBIERTO Yg HC · RESTANTE Zg HC" (renamed from "EN BOLSILLO"/"DÉFICIT EN
  BIDÓN" to "CUBIERTO"/"RESTANTE" to match this pass's own wording) → the food-item grid.
  The 3 separately-colored (neutral/emerald/terracotta) uppercase labels and the 2-segment
  `bg-sage`/`bg-terracotta/20` progress rail are both gone outright, not just restyled —
  a deliberate simplification to a single neutral-toned text line, matching the request's
  own literal "banner discreto" spec rather than a lighter version of the old colored/
  progress-bar treatment. The empty-state placeholder ("Calcula tu estrategia para ver el
  desglose...") moved to the same location for the same reason, with matching styling.

  **Default open/closed state now depends on the selected Estrategia nutricional** (see
  "Fueling mode selector" below), rather than always starting closed: Mi Inventario and
  Híbrido are the two modes where this list is genuinely the athlete's own input (not a
  server-computed preview), so both start expanded — collapsing on load hid the one control
  those two modes actually revolve around, forcing an extra tap before the athlete could see
  or touch anything. Óptimo has nothing to configure here (server-computed), so it's the
  one mode that still starts collapsed. Implemented as `<details key={fuelingMode} open=
  {fuelingMode !== "optimal"}>` — the `key` is what makes this work correctly: without it,
  React's own prop-diffing could silently skip re-applying `open` on a re-render where the
  prop's value happened not to change, so switching modes might not reliably force a fresh
  open/closed state. Keying by `fuelingMode` forces a full remount on every mode switch,
  so `open` always re-applies as a genuinely fresh initial value — but *between* mode
  switches (the same key), the athlete's own manual collapse/expand via the native
  `<summary>` click is never fought or reverted, since React only re-writes `open` when its
  value actually changes between renders. Verified live: Mi Inventario starts open,
  switching to Óptimo collapses it, switching to Híbrido reopens it, a manual collapse
  sticks until the next mode change, and switching between two non-Óptimo modes (Híbrido →
  Mi Inventario) still forces it back open each time, exactly as intended.

  **"Separación Estructurada" pass — split Paso 03 into two explicit sub-blocks with their
  own margins, replacing the shared-`gap-*` approach above.** A reported "elementos
  amontonados" complaint found the mode selector, its legend, and the inventory header
  reading as one undifferentiated cluster rather than two related-but-distinct sections.
  Fixed by giving each element its own explicit `mb-*` (not a flex `gap-*` on a shared
  wrapper) so the exact rhythm is controllable per-relationship: **Sub-bloque A** (Selector
  de Estrategia) is the "03 ·" eyebrow (`mb-3`), the Óptimo/Mi Inventario/Híbrido buttons
  (`mb-2.5`), then the mode's explanatory legend (`mb-6` — deliberately the most generous
  gap in the block, since it's what visually separates Sub-bloque A from Sub-bloque B
  below it); **Sub-bloque B** (Inventario de Bolsillo) is the `<details>` itself
  (`mt-6`, collapsing with the legend's own `mb-6` above it in this non-flex parent, but
  kept explicit on both sides for clarity/future-proofing), its `<summary>` header row
  (unchanged), then the status banner (bumped from `mb-2` to `mb-4` — an explicit ≥16px
  gap before the first food row specifically, per this pass's own literal spec) before the
  food-item grid. The banner's wrapping `<div>` dropped its `flex flex-col gap-3` — with
  the banner now carrying its own `mb-4`, a shared flex gap on top of that would have
  stacked to a bigger, unintended total gap rather than the precise ≥16px asked for.
- **Pocket-food row padding tightened**: `PocketFoodStepperRow` and the "Personalizado"
  custom-carbs row both stepped from `py-3.5` down to `py-2.5` (still one flat value at
  every breakpoint, so this doesn't reopen the original breakpoint-switching padding bug
  documented under "Hybrid nutrition" above — that bug was about *switching* padding pairs
  across `sm:`, not about `2.5` itself being asymmetric) — a smaller, less congested list
  now that the surrounding sub-blocks have more breathing room of their own.
- **The wrapping grid's own `gap-3` was then found to be double-spacing every row on top
  of that per-row padding** — each row already draws its own `border-b border-zinc-100
  py-2.5` divider, so a real CSS `gap` on the grid container added a *second*, redundant
  gutter between rows, on top of what the rows' own padding already provided. Fixed by
  dropping the grid to `grid-cols-1 gap-0 md:grid-cols-2 md:gap-x-4 md:gap-y-0` — `gap-0`/
  `md:gap-y-0` remove the vertical gutter entirely (rows are now delimited purely by their
  own `border-b`, at every breakpoint), while `md:gap-x-4` survives just to keep the
  2-column desktop layout's side-by-side items from touching horizontally.
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
  is the documented pattern for it. Tile layer is **CartoDB Positron**
  (`basemaps.cartocdn.com/light_all`) — a free, no-API-key, genuinely light/minimalist
  basemap (pale porcelain land, muted pastel-blue water, faint gray roads/labels), rendered
  with **no CSS filter at all**. The route itself is drawn in `#6E6658` — this app's own
  `--terracotta` bronze/taupe accent. This went through two colors: an earlier request
  specifically asked for Strava's literal icon orange (`#FC5200`) by name, a deliberate
  one-off exception to this app's usual "route line uses a muted gold/bronze accent, not a
  literal brand color" rule at the time — reversed on a later request back to that muted
  bronze rule, since the neon-bright Strava orange read as an off-brand intrusion against
  RATIO's own sober, editorial PNS palette once the novelty of "the Strava look by name"
  wore off. Every other bronze accent in the app (buttons, borders) already uses
  `--terracotta`; the map polyline now matches them exactly rather than being the one
  literal-brand-color exception. `weight: 3.5`, `opacity: 1`, `lineCap`/`lineJoin: "round"`
  — unchanged across both colors, already within the range a later request asked to
  confirm (3.5–4px weight, 0.95–1.0 opacity). A second, wider (`weight: 6`), near-black
  (`#1a1a1a`) `Polyline` at `opacity: 0.15` is rendered directly underneath the real route
  line — Leaflet's `Polyline` has no `box-shadow`-equivalent prop of its own, so stacking a
  second, more transparent stroke beneath the visible one is the standard way to fake a
  soft drop shadow, giving the route a little depth over the flat pale terrain. Both
  colors are kept as literal hex strings, since Leaflet's `Polyline` `color` prop needs a
  plain string, not a class name — `ROUTE_LINE_COLOR`'s value happens to be identical to
  what `--terracotta` resolves to, so a future palette refinement touching that token
  should update this constant too. This is the one shared `RouteMapPreview` component
  behind both the Pre-Ruta map (Fueling Planner's Ruta widget) and the Post-Ruta map
  (Post-Ride Analysis's telemetry card), so the color applies to both automatically with
  no per-call-site change needed.
- **From a filter-derived dark "Strava Dark Mode Topo" back to a genuinely light, Apple
  Maps-style basemap.** This tile went through four full iterations before landing here —
  the first three all pursued a *dark* map and are kept below as a record of what was tried
  and why each one was superseded; the fourth reversed course entirely back to a light map,
  which is the current, live implementation:
  1. **First attempt**: keep CartoDB's light `light_all` tile and invert it dark via a CSS
     filter (`grayscale(100%) invert(90%) contrast(120%) brightness(85%)`). Reported as
     reading "muddy" — `light_all`'s land and roads start at *similar* light luminance
     values, so inverting them crushes both to similarly-dark tones with too little
     separation between them.
  2. **Second attempt**: switch the tile source to CartoDB's real dark `dark_all`
     ("Dark Matter") basemap instead of inverting the light one, with a lighter
     `brightness(185%) contrast(105%)` filter on top to lift its own somewhat-muted default
     palette. Fixed the legibility/muddiness complaint, but `dark_all` is fundamentally
     *monochrome* (graphite land, silver-gray roads/labels, no color differentiation at
     all) — a problem once a later request specifically asked for a colorful "Strava Dark
     Mode Topo" look (navy sea, forest green, slate urban, distinct from each other by
     *hue*, not just grayscale value): a monochrome tile has no color information left for
     any CSS filter to recover; `hue-rotate`/`saturate` on a grayscale source does nothing,
     since there's no saturation to rotate.
  3. **Third attempt**: switch tile providers to **OpenTopoMap** — a genuinely multi-hue
     basemap (blue sea, green forest, tan/brown elevation bands, gray urban areas) that just
     happens to be designed *light* (dark label text). The classic
     `invert(100%) hue-rotate(180deg)` pairing made it work as a dark map (inverting flips
     lightness — dark labels become light, light terrain becomes dark — while the
     compensating hue rotation approximately restores each color's original hue), with
     `contrast`/`saturate` tuning richness on top. This is the version documented in every
     "Dark Vector HUD"/"PNS premium redesign" pass below, and it worked as specified at the
     time — verified live against real coastal/mountain terrain (Sa Calobra) and a dense
     city (Palma de Mallorca).
  4. **Fourth, current attempt — reversal back to a light map.** A later request asked to
     drop the dark-map aesthetic entirely in favor of a simple, clean, low-contrast look
     "similar to Apple Maps / Mapbox Light." Since the destination was light anyway, this
     didn't need a filter tuned against a dark basemap at all — it's simpler and more
     faithful to switch straight to a tile that's *natively* the look being asked for:
     **CartoDB Positron** (`light_all`, see above), zero CSS filter. This is a genuine
     simplification, not just a fourth filter recipe — `TILE_DARK_FILTER_CLASS` was deleted
     outright, not replaced with a lighter equivalent.
  The delivery mechanism (Leaflet's `TileLayer`/`GridLayer` `className` option, applied to
  the tile layer's own container `<div>` — a sibling of the overlay pane the `Polyline`
  renders into, so a filter would only ever reach the basemap tiles, never the route line
  or custom chrome) is unchanged in principle across every iteration; it's simply unused
  now that there's no filter to apply.
- **The "Ruta" select and its surrounding widget went light too.** The route
  selector/map used to float on a near-black "Obsidian" card
  (`bg-[#181818]`) with its own dark `<select>` variant
  (`selectableFieldDarkClass` — a solid `bg-[#242424]` fill, `border-white/15`,
  `text-zinc-100`) — the one deliberately dark surface in an otherwise all-light UI, built
  specifically to house the dark map. Once the map itself moved to a genuinely light
  basemap, keeping this wrapper dark would have looked like a light map trapped inside a
  black frame, so the whole widget was restyled to `border-zinc-200/60 bg-surface
  shadow-sm` (this app's own porcelain-adjacent "read-only container" token) with plain
  `text-zinc-500`/`text-zinc-900` labels — one continuous light surface, no separate dark
  island. `selectableFieldDarkClass` is now genuinely dead code (its one call site switched
  to the ordinary `selectableFieldClass`) and was deleted from `lib/ui-classes.ts` outright
  rather than left unused "just in case."
- **Reworked a second time into a pure-white, edge-to-edge "map card."** A follow-up
  request asked for the map to occupy 100% of its card with zero internal padding,
  bleeding directly to the card's own edges (`overflow-hidden` clipping the map's corners
  to match), while the outer widget itself joined this app's "pure white card, zero
  border, zero shadow" system — inverting the prior `bg-surface` widget/white-select
  pairing to a white widget/porcelain-select one. `components/fueling-planner.tsx`'s Ruta
  widget is now `overflow-hidden rounded-xl bg-white shadow-none` with **two direct
  children**: a `p-4 sm:p-6`-padded inner `<div>` holding the "Ruta"/"Recargar" label row
  and the `<select>` itself (now a one-off `bg-[#F8F7F5] border-0 text-zinc-900` treatment,
  not the shared white `selectableFieldClass`, so it reads as a porcelain sub-block nested
  *inside* the now-white card), and `RouteMapPreview` as a plain sibling *with no padding
  of its own*. Because the map is the last child and the padded label section sits only
  above it, the map bleeds edge-to-edge on its left/right/bottom — the outer card's own
  `overflow-hidden` + `rounded-xl` is what clips the map's rectangular Leaflet container
  into the card's rounded bottom corners, exactly like a photo bleeding to the edge of a
  media card while its caption text stays padded. `RouteMapPreview` itself is passed
  `className="mt-0 rounded-none"` at this one call site specifically to override its own
  default `mt-3`/`rounded-lg` (via the `cn()`/Tailwind-merge the component already
  supports) — its default styling (self-contained, bordered — well, no longer bordered,
  see below — `rounded-lg` box with its own top margin) is otherwise unchanged for its
  other call sites (GPX mode's standalone map, Post-Ride Analysis's own telemetry-card map)
  where there's no surrounding white card to bleed into.
- **Every border on the map itself and its floating chrome was also removed**, as part of
  a wider app-wide "100%-frameless" pass (see "Zero-border pass" under "PNS premium
  redesign" below for the full sweep this belongs to): `RouteMapPreview`'s own container,
  the `MapZoomControls` `+`/`−` buttons, and the distance/elevation badge all dropped their
  `border-zinc-200/60` — the zoom buttons and badge still read fine as translucent
  `bg-white/80 backdrop-blur-md` glass chips against the map tiles with no outline at all.
  Their absolute-positioning offset also grew from `top-2 left-2`/`bottom-2 left-2` to
  `top-3 left-3`/`bottom-3 left-3` — a slightly more generous margin now that there's no
  border of their own eating into that space visually.
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
  calculator mode, which has no geographic data at all. A floating badge in the map's
  bottom-left corner echoes the same distance/D+ figures the route `<select>`/GPX filename
  line already show, for at-a-glance reference without needing to scroll back up — a
  translucent *light* glass chip (`bg-white/80 text-zinc-900 backdrop-blur-md shadow-sm`,
  no border — see the "100%-frameless" bullet above), matching the map's own reversal back
  to a light basemap (replacing the dark-glass `border-white/15 bg-[#181818]/80
  text-zinc-200` treatment this carried through the "Dark Vector HUD" passes).
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

**Route map, exact date/time stamp, and a "Cambiar salida" quick switcher** were added on
top of that same card — a title alone isn't enough to confirm *which* ride is being
audited when several rides share a generic/duplicate name (e.g. a club's usual weekday
loop), so the card now shows the ride's actual GPS shape and its exact start time, plus a
fast way to jump to a different recent ride. This went through two passes: the map first
landed as a small fixed `16rem` side column, then was widened significantly once it read
as too small/square relative to the rest of the card — and the same pass removed the
standalone "Actividad" selector + "Analizar" button entirely, making "Cambiar salida"
inside the card the *sole* control for picking which ride gets analyzed:

- **Map** — `fetchActivityDetail()` (`lib/strava.ts`) now also returns `summaryPolyline`
  (Strava's `map.summary_polyline` on the `/activities/{id}` detail response, the same
  field `StravaActivity.map` already carries on the list/sync side); the route decodes it
  via the existing `decodePolyline()` (`lib/polyline.ts`) and returns the resulting
  `points: [number, number][] | null` on `activity`. `components/post-ride-analysis.tsx`
  reuses `components/route-map-preview.tsx`'s `RouteMapPreview` (dynamically imported
  with `ssr: false`, same as the Fueling Planner's own usage) rather than a second map
  component. `RouteMapPreview` gained two optional props to support this second call
  site: `className` (merged via `cn()`/Tailwind-merge) and `emptyMessage` (this card's own
  "Sin datos de trazado GPS para esta actividad." copy for an indoor/GPS-less ride,
  replacing the planner-specific default string that made no sense outside that context).
- **Layout** — went through three iterations before landing on a genuine middle ground.
  First, map and stats stacked (`flex flex-col`) at every width, the map only a compact
  `h-36` even on desktop — too small/square, with dead space beside it. Second, the map
  grew to the *entire* card width at `lg:aspect-video lg:h-auto` (a real 16:9 rectangle,
  measured live as `1178×662px` at 1280px) — a dramatic overcorrection that pushed every
  stat below the fold on anything but a tall screen. The current version is a bounded
  side-by-side `md:grid-cols-12` layout: `RouteMapPreview` takes `md:col-span-5` at a
  *capped* `md:h-52` (208px — contained and elegant, not stretching with the card's width
  the way `aspect-video` did), the stats grid takes `md:col-span-7` and reverts from
  `sm:grid-cols-4` to `md:grid-cols-2` (a 4-column row would be cramped in a 7/12-width
  column; 2 columns gives 5 stats a clean 2-2-1 layout instead), and `md:items-center` on
  the outer grid centers the map vertically against the taller stats block beside it.
  Mobile is untouched throughout every iteration — still the original stacked `h-36` map
  above a `grid-cols-2 sm:grid-cols-4` stat row.
- **Zoom controls** — Leaflet's own default `+`/`−` control is disabled
  (`zoomControl={false}` on `MapContainer`) and replaced with `MapZoomControls`, a small
  `useMap()`-based component rendering two plain Tailwind buttons in its place: no
  Tailwind class can reach into Leaflet's own bundled CSS to restyle its default control,
  and that default read as disproportionately large/heavy next to this app's otherwise
  compact chrome. Went through several iterations: two buttons sharing one bordered/
  shadowed pill, then two independent light `bg-white/90` squares, then — during the
  "Dark Vector HUD"/"Strava Dark Mode Topo" passes — two translucent *dark*-glass squares
  matching the map's then-dark colorful topo tiles. Once the map itself reversed back to a
  genuinely light basemap (see "Route map preview" above), these reverted to a light-glass
  treatment too: `size-7 border-zinc-200/60 bg-white/80 text-zinc-900 shadow-sm
  backdrop-blur-md`, `hover:bg-white` — the same clear/frosted "Apple Maps floating
  control" look as the distance badge. This is a change to the shared `RouteMapPreview`
  component, so it applies equally to the Fueling Planner's own map
  usage, not just this card.
- **Date/time stamp** — `formatActivityDateTime()` builds "Martes 28 de Julio · Inicio a
  las 17:30h" from three separate `Intl`/`toLocaleDateString` calls (weekday, day, month,
  time) rather than one combined format string, since `es-ES`'s own long-date output
  ("martes, 28 de julio") lowercases every word and this app's convention capitalizes the
  weekday/month (not "de") for a cleaner, more legible stamp.
- **"Cambiar salida" — the only activity picker.** A native `<select>` (no custom dropdown
  primitive exists in this codebase) inside a persistent `<label>` reading "Cambiar
  salida," listing the athlete's `ACTIVITY_SWITCHER_LIMIT` (5) most recent activities,
  positioned opposite the "Ruta sincronizada..." badge in the card's header row. Picking
  one calls `handleSwitchActivity()`, which updates `selectedId` and immediately re-runs
  `handleAnalyze()` against the newly picked id — `handleAnalyze()` has an optional third
  `activityIdOverride` parameter specifically for this, since `setSelectedId` doesn't take
  effect until the next render and the analysis call needs the *new* id immediately, not
  whatever `selectedId` still held in the current closure. The standalone "Actividad"
  `<select>` + "Analizar" button that used to sit above this card were removed outright —
  showing the same "which ride?" choice twice (once above the fold, once inside the card)
  was pure duplication once this switcher existed. In their place, a `useEffect` that runs
  once on mount calls `handleAnalyze()` for whichever activity `selectedId` already
  defaults to (`activities[0]?.id`, the most recent one) — the very first analysis of a
  session now happens automatically rather than waiting on a manual trigger that no longer
  exists. A plain "Analizando tu última salida…" line covers that initial loading window
  (`loading && !result`), distinct from the RPE picker/error states that can still follow it.
- **Data-provenance footnotes.** Below the existing "Cálculo de deuda metabólica..." line,
  two more small footnotes cite where each figure actually came from: temperature (a `Sun`
  icon, "Temperatura de ruta: X°C — vía Open-Meteo") and the glycogen calculation basis (a
  `Zap` icon, reusing the exact same dynamic `sourceLabels[result.source]` text already
  shown next to the "Deuda de Glucógeno" header — e.g. "calculado a partir de tus zonas de
  potencia reales" — rather than a hardcoded claim like "basado en tu NP y FTP," which
  would be simply false whenever the real source is heart-rate or self-reported RPE
  instead). `POST /api/post-ride/analysis` now also returns `activity.temperatureAvgC`
  (Strava/Open-Meteo's `activities.temperature_avg`, already read server-side for the
  fluid-loss formula, just not previously returned to the client) — the temperature
  footnote only renders when that figure isn't `null`.

Verified end-to-end at every layout iteration (map decode → render → switcher →
re-analyze, auto-load on mount, the old selector's absence, and the map's measured box
size at 390/768/900/1280px — `288×142` on mobile, growing from `262×206` to `476×206` in
the `md:` side-by-side layout, capped height confirmed at every width) via a temporary,
unauthenticated route rendering `PostRideAnalysis` directly with a mocked
`/api/post-ride/analysis` response (Playwright route interception, not real Strava data —
there's no live Strava session available in this environment) — removed again before
committing, same verification pattern used for the Strava route-caching work earlier.

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

#### Map unified with Pre-Ruta (badge and "Cambiar salida" removed)

A later pass asked for the Post-Ruta telemetry card's map to become visually identical to
the Pre-Ruta Fueling Planner's own "01 · Selección y origen de ruta" widget — same
full-bleed treatment, same shared `RouteMapPreview` chrome — rather than the bounded
`md:grid-cols-12` side-by-side layout documented above. Two elements were removed outright
to get there, both explicitly requested:

- **The "Ruta sincronizada desde Strava" emerald status pill** — gone from the card header
  entirely, with nothing replacing it.
- **The "Cambiar salida" `<select>` switcher** — also gone entirely, with no replacement
  control anywhere in this UI. This is a genuine functionality removal, not just a visual
  one: per the "Telemetry card" documentation above, "Cambiar salida" was *the sole way to
  pick which ride gets analyzed" once the earlier standalone "Actividad" selector +
  "Analizar" button had already been removed in its favor. With both gone, `PostRideAnalysis`
  now only ever shows the athlete's single most recent synced ride (`activities[0]`,
  auto-loaded on mount) — there is no in-UI path to audit an older ride anymore. Flagged
  here transparently, matching this codebase's "flag rather than silently invent" convention,
  in case ride-switching is wanted back in a future pass (elsewhere in the UI, not
  necessarily this card).

  Removing the switcher meant `handleSwitchActivity()`, the `ACTIVITY_SWITCHER_LIMIT`
  constant, and the now-unused `ChevronDown` import were all deleted outright as genuinely
  dead code (no remaining caller) — `handleAnalyze()`'s `activityIdOverride` parameter,
  which existed solely to serve the switcher's stale-closure problem, was removed too, and
  `selectedId`'s own setter (`setSelectedId`) dropped from its `useState` destructure since
  nothing calls it anymore (`const [selectedId] = useState(...)`, read-only for the
  lifetime of the component now).

**Layout: padded content on top, map bleeding full-width at the bottom** — replacing the
`md:grid-cols-12` side-by-side split (map as a `md:col-span-5` side column, stats as
`md:col-span-7`) with the exact structural pattern Pre-Ruta's own Ruta widget uses: one
`overflow-hidden rounded-xl bg-white shadow-none` shell, a `p-4` padded inner `<div>`
holding the ride name/date, the stat grid (now a plain `grid-cols-2 sm:grid-cols-4` row at
every width — the `md:grid-cols-2` variant that used to exist specifically to fit 5 stats
into a narrower 7/12 column is gone now that stats span the card's full width again), and
the footnotes — followed by `RouteMapPreview` as a padding-less sibling, passed
`className="mt-0 rounded-none"` (the same override Pre-Ruta's Ruta widget already uses) so
it bleeds edge-to-edge and the outer card's own `overflow-hidden`/`rounded-xl` clips the
map's corners instead of the map having its own. Since this is the exact same shared
`RouteMapPreview` component, its tiles, route-line color, and floating zoom-control/badge
chrome are pixel-identical to Pre-Ruta's map by construction, not a second hand-tuned copy.
The `loading && !result` skeleton (see "Granular loading states" above) was updated to
mirror this same shape — a padded muted-stat block over a plain `h-48 w-full
animate-pulse bg-neutral-200/60` full-bleed rectangle, replacing its own prior
`md:grid-cols-12` mirror.

Verified live via the same temporary-route/Playwright pattern used throughout this
project's history (`PostRideAnalysis` rendered with a mocked `/api/post-ride/analysis`
response including a real decoded-looking polyline) at 390px mobile and 1280px desktop —
confirmed the badge and switcher are both gone, the map bleeds edge-to-edge with its
distance/D+ badge and `+`/`−` zoom controls intact, and the stat grid/footnotes render
correctly above it at both widths.

#### "Análisis Post-Ruta Estilo Strava Mobile" (map-first ordering, Title Case metrics)

A later pass reordered this same card again — a request to mirror Strava's own mobile
activity-summary hierarchy exactly, for user familiarity — superseding the ordering from
the section above (which put the padded name/date + stat grid *before* the map). The card
inside the `overflow-hidden rounded-xl bg-white shadow-none` shell now stacks, top to
bottom:

1. **The map** — `RouteMapPreview`, unchanged (`className="mt-0 rounded-none"`, same
   shared tiles/route-line color/floating zoom-control/badge chrome as Pre-Ruta), but now
   the card's very first child rather than sitting below the stats — nothing (no badge, no
   dropdown) ever renders over the canvas.
2. **A quiet metadata line** — a small `Bike` icon (`lucide-react`) plus
   `formatActivityDateTime()`'s output, now reformatted to "martes 28 de julio a las
   18:58h" (lowercase weekday/month, "a las" instead of the previous "· Inicio a las" —
   this line is deliberately quiet/secondary now, not a stamp worth capitalizing), with
   `· {location}` appended when Strava has a resolved location for the ride.
3. **The activity title** — `result.activity.name` alone, as a plain `text-xl font-bold`
   `<h3>` — no longer paired with the date directly beneath it (the date moved to the
   metadata line above), matching Strava's own "title reads as its own headline" layout.
4. **A 2-column metrics grid** — `grid-cols-2 gap-x-6 gap-y-5`, Title Case labels
   (Distancia, Desnivel Positivo, Tiempo en Movimiento, Potencia Media, Velocidad Media,
   Calorías) replacing this app's usual `UPPERCASE tracking-widest` stat-label convention
   for this one grid specifically — and, unlike every other numeric readout in this app,
   **no `font-mono`** on the values (`text-lg sm:text-xl font-bold text-zinc-900
   tracking-tight`), a deliberate one-off exception matching Strava's own plain-sans
   numeral display, scoped to this grid alone (every other stat block in this file —
   Glucógeno quemado, Balance Neto, Fase 1/2, etc. — keeps `font-mono` unchanged).
   **Velocidad Media** is a new figure, computed client-side
   (`distanceKm / durationHours`, guarded against a zero-duration edge case) rather than
   fetched — Strava doesn't return a separate average-speed field this app was already
   pulling, and distance/duration were already on hand. **Calorías** reuses
   `telemetry.energyKcal` but labeled "Cal" (Strava's own short unit) instead of this
   app's usual "kcal," scoped to this one card. Frecuencia cardíaca — part of the *previous*
   5-stat grid — is deliberately **not** one of the 6 metrics here (the spec's exact layout
   has no 7th cell and no heart-rate slot), but the real figure isn't dropped: it moved into
   the footnote list below (a new `HeartPulse` icon line, "Frecuencia cardíaca media: X ppm"
   — only rendered when Strava actually has one, never a fabricated "-- ppm" placeholder the
   way the old primary-grid cell used to show for a sensor-less ride, since a footnote is
   supplementary and simply omits itself when there's nothing real to report).
   Distancia now shows 2 decimals (`toFixed(2)`, e.g. "50.40 km" vs. the previous "50.4
   km") to match Strava's own precision — the underlying `distanceKm` value is still only
   rounded to 1 decimal server-side, so `toFixed(2)` just pads a trailing zero rather than
   asserting false precision. Tiempo en Movimiento deliberately keeps this app's existing
   `formatHoursMinutes()` output ("1h 29m") rather than switching to Strava's own
   "1:29:00" h:mm:ss style — the literal example text was read as illustrative, not a
   mandate to plumb raw seconds through the API and diverge from every other duration
   display in this app (the Fueling Planner's own estimated-duration readout uses the same
   helper).
5. **Data-provenance footnotes** — not part of the requested layers, kept (now sitting
   below the grid, inside the same padded section, `px-5 py-3 border-t`) purely so real
   data this app already surfaces elsewhere (heart rate, route temperature, the glycogen
   calculation's source tier) is never silently dropped by a redesign that didn't ask for
   its removal — flagged here per this codebase's "flag rather than silently invent /
   silently drop" convention.

**New field: `activity.location`.** Strava's `/activities/{id}` detail response can carry
a reverse-geocoded `location_city`/`location_state` — `StravaActivityDetail` in
`lib/strava.ts` now returns both (`locationCity`/`locationState`, `null` whenever Strava
has neither on file — an indoor ride, a privacy zone, or a location Strava never resolved;
never a fabricated guess), and `POST /api/post-ride/analysis` joins them into one
`activity.location` string (`null` when both are empty) for the metadata line to consume.

Verified live via the same temporary-route/Playwright pattern (mocked API response
including a `location: "Palma, Balearic Islands"` field and full telemetry) at 390px
mobile and 1280px desktop — confirmed the map renders first with no badge/dropdown over
it, the metadata line reads correctly with the bike icon and location, the title renders
as a clean bold headline, all 6 metrics render in a proper 2-column grid with Title Case
labels and non-monospace bold values, and the footnotes (including the relocated heart-rate
line) render correctly below.

#### "Jerarquía Visual Strava" — title/metadata before the map, and a real skeleton loader

A follow-up pass reordered this same card again (superseding the map-first ordering just
above) and replaced the loading state entirely:

- **Order flipped back**: title → metadata → map → grid, not map → metadata → title →
  grid. Inside the still-unchanged `overflow-hidden rounded-xl bg-white shadow-none`
  shell, the activity name is now the first thing rendered (`<h3 className="mb-1
  text-xl font-bold tracking-tight text-zinc-900">`, `px-5 pt-5` on its own wrapping
  `<div>` alongside the metadata line directly beneath it, `mb-4`), then `RouteMapPreview`
  (unchanged, still `className="mt-0 rounded-none"` so it bleeds edge-to-edge — the map's
  *position* moved, its own full-bleed treatment didn't), then the metrics grid.
- **The metadata line reverted to this app's original, non-Strava-mobile date format** —
  "Martes 28 de Julio · Inicio a las 18:58h" (capitalized weekday/month, "· Inicio a las"
  phrasing) — `formatActivityDateTime()` and its `capitalize()` helper (both deleted in the
  prior pass) are back, verbatim. The `· {location}` suffix from the prior pass is kept
  (not asked to be removed, and it's real data — see "Análisis Post-Ruta Estilo Strava
  Mobile" above for where `activity.location` comes from).
- **The metrics grid dropped from 6 cells back to 5**, matching this exact request's own
  literal example: Distancia, Tiempo en Movimiento, Potencia Media, Gasto Energético
  (renamed back from "Calorías"/"Cal" to "kcal," this app's usual unit label), Frecuencia
  Cardíaca — an odd count in a 2-column grid, so the last row is one cell wide with the
  second column empty, exactly as the request's own code sample shows. **Desnivel
  Positivo and Velocidad Media, both added in the prior pass, are gone from this grid** —
  not silently lost, though: elevation gain is still visible on the map's own floating
  distance/D+ badge (`RouteMapPreview`'s existing badge, unchanged), and average speed was
  always a trivial `distanceKm / durationHours` derived from two figures still shown here,
  not an independent sourced value worth preserving in a footnote the way a real sensor
  reading would be. **Frecuencia Cardíaca returns as a primary grid cell** (it had been
  moved to a footnote in the prior pass) — rendered with the same graceful-degradation
  pattern as Potencia Media (`text-zinc-400`/"N/A" when Strava has no heart-rate data for
  this ride, real value in `text-zinc-900` otherwise), so its footnote line and the now-
  unused `HeartPulse` icon import were both removed. Cell classes also dropped the
  previous pass's `tracking-tight`/`sm:text-xl`/`text-center sm:text-left` in favor of the
  request's own literal `text-lg font-bold text-zinc-900`/`text-left` at every width.
- **Skeleton loader replaces the "Analizando tu última salida…" status pill and `--`
  placeholders entirely.** The spinning-pill notice plus per-stat muted dashes (this app's
  loading-state convention up to this point — see "Granular loading states" above) read as
  a generic "please wait" notice rather than a preview of the content about to appear, so
  this one card's loading branch now renders pulsing gray blocks shaped like the real
  content instead: a title-width bar + a shorter metadata-width bar, a full `h-48
  sm:h-56` map-shaped rectangle, then 5 label+value pairs in the same `grid-cols-2` shape
  as the real grid (one `animate-pulse` on the outer wrapper drives every block, rather
  than each element declaring its own). The skeleton shows 5 placeholder cells, not the
  4 a minimal mockup might imply, specifically to keep matching the real grid's true item
  count — this app's own established "a loading fallback must mirror the real eventual
  shape" convention (see "Granular loading states" above), applied to a skeleton that was
  otherwise implemented close to verbatim from the literal code given.

Verified live via the same temporary-route/Playwright pattern, including a deliberately
delayed (4s) mocked `/api/post-ride/analysis` response to actually capture the loading
branch mid-flight (not just the resolved state) — confirmed the skeleton renders as pulsing
gray blocks with no "Analizando…" text and no literal `--` anywhere, and the resolved card
shows the title first, the capitalized "Martes 28 de Julio · Inicio a las 18:58h · Palma,
Balearic Islands" metadata line, the map directly below it, and the 5-cell Title Case grid
(Frecuencia Cardíaca alone in its own row) — at 390px mobile (both loading and resolved
states) and 1280px desktop (resolved state).

#### Auto-sync on tab load ("Estrategia de Caché e Invocación Strava")

Opening the Dashboard used to only ever reflect whatever `activities` rows already existed
from a previous manual "Sincronizar" click (see "Strava OAuth" above) or the first-login
bootstrap — a ride finished since the athlete's last visit wouldn't show up in the Post-Ruta
tab's own ride list at all until they remembered to click that button. **`ensureLatestActivitySynced()`**
(`lib/dashboard-data.ts`, `cache()`-deduped like every other Server-Component data helper in
this file) makes opening the tab itself the trigger instead — `PostRideAnalysisSection`
(`app/(app)/page.tsx`) now calls it before `getRecentActivities(8)`, so a newly-completed
ride is already in the database by the time the ride list renders.

This is a thin wrapper, not new sync logic: it resolves `userId`/a valid Strava access
token the same way `getStravaRoutes()` already does, then calls the *exact same*
`syncLatestActivity()` (`lib/strava-sync.ts`) that `POST /api/strava/sync`'s button handler
and the first-login bootstrap both already use. That function already implements the
requested caching contract end to end:

- **Cheap check first** — `fetchLatestRideActivity()` finds the athlete's latest *cycling*
  activity (deliberately `per_page=30`, sport-type filtered — not a literal `per_page=1` as
  a first read of this feature's own brief might suggest; a bare `per_page=1` would
  reintroduce the exact bug that lookback window was widened to fix: a run/swim/gym session
  logged between rides pushing the athlete's last real ride out of a 1-activity window, see
  "Strava OAuth" above), then a plain `activities.select("id").eq("id", activityId)` existence
  check against Supabase.
- **Instant/no-op when nothing's new** — if that id already exists as a row, the function
  returns immediately; no weather sampling, no metabolic-engine run, no write. This *is* the
  "cached, don't spend API quota or recompute" fast path the brief asks for — it was already
  built, just never wired into the tab-open moment specifically.
- **Full sync only for a genuinely new ride** — samples route weather (or the indoor
  placeholder), computes `carbs_burned_g`/`fluid_loss_ml`/`sodium_loss_mg` via
  `lib/metabolic-engine.ts` (when FTP is set), and upserts the new row — identical to a
  manual "Sincronizar" click.

Best-effort and silent on failure, same convention as the first-login bootstrap's own sync
calls in `app/api/auth/strava/callback/route.ts` — a Strava hiccup here is caught and
logged, never thrown, so it can't break the whole Post-Ruta panel; the ride list just falls
back to whatever was already synced from an earlier visit. Not wired into
`FuelingPlannerSection` — that tab's own routes/average-speed data has its own 24h
`unstable_cache` policy (see "Strava saved-routes cache" above) and isn't about "did a new
ride just finish," a concern specific to Post-Ruta.

#### "Reestructuración UX por Tarjetas Numeradas" — 3 independent white cards, Perfil-style

The result panel used to be one long flowing column inside a single outer `<Card>` — a
"muro de texto" the brief specifically asked to break apart into 3 numbered white cards
sitting on the Dashboard's own porcelain canvas, matching `/perfil`'s own numbered-card
convention. This landed as a genuinely structural change, not a class-name tweak, because
`/perfil` and the Pre-Ruta Fueling Planner actually implement "numbered cards" two
different ways, and only one of them produces real porcelain gaps between cards:

- **`/perfil`** renders 3 fully independent `<Card>` primitives directly on the page's own
  `bg-background` canvas (see `app/(app)/perfil/page.tsx`) — the porcelain page color is
  genuinely visible *between* each card, since there's no shared outer shell tying them
  together.
- **The Fueling Planner** (`components/fueling-planner.tsx`) instead wraps its whole "01 ·
  / 02 · / 03 ·" step sequence in *one* outer `<Card>` (`CardTitle` "Planificador de
  nutrición"), with the 3 numbered steps as plain `<div>`s inside that Card's own
  `CardContent` — visually separated from each other by whitespace (`gap-6`) alone, not by
  a color change, since the shared outer shell and every inner step are all `bg-white`.

This pass followed `/perfil`'s pattern specifically, since the brief's own literal spec
(`bg-white border-0 shadow-none rounded-xl p-5 mb-6` per card, "sobre el fondo porcelana
bg-[#F8F7F5]") describes independent cards with real color contrast between them, not
nested divs sharing one white shell. Concretely:

- **The old `<Card><CardHeader><CardTitle>Análisis post-ruta</CardTitle></CardHeader>
  <CardContent>...</CardContent></Card>` wrapper is gone.** `PostRideAnalysis` no longer
  imports `Card`/`CardHeader`/`CardContent`/`CardTitle`/`flatMobileCardClass` at all. In its
  place: a plain `<h2 className={sectionHeadingClass}>Análisis post-ruta</h2>` sitting
  directly on the canvas (`sectionHeadingClass` reproduces `CardTitle`'s own former default
  styling verbatim — `font-heading text-sm font-bold tracking-wide text-neutral-900
  uppercase` — so the heading's visual weight is unchanged, just no longer inside a card),
  followed by independent top-level siblings: the loading skeleton, the error line, the
  `needsRpe` picker, and — once a result exists — 3 numbered cards. Every one of these
  (including the zero-activities empty state and the `needsRpe`/loading skeleton) now uses
  the literal `rounded-xl border-0 bg-white shadow-none` treatment directly, no shared
  `flatMobileCardClass` mobile-flattening — matching `/perfil`'s own Cards, which don't
  flatten on mobile either.
- **Tarjeta 01 · Actividad y métricas principales** — unchanged in content from the
  "Jerarquía Visual Strava" pass above (title → metadata → full-bleed map → 5-cell grid →
  footnotes); only its wrapper gained an explicit `border-0` to literally match the brief's
  "Cero Bordes" rule (it never had one, but the class is now explicit rather than implied).
  Deliberately has **no** numbered eyebrow of its own — it's the hero/summary card, and the
  "01 ·"/"02 ·" sequence below it starts fresh rather than continuing from a "00" this card
  doesn't have.
- **Tarjeta 02 · Gasto metabólico y consumo en ruta** (eyebrow "01 · DEUDA METABÓLICA Y
  REGISTRO REAL," using the exact same `font-mono text-xs font-bold tracking-widest
  text-neutral-500 uppercase` class as `/perfil`'s own `cardNumberHeading`, not a
  near-identical one-off string) — folds the Glucógeno quemado/Líquido perdido/Sodio
  perdido stat row and the "¿Qué consumiste realmente...?" consumption sub-block into one
  card. The old "Deuda de glucógeno · {name}" + source-label header line above the stat row
  was dropped as pure duplication once this card gained its own eyebrow — the same source
  label already appears in Tarjeta 01's own footnote ("Glucógeno: {sourceLabels[...]}"), so
  nothing was silently lost. The consumption sub-block's own porcelain wrapper
  (`bg-[#F8F7F5] rounded-lg p-4`) is unchanged in tone, but its 3 preset pills and 3 input
  rows switched from their own `bg-[#F8F7F5]`/`bg-zinc-100` fills to plain `bg-white` — a
  porcelain-on-porcelain nesting would have had zero visual differentiation once this
  sub-block's *parent* (Tarjeta 02 itself) also became porcelain-adjacent; white reads
  clearly against the porcelain wrapper instead. **"Guardar consumo real" changed from a
  small `w-fit` pill (`primaryButtonClass`, uppercase font-mono) to a full-width button**
  matching the brief's own literal spec — `w-full rounded-md py-2.5 text-sm font-medium`,
  `bg-terracotta` (this app's own design token, not the brief's literal `#6E6658` hex —
  identical value, but this codebase's own "reuse the token, never hardcode the hex"
  convention wins) — a deliberate one-off departure from `primaryButtonClass`'s shared
  uppercase/font-mono/tracking-wider treatment used by every *other* primary button in the
  app, scoped to this one button per the brief's explicit styling.
- **Tarjeta 03 · Balance neto y pauta de recuperación** (eyebrow "02 · BALANCE NETO Y
  RECUPERACIÓN BIFÁSICA") — folds the Balance Neto rows and the biphasic recovery target
  (Fase 1/Fase 2/Grasas límite/Rehidratación) into one card. The Balance Neto wrapper's own
  redundant inner "Balance neto de recuperación" eyebrow was removed (the card-level one
  above it already says this), and its padding tightened from `p-4` to the brief's literal
  `p-3`. The biphasic block's own former `eyebrow`-styled "Objetivo de recuperación
  post-ruta" heading was removed too (again, now covered by the card-level eyebrow) — its
  "Ventana bifásica..." explanatory line stays, just as a plain, unheaded line at the top
  of that sub-section.
- **Now genuinely dead**: the file-local `eyebrow` const and the `Separator` import/usage
  (the divider between the old burn-stat row and the consumption block) — both deleted
  outright rather than left unused, since neither has a remaining call site once the 3
  cards absorbed everything that used to sit between them.

Verified live via the same temporary-route/Playwright pattern (mocked API response, plus a
second pass with `activities={[]}` for the empty state) at 390px mobile and 1280px desktop
— confirmed all 3 cards render as visually independent white boxes with the porcelain
canvas clearly visible in the gaps between them (not just around the outer edge the way the
single-shared-Card approach would have shown it), the full-width terracotta "Guardar
consumo real" button, and the empty/zero-activities state rendering as its own single white
card rather than the old Card-wrapped version.

#### "Unificación de Títulos y Padding Estándar" — matching Pre-Ruta's title, p-4 everywhere

A later pass asked for maximum visual coherence between the two Dashboard tabs: the same
title typography on "Análisis post-ruta" as Pre-Ruta's own "Planificador de nutrición," and
a standardized `p-4` card density in place of the `p-5` this section's cards had carried
since the "Reestructuración UX por Tarjetas Numeradas" pass above.

- **`sectionHeadingClass`** (`components/post-ride-analysis.tsx`) — used to match
  `CardTitle`'s own *default* styling (`font-heading text-sm font-bold tracking-wide
  text-neutral-900 uppercase`), preserving the old `<CardTitle>Análisis post-ruta
  </CardTitle>` shell's visual weight from before this component stopped wrapping its
  content in a `Card` at all. Now matches `fueling-planner.tsx`'s own `CardTitle`
  *override* instead — `"text-xl leading-snug font-semibold tracking-normal text-zinc-900
  normal-case"` — since that's the class string that actually determines "Planificador de
  nutrición"'s rendered style (`CardTitle`'s `uppercase`/`font-bold`/`tracking-wide`/
  `text-neutral-900`/`text-sm` defaults are all overridden there; `leading-snug` survives
  unclaimed in both, since neither override string touches line-height). The two headings
  now render byte-for-byte identical in size, weight, and case.
- **Every top-level white card in this file stepped from `p-5` to `p-4`** — the empty
  state, the loading skeleton, the `needsRpe` prompt, and all 3 numbered cards (Tarjeta
  01's title/metadata block and metrics grid, Tarjeta 02, Tarjeta 03). Tarjeta 01's metrics
  grid also dropped `gap-x-6 gap-y-5` to a flat `gap-x-4 gap-y-4` (matching the loading
  skeleton's own mirrored grid, updated identically), and its footnotes block's `px-5`
  became `px-4` to stay flush with the card's own new padding.
- **Nested porcelain (`bg-[#F8F7F5]`) sub-blocks stepped down proportionally** — the ones
  that were `p-4` (the consumption sub-block, Balance Neto's wrapper, Fase 1/Fase 2/Grasas
  límite/Rehidratación) moved to `p-3.5`, one notch below the new `p-4` card padding around
  them; the one sub-block that was already `p-3` (the RPE-driven telemetry stat block) was
  left as-is — both `p-3` and `p-3.5` are within the range this pass asked nested blocks to
  use.
- **Deliberately left untouched: `FuelingPlanner`'s own `p-4 sm:p-6` card padding.** This
  request's concrete edits were explicitly scoped to "la sección 'Análisis post-ruta'"
  only — Pre-Ruta's cards were the *reference* for the title-typography match, not
  themselves named for a padding change. `FuelingPlanner`'s numbered-step cards already
  render at `p-4` on mobile (identical to Post-Ruta's new flat `p-4`), but still widen to
  `p-6` at `sm:` and up — a residual desktop-only density difference between the two tabs,
  flagged here transparently rather than silently resolved by expanding scope on an
  inference the request didn't actually make.
- Verified via `npm run build` (clean) and a live Playwright check (mocked Strava route +
  mocked `/api/post-ride/analysis` response) at 390px — confirmed "Planificador de
  nutrición" and "Análisis post-ruta" now render with identical title typography, and
  Post-Ruta's cards show the tighter `p-4` density with `p-3.5` nested sub-blocks.

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
lost inputs and `weightKg` from the API response) for instant per-keystroke recompute.

**Quick-add consumption presets.** A rider reconstructing a ride from memory thinks in
items eaten, not raw grams — `CONSUMPTION_PRESETS` (`+1 Gel` +25g HC, `+1 Bidón` +30g HC /
+400mg sodio / +0.5L, `+1 Barrita` +35g HC, illustrative fixed doses, same "not a real
nutrition database" convention as the pre-ride planner's own pocket-food catalog) render
as one-tap buttons directly above the three manual inputs. `applyConsumptionPreset()` adds
a preset's doses on top of whatever's already typed (never replaces it, since the rider
might tap several presets across the same ride) and clears `consumptionSaved` like any
other edit.

**Balance Neto de Recuperación — visual card grid, not plain-text equations.** The old
"GASTADO 250g − INGERIDO EN RUTA 180g = DEUDA NETA A REPONER 70g" inline-text line (one per
metric) is now `BalanceNetoRow`, a `grid-cols-3` block per metric (Carbohidratos/Líquido/
Sodio, stacked) showing Gastado/Ingerido/Deuda neta as three labeled cells — the debt
figure in `text-terracotta` (this app's one accent color, not a new hardcoded hex) since
it's the number that actually drives the recovery target below it. Sits immediately above
the "Objetivo de recuperación post-ruta" section (see "Biphasic recovery window" below),
still reading from the locally-recomputed `recoveryDebt`, with a footer note that the
target is "calculado sobre la deuda neta real."

#### Biphasic recovery window ("Fase 1" vs "Fase 2")

A single lump carb figure hides that post-exercise glycogen replenishment isn't uniform
over the recovery window — the first ~30-45 minutes are the only stretch where muscle
glucose uptake happens largely through insulin-independent GLUT-4 translocation
(exercise-induced, not diet-induced), so a fast liquid source (a shake, juice, fruit)
capitalizes on a window that then closes, rather than waiting for a slower solid meal.
`getBiphasicRecoveryTarget({ carbsDebtG, proteinG })` (`lib/metabolic-engine.ts`, pure)
splits the athlete's **full net carb debt** (`recoveryDebt.carbsDebtG`) by a fixed
`RECOVERY_PHASE_1_CARB_FRACTION` (35%, the midpoint of the commonly-cited 30-40% GLUT-4
window) into `phase1.carbsG` (immediate) and `phase2.carbsG = carbsDebtG - phase1.carbsG`
(the remaining ~65%, so the two always sum back to the debt with no rounding leakage) —
**deliberately the uncapped debt, not `recoveryTarget.carbsG`**. An earlier version split
the capped target instead, which meant phase1+phase2 could silently sum to *less* than the
"Deuda Neta a Reponer" figure already shown in the Balance Neto section right above it,
whenever `getMacroRecoveryTarget`'s own 1.2g/kg calorie ceiling actually bound (a large
debt on a lighter athlete) — reading as if the two sections disagreed about the same
number. Verified live with a deliberately cap-triggering scenario (500g debt, 60kg athlete
→ 72g capped target): phase1 (166g) + phase2 (309g) now sum to exactly 475g, matching the
Balance Neto row's own "Deuda neta 475g" figure, not the smaller capped target. Protein is
untouched by this split and rides entirely in `phase2` — same rationale as
`getMacroRecoveryTarget` itself: it's about muscle repair, not the carb debt, so spreading
it across an all-liquid phase 1 dose isn't standard practice. `components/
post-ride-analysis.tsx` renders this as two side-by-side blocks ("Fase 1 · 0-45 min ·
inmediata" and "Fase 2 · 1.5-2h · comida principal", `Zap`/`Utensils` icons, no emoji)
above a smaller 2-card row for Grasas límite and Rehidratación — `biphasicRecoveryTarget`
is its own `useMemo` derived from both `recoveryDebt` and `recoveryTarget` (needs
`recoveryDebt.carbsDebtG` directly now, alongside `recoveryTarget.proteinG`), so editing
the in-ride-consumption inputs updates the phase split instantly along with everything
else on this card.

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

- **`SummaryCard`** — the same four figures the old Dashboard panel showed (Cumplimiento
  7D, Promedio ingesta, Gut Training, Balance hídrico), moved here — see the figures' own
  documentation below. **Gut Training's headline stat was later switched** from the
  self-reported `athlete_profiles.gut_training_level` figure to
  `gutTrainingTierFromIntake(weekly.avgIntakeGPerHour)` — the exact same real-intake-
  derived "Nivel X" tier `/historial` already computes (see "Sidebar navigation..." below)
  — so the two screens can never show conflicting Gut Training labels for the same
  athlete. `weekly.gutTrainingLevel` (the self-reported field) is still fetched and still
  used by `RecommendationCard` below, just no longer for this card's own display.
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
- **Gut training** — `WeeklyPerformance.gutTrainingLevel` itself still reads straight from
  the self-reported `athlete_profiles.gut_training_level` (always real, never depends on
  any week's ride data) — but `SummaryCard`'s own headline "Capacidad digestiva" stat no
  longer displays this field directly; see the `SummaryCard` bullet above for why.
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

### Mandatory profile completion (navigation guard)

An athlete with no usable Physiological Profile used to still be let onto the Dashboard,
with the Fueling Planner and Post-Ride Analysis each independently hard-blocking on their
own via a shared `ProfileRequiredCard` component (a bordered "Calibración fisiológica
requerida" card, one per tab, each with its own `title`/`description`). That approach still
let an incomplete profile browse to Estadísticas/Historial, which read weight/FTP/
sweat-rate/gut-training data those pages assume is real, and meant the same underlying
problem — "you haven't finished onboarding" — surfaced through several independent render
branches rather than being handled once. Replaced with a hard navigation guard instead: an
incomplete profile simply can't reach any route but `/perfil` at all, and `/perfil` itself
funnels straight back to the Dashboard the moment it's completed (see "First save → straight
to the Dashboard" below).

- **`proxy.ts`'s Edge Middleware is the actual enforcement.** After the existing auth check
  (no session → `/login`), a second check runs for every authenticated request that isn't
  `/perfil` itself, isn't an `/api/*` route, and isn't one of the public paths: it queries
  the athlete's own `athlete_profiles` row (`weight_kg, ftp, gut_training_level,
  sweat_rate` — RLS-scoped through the same request-bound `supabase` client the auth check
  above already built) and, if `isProfileDataComplete()` (see below) says it's incomplete,
  redirects to `/perfil`. `/api/*` routes are deliberately exempt — they already return
  their own `{ error: "no_profile" }` JSON (`POST /api/fueling/plan`, `POST
  /api/post-ride/analysis`), and a middleware redirect to an HTML page would silently break
  whatever `fetch()` call expected JSON back instead.
- **`lib/profile-completeness.ts`** — `isProfileDataComplete(fields)`, a tiny,
  dependency-free predicate (no `"server-only"`, no Supabase import) pulled out specifically
  so both `proxy.ts`'s Edge Middleware and ordinary Server Components can evaluate the exact
  same rule without sharing a query helper across two runtimes that otherwise can't share
  one. `lib/dashboard-data.ts`'s pre-existing `isProfileComplete(profile)` — a plain
  `Boolean(profile?.weight_kg && profile?.ftp && profile?.gut_training_level &&
  profile?.sweat_rate)`; every one of those four columns is `NOT NULL` in `athlete_profiles`
  once a row exists, so this only ever differs from a bare `profile !== null` check if a
  future migration relaxes one of them — now just delegates to this shared predicate, so
  every existing caller (unchanged signature) automatically stays in sync with what the
  middleware enforces.
- **`app/(app)/layout.tsx`** additionally calls `getAthleteProfile()`/`isProfileComplete()`
  itself and passes the boolean down to `DashboardShell` as `isProfileComplete` — purely for
  the Sidebar's own visual affordance below, not enforcement (the middleware already
  handled that before this layout ever renders). Since the middleware guarantees `/`,
  `/estadisticas`, and `/historial` only ever render with a complete profile, this can in
  practice only ever be `false` while rendering `/perfil` itself — the layout has no access
  to the current pathname (Server Component layouts aren't given one), so it computes the
  same boolean unconditionally rather than trying to guess which route triggered the
  render. `getAthleteProfile()`'s `cache()` dedupe means this costs no extra query on
  `/perfil` (which already calls it for the form itself) and is the only query this adds on
  the other three routes.
- **Sidebar lock (`components/dashboard-shell.tsx`)** — `NAV_ITEMS` distinguishes two
  independent lock reasons per entry: `permanentlyDisabled` (Estadísticas/Historial,
  in-dev — see "Sidebar navigation..." below) and a computed `lockedByIncompleteProfile`
  (every entry but `/perfil` itself, while the `isProfileComplete` prop is `false`). Both
  render through the same locked-entry markup (no icon, `opacity-50 cursor-not-allowed
  select-none`), but only a `permanentlyDisabled` entry shows the "Próximamente" pill — a
  profile lock isn't "coming soon," so that badge on a temporarily-locked Dashboard would be
  a misleading claim. The `title` tooltip differs too ("Completa tu perfil fisiológico para
  desbloquear esta sección" vs. "Sección en desarrollo — Próximamente"). In practice this
  can only ever be *seen* while sitting on `/perfil` with an incomplete profile, since the
  middleware makes every other route unreachable in that state anyway — this sidebar
  treatment exists to avoid a pointless click-then-redirect-bounce, not as the actual
  enforcement.
- **`app/(app)/page.tsx` no longer checks profile completeness at all.**
  `FuelingPlannerSection`/`PostRideAnalysisSection` render the real `FuelingPlanner`/
  `PostRideAnalysis` unconditionally — a complete profile is a guaranteed invariant by the
  time this page ever renders, not something to branch on. Both pass `isProfileComplete` as
  a literal `true`. This also let a "two-stage Suspense gate" architecture that used to live
  here collapse back to one boundary per tab: `FuelingPlannerSection` had grown a nested
  inner `<Suspense>` specifically so its detailed `FuelingPlannerSkeleton` fallback couldn't
  be shape-committed before the profile check resolved (see "Granular loading states"
  above) — now that there's no second possible outcome left to guard against, it goes
  straight to `<Suspense fallback={<FuelingPlannerSkeleton />}>` again.
  `PostRideAnalysisSection` is unchanged in shape (still `DashboardSectionSkeleton`) but no
  longer calls `getAthleteProfile()` at all — the FTP-gated "Al llegar" tab check
  (`!profile?.ftp`) that used to render `ProfileRequiredCard` here is gone along with it.
- **`components/profile-required-card.tsx` was deleted outright** — its only two call sites
  are gone, and per this codebase's dead-code convention a component with zero remaining
  callers doesn't stay around "just in case."
- **Left untouched**: `ProfileRequiredBanner` (`components/profile-required-banner.tsx`) and
  the `isProfileComplete` prop/lock-button logic inside `FuelingPlanner`/`PostRideAnalysis`
  themselves — a locked-looking button (`Lock` icon, `bg-neutral-200 text-neutral-400
  cursor-not-allowed`) plus the amber `ProfileRequiredBanner` underneath, still a correct,
  harmless defensive layer for either component being reused somewhere this guard doesn't
  cover in the future. Doubly unreachable now through the Dashboard specifically — both the
  middleware guard *and* the hardcoded `true` above guarantee it — but deliberately not
  ripped out, same reasoning as before this pass.

### First save → straight to the Dashboard

`POST /api/athlete-profile/update`'s success redirect changed from `/perfil?profile_saved=1`
to `/?profile_saved=1`. Every successful save through this route necessarily leaves a
complete profile — the route's own field-by-field validation already rejects anything short
of that before the upsert ever runs — so, since completing the form is the one thing
standing between an incomplete-profile athlete and the rest of the app, saving now lands
them on the Dashboard immediately rather than requiring a second, manual navigation.
`app/(app)/page.tsx`'s `Home()` reads `?profile_saved=1` and renders the shared
`ProfileSavedToast` the same way `/perfil` used to (same component, same "Perfil
actualizado" copy — see "Athlete profile" below) — `/perfil`'s own handling of that query
param was removed since the redirect can never target `/perfil` anymore, which made it dead
code.

### Eliminating profile fallbacks

Confirmed root cause of "data still shows up after deleting the athlete's row": several
spots silently substituted a plausible-looking placeholder (`"medium"`, `"intermediate"`,
a fabricated DB row) whenever `weight_kg`/`ftp`/`sweat_rate`/`gut_training_level` were
missing, instead of a genuine empty state — so a deleted-then-recreated profile (or a
brand-new athlete who's never opened `/perfil`) could still read as "already configured."
Fixed at every layer:

- **The real root cause** — `app/api/auth/strava/callback/route.ts`'s "zero-friction
  weight sync" used to `INSERT` a brand-new `athlete_profiles` row the instant *any*
  athlete connected Strava with a known weight, filling `ftp`/`sweat_rate` with a
  hardcoded `200`/`"medium"` placeholder pair just to satisfy the table's `NOT NULL`
  columns — a fully-formed-looking profile the athlete never actually entered. Now only
  ever `UPDATE`s an *existing* row's `weight_kg`; a first-time athlete has no
  `athlete_profiles` row at all until they submit the real Physiological Profile form
  themselves (see "Strava OAuth" above).
- **The one legitimate exception** — Strava's own real weight reading is still used to
  *prefill* `/perfil`'s weight input (never persisted early): **`getStravaAthleteWeightKg()`**
  (`lib/dashboard-data.ts`) re-derives a live Strava access token and calls `fetchAthlete()`,
  returning `null` on anything (not connected, no weight on file, an API hiccup) — same
  best-effort convention as every other Strava read in this file.
  `PhysiologicalProfileCard` (`app/(app)/perfil/page.tsx`) only calls it when
  `getAthleteProfile()` returned `null`, and only ever feeds the result into the weight
  input's `defaultValue` (`profile?.weight_kg ?? stravaWeightKg ?? ""`) — an athlete who
  already has a row already has their own real `weight_kg`, so there's nothing to prefill.
- **`/perfil`'s form defaults** — the sweat-rate cards (`defaultChecked={profile?.sweat_rate
  === rate}`, no `?? "medium"`) and **`GutTrainingSelector`** (`defaultLevel:
  GutTrainingLevel | null`, `useState<GutTrainingLevel | null>`) now start with genuinely
  *no* card selected when there's no profile, rather than one silently pre-checked as if
  the athlete had already chosen it. `gut_training_level` is `NOT NULL` in the DB, so
  submitting with nothing picked already redirects to `invalid_gut_training_level` via
  `/api/athlete-profile/update`'s existing validation — no new client-side `required`
  needed. The FTP/weight number inputs already used `?? ""` before this pass (an empty
  field, not a fabricated number) and needed no change.
- **The calculation engines never fabricated a value in the first place** — `POST
  /api/fueling/plan` and `POST /api/post-ride/analysis` both already return
  `{ error: "no_profile" }` (400) outright when `athlete_profiles` has no row, rather than
  computing against a stand-in; `lib/strava-sync.ts`'s nutrition figures are `null` unless
  a real `ftp` is present. Two genuinely *unreachable* defensive fallbacks were still
  removed for consistency with this pass: `post-ride/analysis`'s `FALLBACK_WEIGHT_KG = 70`
  (dead code — the route's own `no_profile` check above it already guarantees a real,
  `NOT NULL` `weight_kg` by the time it's read) and `strava-sync.ts`'s `sweat_rate ?? "medium"`
  (same reasoning — reachable only once `athleteProfile.ftp` is already confirmed truthy,
  meaning the whole row, sweat rate included, is real).
- **`WeeklyPerformance.gutTrainingLevel`** (`lib/dashboard-data.ts`, feeds `/estadisticas`'
  `RecommendationCard`) used to fall back to `"intermediate"` whenever there was no
  `athlete_profiles` row — now `GutTrainingLevel | null`, `null` when there's genuinely no
  profile. **`getIntakeRecommendationNote()`** (`lib/metabolic-engine.ts`) accepts that
  `null` and returns a plain "configura tu nivel de Adaptación Digestiva..." prompt instead
  of silently comparing real intake against a level the athlete never chose.
- **"Fenotipo metabólico" cards, follow-up pass** — a first pass left these three cards'
  own `defaultChecked={(profile?.athlete_type ?? "balanced") === type}` untouched, reasoned
  as real equipment/phenotype data with a genuine DB-level default rather than fabricated
  physiological calibration. Revisited: even with a real DB default, silently pre-selecting
  "Balanced" for an athlete who has no profile row at all yet still reads as "already
  configured" when it isn't — now a plain `defaultChecked={profile?.athlete_type === type}`,
  same treatment as the sweat-rate cards. `athlete_type` is `NOT NULL` with no way to
  literally store "unset," so — like sweat rate and gut training level — submitting the
  form with no phenotype card picked simply omits the field from `FormData`, which
  `/api/athlete-profile/update`'s existing validation already redirects as
  `invalid_athlete_type`. `bottle_count`/`bottle_capacity_ml` remain untouched — genuine
  bike-equipment config, not physiological calibration, and still outside what's been
  reported. `scripts/seed.ts`'s fixture profile is unaffected too — local dev-only tooling,
  not a runtime code path a real athlete could ever hit.

The FTP-gated "Al llegar" tab check, the shared `ProfileRequiredCard`, and the two-stage
Suspense gate architecture that all used to live in this section have since been superseded
by the mandatory-profile-completion navigation guard — see "Mandatory profile completion"
above for the current mechanism.

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
is the entire check (checked or not, never invalid). The "Capacidad por bidón" `<select>`'s
own JS `defaultValue={profile?.bottle_capacity_ml ?? 500}` (`app/(app)/perfil/page.tsx`) —
a plain product decision, a smaller starting assumption than the DB column's own `750`
default — diverges from that DB-level default on purpose: since a profile row is now only
ever created via this same form's real submission (see "Eliminating profile fallbacks"
above), the DB column default is never actually the value that lands in a new row; whatever
this form's own `<select>` shows pre-selected is. "Soportes de bidón" keeps its existing `2`
default — only the capacity default changed. Uses `.upsert({ id: userId,
... })` rather than a select-then-update/insert branch, since `athlete_profiles.id` is the
primary key and Supabase's upsert already handles "create if missing, update if present"
in one call. On success, redirects to `/?profile_saved=1` (same query-param convention as
`profile_error`/`strava_error`, but landing on the Dashboard rather than `/perfil` itself —
see "First save → straight to the Dashboard" above for why), which
`components/profile-saved-toast.tsx` (`"use client"`) reads to render a self-dismissing
confirmation toast ("Perfil actualizado" / "Guardado automáticamente"). This used to be a
one-off `fixed bottom-6 right-6` box — which, in practice, could read as overlapping the
form content it floated near rather than a clearly-separate global notification — and now
renders through the shared `Toast` component (`components/toast.tsx`, see "Shared `Toast`
component" below) instead: the same fixed bottom-center white pill `SyncForm`'s Strava-sync
confirmation already used, so both toasts in the app now look and behave identically.
Auto-hides after 3s and strips the query param via `router.replace(pathname)` (the
*current* path via `usePathname()`, not a hardcoded one, so the same component stays
correct if it's ever reused from another page) so a manual refresh doesn't keep re-showing
a stale confirmation. On invalid input or an RLS block, redirects to
`/perfil?profile_error=<code>` instead, same non-silent-failure convention as everywhere
else. `PhysiologicalProfileCard` (`app/(app)/perfil/page.tsx`) is a thin Server Component
that `await getAthleteProfile()`s on every request (the page exports `dynamic =
"force-dynamic"`, and this Next.js version's `fetch` calls are uncached by default — see
"Route dynamic rendering" below) and passes the result straight into
**`PhysiologicalProfileForm`** (`components/physiological-profile-form.tsx`), which owns
the entire `<form>` — see "Unified client-side form validation" below for why this moved
off a plain server-rendered form.

### W/kg performance readout (01 · Métricas físicas y equipamiento)

A read-only, purely-derived power-to-weight readout next to that card's own numbered
eyebrow — FTP and Peso are already the two fields directly beneath it, and their ratio is
a genuinely useful number athletes recognize (the standard TrainerRoad/Coggan power-profile
banding) that this app had never surfaced anywhere.

- **`getWkgCategory(wkg)`** (`lib/metabolic-engine.ts`) — a plain classification function,
  same "heuristic, not clinical" convention as the rest of this file: 6 fixed bands
  (Principiante/Recreacional/Intermedio/Avanzado/Competitivo-Elite/Pro-Excepcional) each
  with an illustrative percentile label. Explicitly documented as a rough placement, not a
  precise percentile — a real power-profile chart also varies by test duration (5s/1min/
  5min/20min) and sex, neither of which this app collects. Used *only* to label this one
  pill; never fed into any fueling/recovery calculation elsewhere in this file.
- **`wkg`/`wkgCategory`** (`components/physiological-profile-form.tsx`) — computed directly
  from the form's own `weight`/`ftp` controlled state (`Number(ftp) / Number(weight)`,
  guarded to `0` whenever either isn't yet a valid positive number, via the same
  `weightValid`/`ftpValid` booleans the form's own validation already computes) — a plain
  derived value recalculated on every render, not `useMemo`'d, since the computation itself
  (one division plus a 6-branch comparison) is trivial next to a component that already
  re-renders on every keystroke anyway. **Never its own input and never persisted** — the
  server route has no `wkg` column to save it to; it's trivially re-derivable any time both
  real values are on hand, so persisting it would just be a second source of truth that
  could drift from the two fields it's computed from.
- **The readout itself — plain inline text, no box.** The first version wrapped this in a
  `bg-[#F8F7F5] border border-zinc-200/60 rounded-md` pill; a later "Sin Badge / Sin
  Píldora Gris" request explicitly asked for the boxed treatment gone entirely, in favor of
  clean editorial `font-mono` text sitting flush against the "01 ·" eyebrow — `flex
  shrink-0 items-center gap-1.5 font-mono text-xs whitespace-nowrap text-zinc-800`, with
  `{wkg.toFixed(2)} W/kg` bold (`text-zinc-900`), a muted `·` separator, and the category
  label in `text-zinc-500`. Still deliberately no accent color — a quiet technical readout,
  not a call-to-action competing with the actual form fields, just without the container
  that used to carry that intent. Sits in the same row as the "01 ·" eyebrow via `flex
  flex-wrap items-center justify-between gap-2` — `flex-wrap` (not a rigid single row) lets
  it drop to its own line below the longer eyebrow label on a narrow phone instead of both
  squeezing onto one forced row and each wrapping awkwardly mid-word (verified live at
  390px: the eyebrow and the readout each render as one clean line, the readout below the
  eyebrow). `whitespace-nowrap` keeps "3.47 W/kg · Intermedio" as one unbroken line once it
  has its own full-width row to sit in.
- **Deliberately no distribution chart on this screen** — reserved for a future
  Estadísticas addition; this pass is the readout only.

### Unified client-side form validation

Three inconsistent validation UIs used to coexist on this one form: FTP/Peso relied on the
browser's own native `required` popup ("Rellena este campo"), sweat rate's only feedback
was a full-width red banner that only appeared *after* a real server round trip
(`/perfil?profile_error=invalid_sweat_rate`), and "Guardar cambios" was clickable
regardless of whether the form was actually complete. `PhysiologicalProfileForm` unifies
all three into one client-side validation pass:

- **`noValidate`** on the `<form>` turns off every native browser popup — this component
  now owns 100% of the validation UX, native and custom can't coexist without one
  contradicting the other.
- **`isFormValid`** — `Boolean(weightValid && ftpValid && athleteType && sweatRate &&
  gutTrainingLevel)`, recomputed on every render from real controlled state (`useState` for
  each of the five required fields — Peso/FTP moved from `defaultValue` to `value`/
  `onChange`; `athleteType`/`sweatRate`/`gutTrainingLevel` from `defaultChecked` to
  `checked`/`onChange`). `bottle_count`/`bottle_capacity_ml`/`is_salty_sweater` are
  controlled too (also moved off `defaultValue`/`defaultChecked`, see "Dirty-tracking gate"
  below) but still aren't part of `isFormValid` — a `<select>` is never "empty," and an
  unchecked checkbox is never invalid, so there's still nothing to validate on any of the
  three.
- **Dirty-tracking gate (`hasChanges`/`canSave`)** — a later pass found "Guardar cambios"
  enabled the instant every required field was filled, even when reopening `/perfil` with an
  already-complete profile and touching nothing at all; the button stayed clickable for a
  save that would write back the exact same row. `hasChanges` (`useMemo`) compares each of
  the 8 fields' current state against the `profile` prop's own values — `profile` doubles as
  the "initial snapshot" with no separate ref needed, since a real save is a native `<form>`
  POST that redirects the whole browser (to the Dashboard on success, back to `/perfil` with
  a query-string error on failure) rather than an in-place client update, so the component
  always remounts with a fresh `profile` whenever it matters. `canSave = isFormValid &&
  hasChanges && !isSubmitting` is what the submit button's `disabled` prop and styling key
  off now, not `isFormValid` alone. The disabled treatment itself reuses this app's existing
  neutral "inert" look (`border-neutral-200 bg-neutral-300/30 text-neutral-400 opacity-60
  shadow-none`) rather than introducing a new muted-token pair — a helper line under the
  button distinguishes *why* it's disabled: "Completa todos los campos obligatorios..." when
  `!isFormValid`, or "Modifica al menos un dato para poder guardar." when the form is valid
  but untouched.
- **`touched`** — a `Partial<Record<field, boolean>>` so a brand-new athlete's entirely
  blank form doesn't render five red errors before they've typed anything; a field only
  becomes `invalid` (touched **and** still empty) once the athlete has actually interacted
  with it. Text inputs mark themselves touched `onBlur`; the three radio-card groups
  (Fenotipo/Sudoración/Gut Training) mark themselves touched via a **blur-bubbling**
  handler on the group's own wrapping `<div>` (`!e.currentTarget.contains(e.relatedTarget)`
  — fires only once focus genuinely leaves the whole group, never when moving between
  cards inside it), since clicking a radio already sets a value and a single radio has no
  meaningful "blur while still empty" moment of its own.
- **Inline errors, not a global banner** — an invalid text input gets `border-red-500
  focus:border-red-500 focus:ring-red-500`; an invalid radio-card group gets a `ring-1
  ring-red-500` on its wrapping grid; both render a `Campo obligatorio` micro-text
  (`font-mono text-[11px] text-red-500`) directly underneath. The old full-width top banner
  driven by `profileErrorMessages`'s per-field codes (`invalid_weight`, `invalid_sweat_rate`,
  etc.) was deleted outright — every one of those codes is now unreachable through the UI
  (the submit button is `disabled` until `isFormValid`), so surfacing them as a page-level
  banner was pure redundancy. `profileErrorMessages` is now a deliberate **allowlist**
  holding only `no_session`/`update_blocked_by_rls` — genuine server/infra failures with no
  client-side equivalent to catch them, the one class of error that still needs *some*
  visible surface; an unrecognized code renders nothing rather than resurrecting the banner.
- **Still a real native `<form action="/api/athlete-profile/update" method="POST">`** —
  nothing about the actual submission mechanism changed, every input keeps its original
  `name` so the server route's `formData.get(...)` parsing is untouched, and that route's
  own validation stays in place as a defense-in-depth backstop. `isSubmitting` (flipped
  `onSubmit`, before the real POST/redirect resolves — same "instant feedback ahead of the
  async work" pattern as `DashboardShell`'s logout button) swaps the button to "Guardando…"
  and disables it a second way, distinct from the `!isFormValid` disabled state.

### Unified `RadioCard` selector

"Fenotipo metabólico," "Tasa de sudoración," and Gut Training's own level cards used to
each style their selected state differently — phenotype used a light `bg-[#FDF8F6]` tint
with a dark border, the other two a solid `bg-terracotta` fill — which read as three
inconsistent selector components rather than one. **`components/radio-card.tsx`**'s
`RadioCard({ name, value, checked, onChange, onBlur, title, children })` is the one shared
card every group now renders through: `title` + an optional `children` caption (a single
description line for phenotype/sweat-rate, or two stacked lines — g/h range then
description — for Gut Training), active state always `border-terracotta bg-terracotta
text-white`, inactive always `border-neutral-200 bg-white text-neutral-800
hover:border-terracotta/50`. The real `<input type="radio">` stays in the DOM for genuine
form semantics (`name`/`value`/`checked`/`onChange`, keyboard nav, screen readers) but is
visually hidden (`sr-only`, not `hidden` — it must stay focusable) in favor of a custom
circle indicator (a white ring with a terracotta inner dot when checked, `border-neutral-300`
empty when not) — the desired look isn't achievable through the native widget's
`accent-color` alone, since that can't invert the circle to white-on-terracotta or draw a
colored inner dot. `peer-focus-visible:ring-2 peer-focus-visible:ring-terracotta` on the
label (paired with `peer` on the now-hidden input) keeps the whole card visibly
focus-ringed for keyboard users, so hiding the native circle doesn't cost accessibility.
`GutTrainingSelector` (`components/gut-training-selector.tsx`) is now fully controlled
(`value`/`onChange`/`onGroupBlur`/`invalid` props, no more internal `useState`) specifically
so its parent form can read the current selection for `isFormValid` — it renders through
`RadioCard` too, contributing only the range+description two-line caption and the live
helper paragraph below the grid.

### Shared `Toast` component

`components/toast.tsx` extracts the fixed bottom-center white-pill toast presentation —
icon chip (`Check`/`TriangleAlert`, emerald/red soft tint background) + two-line title/
message — out of `components/sync-button.tsx`'s `SyncForm`, where it was first built, so
every toast in the app renders through one component instead of near-identical copies
drifting apart. `ProfileSavedToast` and `SyncForm` both now just supply their own `{ kind,
title, message }` and let `<Toast toast={...} />` handle presentation. Any *new* toast this
app adds should render through this component too, rather than a third hand-rolled one.

`/perfil` is split into 3 numbered `Card`s (`01 · Métricas físicas y equipamiento`,
`02 · Fenotipo metabólico y sudoración`, `03 · Adaptación digestiva (gut training)`) all
inside one `<form>` (now `PhysiologicalProfileForm`, see "Unified client-side form
validation" above), with a single full-width `Guardar cambios` button at the bottom — the
page used to be one giant card with its own `CardTitle` ("Perfil fisiológico") sitting
directly under the page's own `<h1>` of the same text, a literal visible duplicate. Gut
Training's own "Escala de Adaptación Digestiva" reference table that used to sit at the
very bottom of the page below the form was absorbed into the selector cards themselves —
every level's own g/h range is already shown on its own `RadioCard` now, so a second static
list repeating the same 4 ranges was pure duplication.

**Micro-explicaciones on the selector cards.** The g/h range alone ("60-75 g/h") doesn't
tell an athlete which level actually describes their own real-world fueling habits, so
every Gut Training card and the "Tasa de sudoración" cards carry a third, plain-language
line under the range — `gutTrainingLevelDescriptions`/`sweatRateDescriptions`
(`lib/metabolic-engine.ts`) — e.g. "Habituado a ingerir carbohidratos en salidas >2h sin
molestias" for Intermedio, rendered as `RadioCard`'s `children` caption (see "Unified
`RadioCard` selector" above for the shared active/inactive treatment all three selector
groups now use). Each section header also carries a small `(i)` **`InfoTooltip`**
(`components/info-tooltip.tsx` — a generalized version of `FuelingContextTooltips`'s
existing pure `group-hover`/`group-focus-within` CSS technique, taking a static `note` prop
instead of computing one, since these two explainers are fixed copy, not a derived value)
with a short physiological explainer for a curious athlete who wants more than the one-line
subtext — "Tasa de sudoración" gets one about sweat/sodium variability, "03 · Adaptación
digestiva" gets one about the gut being trainable like the legs.

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
`DashboardShell`'s own `<main>`) — contained to the content area, never the whole viewport
(`min-h-screen`/`fixed inset-0`, what the *root* `app/loading.tsx` still correctly uses for
the shell-less `/login`/`/auth/callback`/`/privacidad` segment — see "Login & loading
screens" above). It originally reused the same breathing-`RatioLogo` treatment as the root
fallback, just contained to the content area (`flex min-h-[50vh] ... py-12`) — replaced
with a generic `<Skeleton>`-based shape instead (a header bar, a selector bar, a 3-up
metric grid, a content block, via `components/ui/skeleton.tsx`, no extra padding of its
own since `DashboardShell`'s `<main>` already supplies the page's outer padding and every
real page's content sits flush inside that): since these four routes are all
`force-dynamic`, this fallback genuinely fires on *every* cross-page navigation between
them, not just on a cold app boot the way the root fallback does — a big breathing brand
mark firing repeatedly on every click between Dashboard/Estadísticas/Historial/Perfil read
as "a different loading card" rather than "the same UI, filling in," which is exactly the
granular-skeleton convention the rest of this app's own data-dependent loading states
already follow (see "Granular loading states" below). Each of the four page components had
their own `<DashboardShell
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
`/`, `Perfil fisiológico` → `/perfil`, `Estadísticas` → `/estadisticas`, `Historial` →
`/historial` — that order, not alphabetical or route-creation order, since Dashboard/Perfil
are this app's two finished, daily-use surfaces and Estadísticas/Historial are mid-rebuild)
as real `next/link` `Link`s, using `usePathname()` to give the active item a filled pill
(`bg-surface text-terracotta`) and the rest a subtle hover fill — a client component
already (it owns the mobile drawer's `mobileOpen` state), so this needed no new
`"use client"` boundary. Each `Link` takes an `onNavigate` callback that closes the mobile
drawer (`setMobileOpen(false)`) on click, since without it a mobile visitor tapping a nav
item would navigate underneath a still-open overlay.

**Locked nav entries.** Every `NAV_ITEMS` entry can be locked for one of two independent
reasons, both rendering through the same disabled-entry markup but distinguished by
`title`/badge (see "Mandatory profile completion" above for the second reason's actual
enforcement, which lives in `proxy.ts`'s Edge Middleware, not here):

- **`permanentlyDisabled`** — Estadísticas and Historial are both mid-rebuild, reachable by
  direct URL but the sidebar itself shouldn't invite a click into a section that's actively
  in flux. Each `NAV_ITEMS` entry carries its own `permanentlyDisabled` boolean rather than
  a second parallel list, so re-enabling one later is a single-line flip back to `false`,
  not restoring deleted markup. Shows the trailing "Próx." pill (`bg-neutral-200/60
  text-neutral-500`, `text-[9px] font-mono uppercase tracking-wider`, `whitespace-nowrap` so
  it can never wrap onto its own line) and a `title` of "Sección en desarrollo —
  Próximamente" (the full word still appears in the tooltip — only the on-screen pill itself
  was shortened, once the mobile drawer's narrower width made "Próximamente" read as
  cramped against a label like "Estadísticas").
- **`lockedByIncompleteProfile`** (computed per-render, not a static field) — every entry
  but `/perfil` itself, while the Sidebar's `isProfileComplete` prop (passed down from
  `app/(app)/layout.tsx`) is `false`. No "Próximamente" pill here — a profile lock isn't
  "coming soon" — just the `title` "Completa tu perfil fisiológico para desbloquear esta
  sección." In practice only ever visible while sitting on `/perfil` itself with an
  incomplete profile, since the middleware makes every other route unreachable in that
  state regardless of what the Sidebar shows.

Either way, a locked entry renders as a plain `<div aria-disabled="true">` (not a `<Link>`,
not a `Link` with a blocked `onClick`) — there's no `href` to accidentally trigger
prefetching or a stray navigation on middle-click/keyboard-Enter the way suppressing a real
anchor's default behavior would still risk. Visually it's `opacity-50 cursor-not-allowed
select-none` for both reasons.

**Every entry renders its own `<item.icon>`, locked or not.** This went through two
revisions: the original design always rendered it; a later pass replaced it with a blank
`size-4 shrink-0` spacer on every locked entry specifically because Historial's icon had
been rendering visibly while Estadísticas' own icon read as inconsistently faint at a
glance — an unintended visual asymmetry between two entries meant to read as equally
"disabled." Removing icons from *all* locked entries fixed that asymmetry, but it also
broke the sidebar's own left-edge symmetry the other direction — every row's icon column is
what keeps every label starting at the same x-position, and without it, locked labels lined
up with the icon+gap spacer stayed vertically flush by design, but Estadísticas/Historial
losing their icons altogether now read as visually incomplete rather than "temporarily
locked." Icons are back on every entry, including locked ones — the wrapping div's own
`opacity-50` already dims the icon (and the "Próx." badge) right along with the label, so a
locked entry's icon reads as visibly muted without needing a separate opacity class of its
own, and the original Historial/Estadísticas inconsistency can't recur since both now render
through the exact same `<item.icon className="size-4 shrink-0" />` unconditionally. Verified
live: clicking a locked entry leaves the URL unchanged, and toggling the Sidebar's
`isProfileComplete` prop between `true`/`false` correctly locks/unlocks Dashboard
specifically while leaving Perfil always clickable and Estadísticas/Historial always locked
regardless — all four entries showing their icon in every state.

The same `SidebarContent` header
(`RatioLogo` + "RATIO") and the mobile top header's own logo+text are both
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
never escape upward past their own container while scrolling.

**Mobile drawer now opens from the right, not the left.** The hamburger button moved from
the mobile header's left edge (`absolute left-6`, first child before the centered brand
`Link`) to its right edge (`absolute right-6`, now the last child) — a right-hand hamburger
opening a right-hand drawer is the more familiar mobile-nav convention than the left/left
pairing this used to be. The `<aside>` itself is the *same* element as the desktop's
permanent left sidebar (see "The `(app)` route group..." above), so only its mobile-specific
classes flipped: `right-0`/`border-l` at the base (was `left-0`/`border-r`), with the closed/
open transform swapping from `-translate-x-full`/`translate-x-0` to `translate-x-full`/
`translate-x-0` (off-screen to the *right* now, not the left) — each paired with an `lg:`
override (`lg:right-auto lg:left-0 lg:border-l-0 lg:border-r`, plus the pre-existing
`lg:translate-x-0`) putting the desktop sidebar right back on the left, unaffected. The
in-panel "X" close button (`SidebarContent`'s own header row) didn't need to move — it
already sat at the *panel's own* right edge, which now also happens to be the true viewport's
right edge once the panel itself moved there, still a clean, reachable corner either way.

**Drawer width: `w-[85vw] max-w-[320px]` on mobile, `lg:w-64` on desktop.** The original
fixed `w-64` (256px) at every breakpoint read as cramped on a narrow phone once labels
carried a trailing badge too (Estadísticas/Historial's own "Próx." pill, see "Locked nav
entries" above) — a relative `85vw` gives the drawer room proportional to the actual device
width (capped at `320px` so it doesn't balloon on a larger phone/small tablet), while the
desktop's permanent sidebar stays exactly the `w-64` it always was via the `lg:` override.

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

**Immediate logout feedback.** Clicking "Cerrar sesión" used to give zero visual feedback
for however long `logout()`'s own `supabase.auth.signOut()` + `redirect("/login")` took to
resolve server-side — up to ~2s with nothing on screen acknowledging the click at all.
`DashboardShell` now holds an `isLoggingOut` boolean, flipped by `SidebarContent`'s form via
`onSubmit={onLogoutStart}` — `onSubmit` fires synchronously the instant the button is
clicked, well before the Server Action itself has resolved, so the feedback is genuinely
immediate rather than waiting on any network round-trip. No separate client-side
`supabase.auth.signOut()` call was added for this: `logout()` already performs the real
sign-out and its own `redirect()` already *is* the clean redirect to `/login` — calling
`signOut()` a second time from the client would just race the same work the server action
is already doing. While `isLoggingOut` is true: the button swaps its `LogOut` icon for a
spinning ring (`size-3.5 border-2 border-current border-t-transparent animate-spin
rounded-full`), its label changes to "Cerrando sesión...", and it's `disabled` with
`cursor-wait`/`opacity-70` — and, one level up, `DashboardShell`'s own root div gains
`pointer-events-none opacity-80 transition-opacity duration-300`, dimming and freezing the
*entire* shell (sidebar, header, main content) so nothing else is clickable while cookies
are being cleared server-side. There's no matching `setIsLoggingOut(false)` anywhere — the
action's `redirect()` navigates away and unmounts this component entirely, so the dimmed
state is only ever visible for the brief window before that navigation completes. Verified
live via a temporary unauthenticated route rendering `DashboardShell` directly with the
Server Action's own request intercepted/stalled (same Playwright pattern used elsewhere in
this file) — confirmed the button text/disabled/cursor/spinner and the root's
opacity/pointer-events all flip correctly before the (stalled) redirect would otherwise
fire; route removed again before committing.

**Hard-navigation fallback for a reported logout crash.** A user report described clicking
"Cerrar sesión" occasionally surfacing Next.js's own generic client-router crash screen
("This page couldn't load. Reload to try again, or go back.") instead of landing on
`/login`, diagnosed against a `router.push('/login')`-after-`signOut()` pattern. That
diagnosis doesn't match this codebase, though — there's no client-side `router.push`
anywhere in the logout path; `logout()` (`lib/auth-actions.ts`) is already a `"use server"`
Server Action calling `supabase.auth.signOut()` then `redirect("/login")`, the
architecturally-correct pattern (confirmed by re-reading the actual source before touching
anything, rather than assuming the report's own diagnosis was correct). The real
susceptibility is more subtle: a Server Action's `redirect()` is normally carried out as a
soft client-side RSC transition, and a documented class of Next.js App Router bugs can
surface that exact crash screen if a background request (e.g. a prefetched sidebar
`<Link>`) races the moment the session cookie actually clears. Since this couldn't be
reproduced live in this environment (no real Supabase session to click a live "Cerrar
sesión" against), the fix is a defensive fallback rather than a targeted one-line patch:
`DashboardShell` now holds a `logoutFallbackTimer` ref, and `handleLogoutStart()` (replacing
the previous inline `() => setIsLoggingOut(true)`) both flips `isLoggingOut` as before *and*
schedules a `window.location.href = "/login"` hard navigation 2.5s later. A normal,
successful logout always unmounts this component (via the real navigation completing) well
within that window, so the timer never fires in the common case — it only matters if the
soft transition has actually failed, forcing a clean hard reload to `/login` instead of
leaving the crash screen up. The timer is cleared on unmount via a `useEffect` cleanup so it
can never fire after the component's already gone for an unrelated reason. `logout()` and
`proxy.ts`'s own middleware redirect (already a clean `NextResponse.redirect(url)`, already
correct) were both left untouched — no client-side Supabase client was reintroduced, keeping
this app's deliberate "sign-out is entirely server-side" architecture (see "Real auth" above)
intact.

**No red/destructive hover on "Cerrar sesión."** An earlier version's resting `text-neutral-500`
hovered to `bg-red-50/80 text-red-600` — a common "destructive action" affordance elsewhere
on the web, but logging out isn't itself destructive (nothing is deleted or lost), and the
red broke this app's own PNS palette on the one interactive row in the sidebar that didn't
already follow it. Hover now shades toward the app's own accent instead: `hover:bg-terracotta/10
hover:text-neutral-900` — the same near-black text color this app already reaches for
elsewhere, at rest→hover, and a soft tint of `--terracotta` rather than a hardcoded hex.
The `LogOut` icon carries no color class of its own (just `text-current`), so it already
tracked whatever color the button's text was — swapping the button's own hover color was
the only change needed, nothing icon-specific.

**Icon-to-label gap, fixed.** The button's own container used `space-x-2` while every other
Sidebar row (the `Link`s in `NAV_ITEMS`, the locked-entry `<div>`s) used `gap-3` — a real
bug, not just an inconsistent value: `space-x-*` applies `margin-left` to non-first *element*
children, but this button's label is a bare string (`{isLoggingOut ? "..." : "Cerrar
sesión"}`), which renders as an anonymous text run, not an element `space-x-*`'s CSS selector
can target — so no visible gap ever actually applied between the icon and the label. `gap`
on a flex container, by contrast, applies to every flex item including anonymous text-run
boxes, which is exactly why the other rows (icon + bare-string label, same shape) already
had correct spacing. Switched to `gap-3` to match every other row exactly — verified live: a
12px gap on both this button and the "Perfil fisiológico" `Link`, measured identically.

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
    display above 1000g); **Gut training** — a `Nivel 1/2/3` badge (`30-45` / `50-75` /
    `80-90+` g/h) derived from real average logged intake — the exact same
    `gutTrainingTierFromIntake()` tier `/estadisticas`' own `SummaryCard` now shows too
    (see "Estadísticas" above), so the two screens can never disagree. Deliberately a
    *different* scale from `athlete_profiles.gut_training_level` (the 4-tier self-reported
    Principiante/Intermedio/Avanzado/Pro field, still shown on `/perfil` and still what
    caps the fueling planner's recommended intake — see "Gut Training Scale" above) — this
    one reflects demonstrated real intake across logged rides, not a category the athlete
    picked once.
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
  rather than a tab panel. `PhysiologicalProfileCard` reads `getAthleteProfile()` and hands
  it to `PhysiologicalProfileForm` (weight/FTP/sweat rate/gut training level/athlete
  type/bottle count/bottle capacity/salty-sweater checkbox, pre-filled with current values)
  POSTing to `/api/athlete-profile/update`. Sweat rate and the metabolic phenotype selector
  are both `RadioCard` groups now (`name="sweat_rate"`/`name="athlete_type"`, same real
  values as before — see "Unified `RadioCard` selector" above) — see "Unified client-side
  form validation" above for the `isFormValid`/inline-error treatment shared across all
  three required selector groups. The "Sudo mucha sal" checkbox (`is_salty_sweater`) feeds
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

The Dashboard's headline used to be a hardcoded "Buenas tardes, Alejandro" — always the
wrong time-of-day prefix outside actual afternoon hours, and always this one developer's
name regardless of who's actually signed in. `GreetingSection` (`app/(app)/page.tsx`)
replaces the *name* with the real signed-in athlete's first name, taken from
`getViewerIdentity()` (`lib/dashboard-data.ts` — the same Strava-backed identity source
`components/viewer-identity.tsx`'s sidebar card already uses; `cache()`-deduped, so calling
it a second time this request costs no extra Strava round-trip). It's its own `Suspense`
boundary (`GreetingSkeleton` fallback) so the greeting's Strava-dependent fetch never
blocks the rest of the Dashboard from rendering — the header has no other Suspense
boundary to pattern-match against anymore now that `StravaButton` was removed from it
entirely (see "PNS premium redesign" below).

The *prefix* went through two designs. The first replaced the hardcoded "Buenas tardes"
with a real `getGreetingPrefix(new Date().getHours())` (`05:00-11:59` "Buenos días",
`12:00-19:59` "Buenas tardes", `20:00-04:59` "Buenas noches") — genuinely dynamic, computed
and rendered entirely server-side with no client component involved (so no hydration
mismatch risk against a possibly different client-side `Date()`). A later "ultra-clean PNS"
pass replaced this with a flat, always-short **"Hola"** instead, removing `getGreetingPrefix`
entirely — the time-of-day variance meant the greeting's own *length* varied (a much longer
string at midday than at night), which was fighting this `<h1>`'s own `truncate` on a narrow
phone; a fixed-length "Hola, {firstName}" sidesteps that rather than trying to size the
layout around the longest possible prefix. Typography was tightened at the same time
(`greetingClass`, `text-2xl sm:text-3xl font-semibold tracking-tight text-[#181818]`, down
from an earlier `text-3xl sm:text-4xl`) for the same reason — smaller text has more room
before truncating. Both passes replaced the *original* uppercase eyebrow-plus-separate-
all-caps-"DASHBOARD"-title design with this one sentence-case `<h1>`; only the prefix
logic itself changed between them, not that broader restructure.

### PNS premium redesign (color tokens, typography, buttons, dark "Obsidian" widget)

A pass explicitly aimed at "Pas Normal Studios-grade editorial premium" rather than this
app's earlier flatter utility look. Scoped to the Dashboard (`app/(app)/page.tsx`,
`components/fueling-planner.tsx`, `components/post-ride-analysis.tsx`) and the shared
design-system files everything else inherits from (`app/globals.css`,
`lib/ui-classes.ts`) — `/perfil`'s own copy/layout was deliberately left untouched beyond
the one *mechanical* fix a shared token change forced on it (see the select bullet below).

- **Token refinement, not a new palette.** `--terracotta` (`#827b66` → `#6e6658`),
  `--terracotta-hover` (`#706a57` → `#5e574b`), `--background`/`--sidebar` (`#f8f7f4` →
  `#f9f8f6`), and every near-black text token (`--foreground`/`--card-foreground`/
  `--primary`/`--sidebar-*`, `#171717` → `#181818`) all had their *values* nudged — same
  "swap only the value, never the token/class name" convention this app's palette has
  followed through two earlier rebrands (see the `--terracotta` token's own comment in
  `app/globals.css`), so every existing `bg-terracotta`/`text-neutral-900` usage
  app-wide picked up the refined tone automatically with zero per-component edits.
  `components/route-map-preview.tsx`'s `ROUTE_LINE_COLOR` (a literal hex, since Leaflet's
  `Polyline` needs a plain string, not a class) was updated to match by hand — the one
  place a CSS variable change doesn't propagate on its own.
- **Sentence case, uppercase reserved for technical labels only.** The Dashboard's
  headline (see "Dynamic greeting" above) and both tab cards' `CardTitle`s
  ("Planificador de nutrición," "Análisis post-ruta") read as plain sentence-case prose
  now. Their old `CardDescription` subtext ("Estrategia de bolsillo y receta casera para
  tu próxima salida," "Deuda de glucógeno y objetivo de recuperación por macros," "Sin
  actividades registradas todavía") was removed outright rather than restyled — a card
  whose title already says what it does doesn't need a second line repeating it. The
  `eyebrow` constant (three independent file-local copies — `app/(app)/page.tsx`,
  `components/fueling-planner.tsx`, `components/post-ride-analysis.tsx`, matching this
  codebase's existing "small enough not worth sharing a module" convention) is the one
  place uppercase survives: `text-[10px] font-mono uppercase tracking-widest text-zinc-500`
  for genuine data labels (Ruta, Intensidad objetivo, Distancia, Frecuencia cardíaca, etc.)
  — technical readouts, not headlines.
- **Segmented controls rebuilt as independent bordered buttons, not a sliding pill on a
  shared track.** The mode toggle (Ruta Strava/Calculadora/Subir GPX), `DeparturePicker`
  (Hoy/Mañana/Elegir fecha — this one was already close to this shape), and the Estrategia
  nutricional selector (Óptimo/Mi Inventario/Híbrido) all shared one base class,
  `segmentedButtonClass` (`components/fueling-planner.tsx`) — previously `uppercase
  font-mono font-bold tracking-tight` with no border of its own (the mode toggle's inactive
  state sat transparent on a shared `bg-neutral-100` track), now `rounded-lg border
  text-xs font-medium` with **no shape classes added per call site** — each of the 3 call
  sites now only supplies its own two-state color ternary: active
  `border-terracotta bg-terracotta text-white` (originally paired with a `shadow-sm` too —
  dropped in the very next fine-tuning pass, see below), inactive `border-terracotta/30
  bg-white text-zinc-700 hover:border-terracotta`. Removing the CSS `uppercase` transform
  was enough on its own to reveal correct sentence-case labels — "Ruta Strava," "Mi
  Inventario," etc. were already properly cased in the JSX source, just visually forced
  upper-case by the old class. `FuelingPlannerSkeleton`'s own mirror of the mode-toggle
  shape (`app/(app)/page.tsx`) was updated to match (3 bordered placeholder cells instead
  of a `bg-neutral-100` track with 3 pill-shaped bars), keeping this codebase's "a loading
  fallback must mirror the real eventual shape" convention intact.
- **Every `<select>` now gets a custom chevron.** `lib/ui-classes.ts`'s
  `selectableFieldClass` gained `appearance-none` (stripping the browser's native dropdown
  arrow) plus `pr-9` (reserving the room a `<ChevronDown>` sits in) and switched its own
  shape to `rounded-xl border-zinc-300` with a `shadow-sm` and a `terracotta` focus ring
  (both later lightened further — see the fine-tuning pass below), matching `fieldClass`
  so an `<input>` and an adjacent `<select>` never look like two different design systems
  side by side. A new
  `selectableFieldDarkClass` is the same treatment inverted for the one dark surface in the
  app (see the Obsidian widget below), and `selectChevronClass` is the one shared
  `<ChevronDown>` positioning class both variants pair with. **This is a shared-token
  change, so it silently broke every `<select>`'s visible arrow app-wide** (a stripped
  native arrow with no replacement icon yet) until each of the 7 call sites was
  individually wrapped in its own `relative` container with the chevron added:
  `components/fueling-planner.tsx` (Ruta — dark variant, Intensidad objetivo ×2 [route and
  GPX mode], Hora de salida), `components/physiological-profile-form.tsx` (Soportes de
  bidón, Capacidad por bidón — the two selects on `/perfil`, fixed as a required
  consequence of the shared class change even though that page's own design was otherwise
  left alone), and `components/post-ride-analysis.tsx`'s "Cambiar salida" switcher, which
  already had its own bespoke `appearance-none`-plus-chevron treatment predating this pass
  and needed no change.
- **The Route map + "Ruta" selector became a dark "Obsidian widget"** — the one
  deliberately near-black surface in an otherwise all-light UI, `rounded-2xl border
  border-white/10 bg-[#181818] p-6 text-white shadow-xl`, wrapping what used to be a
  plain light `flex flex-col` (the "Ruta" label, its "Recargar" refresh button, the route
  `<select>`, and `RouteMapPreview`) inside route mode's grid. Internal text switched to
  `zinc-400`/white (labels `text-zinc-400`, hover states `hover:text-white`), the select
  uses `selectableFieldDarkClass`, and `RouteMapPreview` is passed `className="border-white/10"`
  (merged via its own existing `cn()`-based `className` prop) so its outer border blends
  with the card instead of keeping its light-context `border-neutral-200`. The refresh
  spinner overlay (shown mid-`refreshingRoutes`, sitting just left of where the chevron/
  arrow would be) was restyled from `border-neutral-300 border-t-neutral-800` to
  `border-white/20 border-t-white` and nudged from `right-8` to `right-9` to sit correctly
  next to the new chevron's position. Scoped deliberately to *only* the Route-mode
  selector+map — GPX mode's own map preview (no selector, just a dropzone) was left on its
  existing light treatment, matching the request's literal pairing of "the map and the
  route selector," not every map surface in the file.
- **Verified visually**, not just type-checked: a temporary unauthenticated route
  (`app/test-dashboard-preview`, added to `proxy.ts`'s `PUBLIC_PATH_PREFIXES` and reverted
  before committing — same disposable-preview-route pattern used throughout this app's own
  history) rendered `FuelingPlanner` directly with a mocked Strava route, screenshotted via
  Playwright at 1280px and 390px. Confirmed: the sentence-case headline, all three
  rectangular segmented controls (active bronze fill / inactive white-bordered), every
  select's chevron, and the dark Obsidian widget all render correctly with no layout
  regressions at either width.

**A follow-up "fine-tuning" pass** trimmed remaining visual noise the premium redesign above
still carried:

- **Greeting simplified to a fixed "Hola"** — see "Dynamic greeting" above for the full
  before/after; the time-of-day prefix (`getGreetingPrefix`) was removed entirely, since its
  varying length fought the headline's own `truncate` on narrow phones. Header container
  (`app/(app)/page.tsx`) gained an explicit `gap-4` (replacing a `mr-2` on the greeting's own
  wrapper, now redundant) between the greeting and the Strava button.
- **"Conectar Strava"/"Sincronizar" both shrink on mobile** — `px-3 py-1.5 text-xs`
  (`sm:px-4 sm:py-2` restores the original size at `sm:` and up), applied at each call site
  (`app/(app)/page.tsx`'s `StravaButton`, `components/sync-button.tsx`'s `SyncButton`)
  rather than changing `primaryButtonClass`/`secondaryButtonClass` themselves, since those
  shared tokens are also used by buttons elsewhere (Copiar receta, Descargar GPX, Calcular
  estrategia) that don't need to shrink. (`SyncButton`'s own styling was superseded again in
  the very next pass below — see "Sincronizar goes fully transparent.")
- **`DeparturePicker`'s outer box removed.** The "Fecha y hora de salida" segmented
  control + hour `<select>` used to sit inside their own `rounded-lg border
  border-neutral-200 px-3 py-3` container — removed outright, so the day-mode buttons and
  select now float directly on the canvas background, separated from the eyebrow label
  above only by the wrapper's own `gap-2`. `FuelingPlannerSkeleton`'s mirrored placeholder
  (`app/(app)/page.tsx`) updated to match — same shape, no border.
- **Dark Obsidian widget's padding made responsive** — `p-6` → `p-4 sm:p-6`, tighter on a
  narrow phone where a flat `p-6` ate into already-scarce width.
- **`fieldClass`/`selectableFieldClass` lightened** — `shadow-sm` dropped entirely, border
  color lightened from `border-zinc-300` to `border-zinc-200/80` (hover: `zinc-300`, down
  from `zinc-400`), vertical padding trimmed from `py-2.5` to `py-2`, text color from
  `text-neutral-900` to `text-zinc-800`, and the focus treatment simplified from
  `focus:border-terracotta focus:ring-1 focus:ring-terracotta` to just `focus:border-terracotta
  focus:outline-none` (no ring) — a deliberately quieter field, explicitly requested to read
  as less "commercial form." **Note:** dropping the focus ring in favor of a border-color-only
  focus state is a real (if minor) keyboard-accessibility tradeoff worth keeping in mind if
  focus visibility is ever reported as hard to see. Segmented buttons' active state also lost
  its `shadow-sm` for the same "no heavy shadows" reasoning (see above).

**A third pass** aligned the remaining pieces exactly to the PNS brief:

- **"Sincronizar" goes fully transparent.** `SyncButton` (`components/sync-button.tsx`) no
  longer renders through the shared `secondaryButtonClass` at all — that token still keeps
  its `uppercase font-mono tracking-wider` treatment for Copiar receta/Descargar GPX/
  Recargar rutas, but this one button (sitting directly in the Dashboard header) needed a
  quieter, sentence-case, no-fill look that diverges from `secondaryButtonClass` on almost
  every axis. A new local `syncButtonClass` const replaces it entirely: `bg-transparent
  border-terracotta/40`, `hover:border-terracotta hover:bg-white/50`, plain sentence-case
  text (no `uppercase`/`font-mono`/`tracking-wider`). The JSX label string itself
  ("Sincronizar"/"Sincronizando...") never changed — it was always correctly cased, just
  visually forced upper-case by the old shared class.
- **Inactive segmented buttons: `bg-white` → `bg-white/80`** across all 5 ternaries
  (mode toggle ×3, `DeparturePicker`, Estrategia nutricional) — a barely-perceptible but
  deliberate softening, matching the brief's literal "Fondo claro/transparente" spec for
  the inactive state.
- **Map zoom controls shrunk and decoupled.** `MapZoomControls`
  (`components/route-map-preview.tsx`) used to be two buttons sharing one bordered/
  shadowed pill (`overflow-hidden rounded-md border ... bg-white`, a `border-b` divider
  between them), sized `size-7`/`md:size-6`. Now each button is its own independent
  `size-6 rounded-md border-zinc-200/60 bg-white/90 shadow-sm` square, stacked with a
  small `gap-1` — flatter, more compact, no shared wrapper chrome. The distance/elevation
  badge (bottom-left corner) shrank from `px-3 py-1.5 text-xs` (plus a `border-neutral-200`
  and `backdrop-blur-sm` this pass dropped) to `px-2.5 py-1 text-[10px] sm:text-xs`.
- **Canvas background refined a third time** — `--background`/`--sidebar`
  (`app/globals.css`) went `#f8f7f4` → `#f9f8f6` → `#f8f7f5`, each nudge barely
  perceptible on its own; same "swap only the value" token convention as every other
  palette refinement in this file's history.
- **On the "verde musgo"/moss-green accent request**: the brief asked to "incorporar...
  de forma sutil" a moss-green tone into labels/active borders. This app already has
  exactly that tone wired in as `--sage` (`#526553`, marking carb-coverage
  "cubierto"/positive-progress state — see the Code style section above) — no new usage
  site was added for it in the Dashboard/login specifically, since the request was
  explicitly "sutil" and this app's palette already reserves `--sage` for a specific,
  meaningful state rather than decorative accenting; forcing a new decorative use elsewhere
  risked contradicting both the "sutil" ask and the existing restrained, purposeful palette.
  Flagged transparently rather than silently invented.
- Verified live via Playwright with a real decoded polyline (not the earlier mock's `null`)
  so the map itself actually rendered — confirmed the zoom control squares, the shrunk
  badge, and the transparent "Sincronizar" button all match the brief visually at 1280px.

**A fourth pass** moved "Sincronizar" out of the header entirely and added breathing room
around the Fueling Planner's own title/label groups:

- **"Sincronizar" relocated to the Sidebar's identity card.** The Dashboard header
  (`app/(app)/page.tsx`) used to render `StravaButton`/`StravaButtonSkeleton` next to the
  greeting (either "Conectar Strava" or, once connected, `SyncForm`) — both removed
  outright, along with the now-unused `getProfile`/`Link2`/`SyncForm` imports. The header
  is now just the greeting, full width, so it never has to compete for space with a button
  on a narrow phone. `SyncForm` moved into `components/viewer-identity.tsx` instead,
  rendered directly under the avatar/name/"Conectado con Strava" row whenever
  `identity.isStravaConnected` is true — a routine, secondary action belongs next to the
  identity it acts on, not competing with the page's own headline. The "Conectar Strava"
  (not-yet-connected) branch was **not** preserved anywhere, deliberately: Strava OAuth is
  this app's *only* login mechanism (see "Real auth: Strava-exclusive login" above), so
  `profiles.strava_athlete_id` is set for literally every authenticated user by the time
  they can reach the Dashboard at all — that branch was already dead code in practice, just
  defensively present.
- **`syncButtonClass` (`components/sync-button.tsx`) restyled for its new home** — the
  header version was `border-terracotta/40`/`text-zinc-700`/`text-xs sm:text-sm`; the
  Sidebar needs something quieter still, since it now sits in a narrow column next to small
  identity text rather than a page-level header: `rounded-md border-zinc-200/80
  text-zinc-500`, `hover:bg-white hover:text-zinc-900`, `gap-1`/`px-2 py-1` — smaller and
  greyscale rather than bronze-tinted, reading as a utility action rather than a CTA.
- **`FuelingPlanner`'s title-to-content gap, fixed at its actual root cause.** `Card`'s
  own `gap-(--card-spacing)` (`components/ui/card.tsx`) governs the space between
  `CardHeader` and `CardContent` — and `flatMobileCardClass` (`lib/ui-classes.ts`) zeroes
  `--card-spacing` on mobile as part of flattening the card's *outer* edges flush against
  the page. The side effect: that same variable also zeroed the gap between "Planificador
  de nutrición" and the mode-toggle buttons directly below it, so the title sat visually
  flush against the buttons on a phone. Fixed with a targeted `<CardTitle className="mb-3.5
  sm:mb-0">` — margin only on mobile, since `sm:` and up already had a real 24px gap via
  `--card-spacing` and didn't need supplementing. Deliberately scoped to this one
  `CardTitle` rather than changing `--card-spacing`/`flatMobileCardClass` itself, which
  would also restore the (intentionally removed) outer edge padding this flattening exists
  to avoid.
- **More air between major rows.** `CardContent`'s own `gap-5` → `gap-6` (spacing between
  the mode toggle, the route/quick/GPX fields, Estrategia nutricional, the pocket-food
  accordion, and the CTA), and the route-mode grid (`grid-cols-1 sm:grid-cols-2` holding the
  Obsidian widget, Intensidad objetivo, and Fecha y hora de salida) went from `gap-4` to
  `gap-6`. Every plain "eyebrow label directly above its own field" wrapper (`Intensidad
  objetivo`, `Duración`/`Vatios objetivo` in quick mode, both fields in GPX mode, `Estrategia
  nutricional`) went from `gap-1.5` to `gap-2` — a small but deliberate bump, done via a
  literal-string find/replace scoped to the *exact* `"flex flex-col gap-1.5"` class (every
  other `gap-1.5` usage in this file carries additional classes alongside it — a longer
  content block, a bordered accordion row — and was left untouched, since those aren't the
  "label sitting on top of a field" pattern this pass targeted).
- Points 4 (button radius/active-inactive treatment), 5 (map zoom controls/badge scale),
  and 6 (canvas background, bronze accent) of this brief were **already satisfied** by the
  prior two passes — verified against the current code rather than re-applied, so nothing
  in this pass touched them again.
- Verified live via Playwright (desktop + a mocked Sidebar identity column, plus a separate
  375px mobile pass): the header renders as a single full-width greeting with no button,
  "Sincronizar" appears correctly under the mocked identity block, and the title-to-buttons
  gap is now clearly visible on both a narrow phone and desktop.

**A fifth pass** removed two more divider lines and the root `Card`'s outer border, in
favor of whitespace/background alone as the separators:

- **Dashboard header's `border-b` removed.** `app/(app)/page.tsx`'s `<header>` used to
  carry `border-b border-neutral-200/80 pb-4` under the greeting, right before the
  Pre-ruta/Post-ruta tabs. Removed outright — the outer page wrapper's own `gap-4 sm:gap-6`
  (already there, already separating every top-level block on this page) is now the only
  thing between the greeting and the tabs, same "let whitespace do the work" treatment
  already applied elsewhere on this page.
- **`/perfil`'s header `border-b` removed** the same way — `app/(app)/perfil/page.tsx`'s
  `<header className="border-b border-neutral-200 pb-6">` (wrapping "Perfil fisiológico" +
  its subtitle) lost the border/padding, relying on the page wrapper's own `gap-6` before
  "01 · Métricas físicas y equipamiento" instead.
- **`flatMobileCardClass` (`lib/ui-classes.ts`) drops its `sm:border sm:border-neutral-200`
  entirely** — the shared class flattening the Fueling Planner's/Post-Ride Analysis's root
  `Card` on mobile now stays borderless at every breakpoint, not just `< sm:`. `sm:bg-card
  sm:shadow-sm sm:rounded-xl` are unchanged, so the card still visually lifts off the
  porcelain `bg-background` canvas via a soft fill + faint shadow — background contrast
  alone is now the differentiator, not an outline. Scoped deliberately to just this one
  shared root-card token: the internal accordions/result panels inside the planner (Comida
  en bolsillo, the DIY-recipe/reload-strategy/carb-loading `<details>` blocks, the Objetivo/
  En bolsillo/Restante summary panel) keep their own existing borders — those are distinct
  functional sub-widgets with their own visual definition, not the "outer section container"
  this request was about, and removing their borders wasn't asked for.
- Verified live via Playwright (a mocked Dashboard header + card, plus a mocked `/perfil`
  header) — both headers now flow straight into their content with no rule line, and the
  Fueling Planner's card reads as a clean white fill with a soft shadow against the
  porcelain background, no border anywhere.

**A sixth pass** was mostly a verification pass against an already-mature design (card
borders, header dividers, `Sincronizar` placement, button radius/color, and the canvas/
bronze palette were all re-confirmed already correct against a fresh, detailed brief rather
than re-applied) — the one substantive addition was the map's "Dark Vector HUD" redesign
(see the main `RouteMapPreview`/"Zoom controls" documentation above for the CSS-filter
technique, the gold route line, and the glass badge/zoom-control styling). The inactive
segmented-button state also gained a `hover:bg-white` alongside its existing
`hover:border-terracotta` (all 5 call sites), so hovering lightens the fill slightly in
addition to the border-color shift, matching a more literal reading of "imitando los
botones de cabecera de PNS."

**A seventh pass** replaced the monochrome dark basemap with a genuinely colorful "Strava
Dark Mode Topo" — a request the two prior map passes' CartoDB-based approach fundamentally
couldn't satisfy (both `light_all`-inverted and `dark_all` are monochrome by design, with no
color information left for a filter to recover). Switched tile providers a second time, to
OpenTopoMap, and replaced the route color with Strava's literal brand orange (`#FC5200`) —
see "Dark Vector HUD" in the main `RouteMapPreview` documentation above for the full
three-iteration history, the `invert(100%) hue-rotate(180deg)` technique that makes a
light-designed topo tile work as a legible dark map, and the live verification against real
coastal/mountain and urban terrain.

**An eighth pass reversed the entire dark-map direction** — a request to drop the
"Dark Vector HUD"/"Strava Dark Mode Topo" look outright in favor of a simple, low-contrast,
Apple Maps/Mapbox-Light-style aesthetic. Rather than a fifth filter recipe, the tile
provider switched a third time to **CartoDB Positron** with **zero CSS filter** — the
straightforward move once the destination itself is a light map, since a natively-light
tile needs no dark-moding trick at all. The route line kept its Strava orange (`#FC5200`,
now unmistakably high-contrast against Positron's pale terrain instead of the dark topo)
and gained a soft drop-shadow effect via a second, wider, near-black `Polyline` stacked
underneath at low opacity. The "Obsidian" dark widget wrapping the route selector + map in
`components/fueling-planner.tsx` was restyled to a light `bg-surface` container to match
(a light map floating inside a black frame would have read as broken), and its dark
`<select>` variant (`selectableFieldDarkClass`) was deleted outright as genuinely dead
code rather than left unused. The map's zoom controls and distance/elevation badge both
reverted from dark-glass (`bg-[#181818]/80`) to light-glass (`bg-white/80`) chips to match.
See "Route map preview" above for the full four-iteration tile history and the current
implementation in detail.

**In the same pass**, the mobile sticky header's floating shadow (see "iOS status-bar
fusion..." below) was intensified from a barely-perceptible
`shadow-[0_2px_12px_rgba(0,0,0,0.03)]` to a more pronounced, wider-spread
`shadow-[0_4px_20px_rgba(0,0,0,0.06)]` — the header reads as clearly lifted above scrolled
content now, matching Pas Normal Studios' own floating-header depth, still with zero
`border-b` anywhere.

**A ninth pass — "zero-border pass" — stripped the 1px hairline border from every
card/button/selector app-wide,** the last remaining piece of this app's old bordered-UI
look after shadows had already gone flat and card corners had already gone borderless.
Where a border used to be the *sole* thing giving a control visual definition, it was
replaced with a real background-color fill instead — never left with nothing at all:

- **`lib/ui-classes.ts`** — `primaryButtonClass` dropped its `border border-terracotta`
  (redundant against the already-solid `bg-terracotta` fill); `secondaryButtonClass`
  dropped `border border-terracotta/30`, relying on its existing `bg-surface` tint alone
  (already tonally distinct from both pure white and porcelain, so it never needed the
  outline for definition in the first place).
- **`components/fueling-planner.tsx`'s `segmentedButtonClass`** (Ruta Strava/Calculadora/
  Subir GPX, Hoy/Mañana/Elegir fecha, Óptimo/Mi Inventario/Híbrido — all 5 ternary call
  sites) — the base class's plain `border` was removed; the active/inactive ternary
  changed from `border-terracotta bg-terracotta text-white` / `border-terracotta/30
  bg-white/80 text-zinc-700 hover:border-terracotta hover:bg-white` to a purely
  background-driven pair: `bg-terracotta text-white` (active, unchanged fill) /
  `bg-zinc-100 text-zinc-700 hover:bg-zinc-200` (inactive) — `zinc-100` reads clearly
  against both a white card and the porcelain canvas, which a translucent `bg-white/80`
  couldn't guarantee once its bordered outline was gone.
- **The pocket-food quantity stepper** (`components/fueling-planner.tsx`) — its
  `border-zinc-200/80` wrapper (added just one pass earlier specifically to match the
  app's *then*-current bordered-button geometry) was removed in turn, switching to the
  same `bg-zinc-100` fill as the segmented controls for consistency.
- **`components/radio-card.tsx`** (the Fenotipo metabólico/Tasa de sudoración/Gut Training
  selector cards on `/perfil`) — inactive state's `border-neutral-200 bg-white
  hover:border-terracotta/50` became `bg-zinc-100 hover:bg-zinc-200`, matching the same
  pattern; active state's `border-terracotta bg-terracotta` simplified to just
  `bg-terracotta` (again, a border matching its own fill color was doing nothing
  visually). The small circular radio-indicator ring inside each card was left untouched —
  a standard radio-button affordance, not a card/button perimeter frame.
- **`components/sync-button.tsx`** — `syncButtonClass`'s resting `bg-transparent border
  border-zinc-200/80` became a solid `bg-zinc-100` (no border), keeping its existing
  `hover:bg-white` unchanged.
- **`components/weather-impact-card.tsx`** — its `border border-neutral-200 bg-surface`
  stat block dropped the border, relying on `bg-surface` alone (`rounded-lg` added for a
  touch of definition now that there's no hard edge).
- **Disabled-button variants** across `components/fueling-planner.tsx`,
  `components/post-ride-analysis.tsx`, and `components/physiological-profile-form.tsx`
  (the greyed-out "Calcular estrategia"/"Guardar consumo"/"Guardar cambios" states) all
  dropped their `border border-neutral-200`, keeping their existing `bg-neutral-200`/
  `bg-neutral-300/30` fill as the sole disabled-state cue.
- **Post-Ride Analysis's RPE picker** (Suave/Moderado/Duro) and **consumption preset
  pills** (+1 Gel/+1 Bidón/+1 Barrita) — both used to rely *entirely* on a
  `border-neutral-300` outline with no background fill at all; both gained a `bg-zinc-100`
  resting fill (border removed) with `hover:bg-terracotta/10 hover:text-terracotta`,
  matching the sidebar logout button's own established hover treatment rather than the
  border-color-shift hover these used to have.
- **The three Consumo Real input-row wrappers** (Carbohidratos/Agua/Sodio, in
  `components/post-ride-analysis.tsx`) and **the Net Carb Deficit 3-column stat row plus
  the DIY-recipe/reload-strategy/carb-loading `<details>` accordions** (`components/
  fueling-planner.tsx`) — all previously `border border-neutral-200` boxes sitting
  directly on the root Card's own white/transparent background — converted to borderless
  `bg-[#F8F7F5]` porcelain sub-blocks instead, the same "nested block reads as distinct
  through color, not an outline" treatment already established for Balance Neto/Fase 1/
  Fase 2 in the prior card-system pass. These four were not explicitly named in the
  request but share the exact same `border border-neutral-200` shape as the ones that
  were, immediately adjacent in the same result panel — leaving them bordered would have
  read as a half-migrated inconsistency, not a deliberate choice.
- **Loading-skeleton mirrors** (`app/(app)/page.tsx`'s `DashboardSectionSkeleton`/
  `FuelingPlannerSkeleton`, `app/(app)/perfil/page.tsx`'s phenotype/sweat-rate/gut-training
  placeholder grids) also dropped their `border-terracotta/20`/`border-neutral-200` — a
  loading fallback must mirror the real eventual shape (this app's own established
  convention), and the real shape it mirrors is now borderless too.
- **Deliberately left untouched**: `fieldClass`/`selectableFieldClass` (real `<input>`/
  `<select>` fields — out of scope; the request's own examples were specifically about
  buttons/segmented controls/selectors-as-buttons, not raw form fields, and a borderless
  white input on a white card would have zero visible boundary at all), floating
  overlays that were already explicitly out of scope for the prior shadow sweep for the
  same reason (`components/toast.tsx`, `components/fueling-context-tooltip.tsx`/
  `components/info-tooltip.tsx`, and — except for the map-specific bullet documented under
  "Route map preview" above — nothing else in `route-map-preview.tsx`), the sidebar's own
  structural dividers and mobile-drawer edge border (`components/dashboard-shell.tsx` —
  layout chrome, not a card/button), the `TabsList` "line" variant's own `border-b` (the
  underline *is* the tab bar's visual language, not a boxy card border), and dashed
  borders (the GPX dropzone, `RouteMapPreview`'s own "no route selected" placeholder) —
  a dashed line is a distinct, universal "drop target" affordance, not the kind of solid
  1px card/button perimeter this pass targeted. `/estadisticas` and `/historial` were also
  left alone entirely — both routes are documented elsewhere as mid-rebuild and outside
  the explicitly named scope (Dashboard/Perfil/Login/Post-Ruta) for this particular pass.
- Verified via `npm run build` (clean) and a live Playwright check confirming every
  touched button/selector/card renders correctly with zero visible border and a real
  background-color differentiation against whatever surface surrounds it, at both mobile
  and desktop widths.

**A tenth pass partially reversed the ninth pass above** — a follow-up request
specifically for every *segmented/toggle selector group* (not the whole zero-border
system) to read as a clearly bordered, shadow-free control again, rather than
differentiating purely by background fill. Scoped narrowly to genuine multi-option
toggle groups where one option is persistently "selected" — not a reversal of the
broader zero-border pass on plain action buttons, disabled states, or porcelain
sub-blocks, all of which stayed exactly as the ninth pass left them:

- **`segmentedButtonClass`** (`components/fueling-planner.tsx` — Ruta Strava/Calculadora/
  Subir GPX, Hoy/Mañana/Elegir fecha, Óptimo/Mi Inventario/Híbrido, all 5 ternary call
  sites) — a plain `border` (color supplied per ternary) and an explicit `shadow-none`
  went back onto the base class. Active: `border-transparent bg-terracotta text-white`
  (border present but invisible, keeping the box model identical to the inactive
  state — no 1px size jump switching between them). Inactive:
  `border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400` — a real, visible
  hairline border on a pure white fill, replacing the ninth pass's borderless
  `bg-zinc-100 hover:bg-zinc-200`.
- **`components/radio-card.tsx`** (Fenotipo metabólico/Tasa de sudoración/Gut Training on
  `/perfil` — also a "grupo de botones selectores," per this request's own catch-all)
  — the exact same treatment: active `border-transparent bg-terracotta text-white`,
  inactive `border-zinc-300/70 bg-white text-neutral-800 hover:border-zinc-400`,
  replacing the ninth pass's `bg-zinc-100 hover:bg-zinc-200`.
- **Post-Ride Analysis's RPE picker** (Suave/Moderado/Duro — a genuine "select one of
  three" group in "Análisis Post-Ruta," explicitly in scope) — has no persistent active
  state of its own (each tap immediately submits and re-triggers analysis, so there's
  nothing to mark "currently selected"), so only the inactive/secondary treatment
  applies: `border border-zinc-300/70 bg-white text-zinc-700 shadow-none
  hover:border-terracotta hover:text-terracotta`, replacing the ninth pass's borderless
  `bg-zinc-100 hover:bg-terracotta/10`.
- **Deliberately left untouched**: the pocket-food quantity stepper (a single compound
  −/+ control, not a multi-option toggle group), the consumption preset pills (+1 Gel/+1
  Bidón/+1 Barrita — one-shot "add" actions a rider can tap several of, not a
  mutually-exclusive selection), every disabled-button variant, and every porcelain
  sub-block (Balance Neto, Fase 1/2, the Net Carb Deficit row, the accordions) — none of
  these are "botones selectores/toggle secundarios" in the sense this request means, so
  the ninth pass's borderless treatment stands for all of them.
- Verified via `npm run build` (clean) and a live Playwright check confirming every
  segmented control now shows a clearly visible 1px border in its inactive state and the
  solid bronze fill in its active state, at both mobile and desktop widths.

**An eleventh pass reversed the map's route-line color back from Strava orange to this
app's own bronze/taupe accent** — a request that the neon `#FC5200` (introduced several
passes earlier specifically because that request asked for "the Strava look" by name) be
replaced with `--terracotta`'s own `#6E6658` for a cleaner, more editorial match to RATIO's
palette. `route-map-preview.tsx`'s `ROUTE_LINE_COLOR` constant is the only line that
changed — `weight: 3.5`, `opacity: 1`, and `lineCap`/`lineJoin: "round"` were already
exactly within the range this same request asked to confirm (3.5–4px, 0.95–1.0 opacity),
so nothing else needed touching. Since `RouteMapPreview` is the one shared component
behind both the Pre-Ruta map (Fueling Planner) and the Post-Ruta map (Post-Ride Analysis),
this single-constant change applied to both automatically — no separate edit needed per
call site. See "Route map preview" above for the full color history in one place.

**A twelfth pass — "Jerarquía de Espaciado Editorial y Estructura Frameless" — introduced
a deliberate gradual spacing scale (macro relationships stay generous, micro relationships
inside a card get tighter) and reversed a couple of earlier radius decisions.** This
followed directly on from a user-reported concern that the Post-Ruta numbered cards
(see "'Reestructuración UX por Tarjetas Numeradas'" under "Post-Ride Analysis" above)
weren't visually separating from each other — investigated first, since a real bug there
would need fixing before any further styling pass made sense:

- **The reported fusion bug didn't reproduce.** A live check of the actual `/` route
  (via a temporary preview rendering the real `DashboardShell` + `PostRideAnalysis`/
  `FuelingPlanner`, not just the components in isolation) confirmed `DashboardShell`'s
  root/`<main>` are genuinely porcelain (`bg-background`, no `bg-white` ancestor anywhere
  between the page canvas and each numbered card), and the 3 Post-Ruta cards already
  rendered as clearly independent white boxes with real porcelain gaps between them, at
  both mobile and desktop widths — the "'Reestructuración UX por Tarjetas Numeradas'" pass
  had already fixed this correctly. Nothing needed reverting; this pass proceeded straight
  to the newly-requested spacing/radius work instead.
- **Macro spacing (`app/(app)/page.tsx`)** — the outer page wrapper's greeting→tabs gap
  went from a mobile-tightened `gap-4 sm:gap-6` back to a flat, generous `gap-6` at every
  width (a deliberate reversal of an earlier pass's mobile-fit tightening, superseded here
  by an explicit "margen generoso" request for this exact relationship); the tabs→card-
  title gap tightened the other direction, from `pt-4 sm:pt-6` to a flat `pt-4` — the tab
  bar and the card title below it now read as one continuous unit rather than two
  separately-spaced blocks.
- **Micro spacing inside numbered cards** — the gap between each "01 ·"/"02 ·"/"03 ·"
  eyebrow and the first control beneath it tightened from `mt-4`/`mb-3` to `mt-2`/`mb-2`
  across all 3 Fueling Planner steps (`components/fueling-planner.tsx`) and both Post-Ride
  Analysis numbered cards (`components/post-ride-analysis.tsx`) — a title sitting close to
  its own first field reads as "these belong together," which a full `mt-4` gap was
  undercutting. Independently, every literal `gap-5` between sibling controls inside Paso
  02 (Intensidad Objetivo next to Fecha y Hora de Salida, in all three of its mode
  variants — route/quick/GPX) tightened to `gap-3`, the same "related controls sit closer"
  logic applied to side-by-side fields rather than a title-to-field relationship. The
  `gap-6` separating the 3 numbered cards themselves from each other was deliberately left
  untouched — that's a macro relationship (independent step cards), not micro spacing
  within one.
- **Border radius, reversed on two specific controls.** `fieldClass`/`selectableFieldClass`
  (`lib/ui-classes.ts`) and `segmentedButtonClass` (`components/fueling-planner.tsx`) all
  went `rounded-md` → `rounded-lg`, and the RPE picker (`components/post-ride-analysis.tsx`)
  went `rounded-sm` → `rounded-lg` — reversing the "Border-radius sobered app-wide" pass's
  own step-down for every genuine *selector* control (fields, selects, segmented toggles,
  the RPE picker), per this pass's explicit "rounded-lg para todos los selectores"
  instruction. `RadioCard` was already `rounded-lg` and needed no change.
  **The pocket-food quantity stepper reverses the other direction** — back to `rounded-full`
  (a capsule), from the `rounded-md` the stepper's own fourth redesign iteration had settled
  on (see "Hybrid nutrition" above for that control's full 4-iteration history) — explicitly
  kept as the *one* exception to "every selector is `rounded-lg`" now, so it reads as its
  own distinct control type (a quantity stepper, not a mutually-exclusive selector) rather
  than blending into the same geometry as everything else. `primaryButtonClass`/
  `secondaryButtonClass` were deliberately left at `rounded-md` — action buttons ("Calcular
  estrategia," "Guardar consumo real"), not selectors, so this pass's "para todos los
  selectores" scope doesn't reach them.
- **Sidebar "Sincronizar" placement** — verified already correct, no code change needed:
  `SyncForm` renders only inside `components/viewer-identity.tsx`'s sidebar identity card
  (`identity.isStravaConnected && <SyncForm />`) and, separately, as the empty-state CTA
  inside `PostRideAnalysis` itself — never in the Dashboard header, which has carried only
  the plain greeting since the "PNS premium redesign"'s own fourth pass moved it out.
- Verified via `npm run build` (clean) and the same temporary-`DashboardShell`-preview
  Playwright check used to investigate the reported fusion bug above — confirmed the
  tightened macro/micro gaps, the `rounded-lg` selectors, and the `rounded-full` stepper
  all render correctly at both 390px mobile and 1280px desktop, on both the Pre-Ruta and
  Post-Ruta tabs.

**A thirteenth pass reversed the stepper's radius yet again and stepped every corner in
the app down to one small, technical `rounded-sm`** — a "Radio de Bordes Pequeño Global"
request explicitly asking for an "industrial" curvature everywhere: buttons, cards, form
fields, selects, tabs, and the pocket-food stepper, with `rounded-lg`/`rounded-xl`/
`rounded-2xl`/`rounded-full` all disallowed on any of those six categories. Scope was
interpreted literally — anything that isn't a button/card/field/select/tab/stepper (a
radio-indicator dot, a spinner ring, an avatar circle, a progress-bar track, a floating
glass chip/badge) was left alone, since none of those were named:

- **Shared tokens (`lib/ui-classes.ts`)** — `primaryButtonClass`/`secondaryButtonClass`/
  `fieldClass`/`selectableFieldClass`/`flatMobileCardClass` all `rounded-lg`/`rounded-xl` →
  `rounded-sm`. `badgeClass` deliberately untouched — a small data pill, not one of the six
  named categories (same reasoning that already exempted it from the border-removal
  passes' scope).
- **Shadcn primitives actually rendered in this app** — the base `Card` (and its
  `CardHeader`/`CardFooter`/image-slot corner classes) and `Tabs`/`TabsTrigger` both
  stepped down to `rounded-sm`. `components/ui/button.tsx`/`dialog.tsx`/`avatar.tsx`/
  `badge.tsx`/`progress.tsx` were left alone — a grep confirmed none of them are actually
  imported by any page/component in this app (dead shadcn scaffolding), so touching them
  would be effort spent on code with zero live call sites.
- **The pocket-food quantity stepper** (`components/fueling-planner.tsx`) — reversed
  *again*, from the "twelfth pass"'s `rounded-full` capsule (itself a deliberate exception
  carved out specifically so the stepper would read as a categorically different control
  from every other selector) back to the same flat `rounded-sm` every other selector now
  shares. This is the stepper's fourth radius in its history (see "Hybrid nutrition" above
  for the full account) — the "distinct control type" reasoning that justified the capsule
  no longer applies once this pass's explicit ask is "the stepper shares the exact same
  geometry as every other button."
- **Every segmented/toggle control, form field, and porcelain sub-block** — the mode
  toggle/`DeparturePicker`/Estrategia nutricional segmented buttons, `RadioCard` (Fenotipo/
  Sudoración/Gut Training), `GutTrainingSelector`'s wrapping grid, the RPE picker, every
  Consumo Real input row, the objetivo/cubierto/restante banner, the Hero "Dosis casera"
  card, the Net Carb Deficit stat row, every `<details>` accordion, the custom-carbs input,
  and the disabled-button variants across `fueling-planner.tsx`/`post-ride-analysis.tsx`/
  `physiological-profile-form.tsx` all stepped down to `rounded-sm`.
- **The W/kg pill and every floating map badge/zoom control were left at their existing
  radius** — small data pills/glass chips, not one of the six named categories, matching
  the same scoping judgment `badgeClass` got.
- **Skeletons/loading fallbacks** (`app/(app)/loading.tsx`, `app/(app)/page.tsx`'s
  `DashboardSectionSkeleton`/`FuelingPlannerSkeleton`, `app/(app)/perfil/page.tsx`'s
  `PhysiologicalProfileSkeleton`, `RouteMapPreview`'s own `<Skeleton>` fallback) all
  updated to match — this app's "a loading fallback must mirror the real eventual shape"
  convention applies to radius too, not just layout.
- **`/login`'s auth-flow card and CTA button** — despite living outside the Dashboard/Perfil
  scope every other pass in this section is careful to stay within, this request's own
  "absolutamente todos los componentes de la interfaz" wording named no page exclusion, and
  a radius-only change carries none of the height/scroll risk that made this page's
  *spacing* off-limits in prior passes — so `LoginHeroLayout`'s mobile card and
  `StravaLoginButton`'s CTA both stepped down to `rounded-sm` too.
- **Deliberately left untouched**: `components/toast.tsx`'s `rounded-xl` (a floating
  notification, not page-content chrome — same "floating overlays are a distinct design
  language" exemption the border-removal passes already established) and
  `RouteMapPreview`'s own floating distance/elevation badge (a glass chip, not a card).
- Verified via `npx tsc --noEmit`/`npm run lint`/`npm run build` (all clean) and a live
  Playwright check (a temporary `DashboardShell` preview wrapping `FuelingPlanner`,
  `PostRideAnalysis`, and `PhysiologicalProfileForm` with mocked data, at 390px and 1280px)
  — confirmed every button/card/select/segmented-control/stepper renders with the same
  small `rounded-sm` corner, with only the radio-indicator dot staying circular.

**The same pass also applied an "ultracompact" ~50% reduction to the Dashboard's macro
header spacing** ("Jerarquía de Espaciado Editorial y Estructura Frameless," a follow-up
to the twelfth pass's own more moderate tightening):

- **`<main>`'s own top padding** (`components/dashboard-shell.tsx`, shared by every
  interior route) — `pt-10 sm:pt-14` → `pt-3 sm:pt-4`, a request literally aimed at "que el
  Dashboard... se sienta como una aplicación nativa... densa," applied once at the shared
  shell level so all four routes (Dashboard, Perfil, Estadísticas, Historial) inherit it.
- **Greeting → tabs** (`app/(app)/page.tsx`) — the outer wrapper's `gap-6` (itself a still-
  earlier explicit "margen generoso" request, see the twelfth pass above) tightened to
  `gap-3`, this later, more specific instruction superseding that one.
- **Tabs → card title** — both `TabsContent` wrappers' `pt-4` → `pt-2`.
- **Card title → first numbered step** (`components/fueling-planner.tsx`'s
  `CardTitle`) — mobile's `mb-6` → `mb-3` (the `sm:mb-0` breakpoint, which relies on the
  base `Card`'s own `--card-spacing` gap rather than an explicit margin, was left as-is).
- **The same title→first-card tightening was extended to `/perfil` and Post-Ride
  Analysis** — both routes follow the identical "outer wrapper gap governs header→first-
  visible-block spacing, while an *inner*, separate wrapper governs the gap *between* the
  numbered cards themselves" structure (`app/(app)/perfil/page.tsx`'s outer `gap-6` vs.
  `PhysiologicalProfileForm`'s own `gap-6` between its 3 Cards; `PostRideAnalysis`'s outer
  `gap-6` vs. its inner `result &&` wrapper's own separate `gap-6` between its 3 numbered
  cards) — so tightening only the *outer* wrapper to `gap-3` in both files shrinks
  header→first-card spacing without touching the cards' own separation from each other,
  the exact concern the still-fresh "Corrección: Visibilidad y Separación Real de Tarjetas"
  investigation (see the twelfth pass above) had already confirmed was never a real bug.
  **Estadísticas and Historial were deliberately left untouched** — both are documented
  elsewhere as mid-rebuild and outside this section's established scope (see the "Zero-
  border pass" bullet under the ninth pass above for the same exclusion applied to a
  different sweep), and this specific bespoke gap-value tightening isn't a shared-token
  change that would apply to them automatically the way the radius pass above did.
- **`space-y-5` → `space-y-3`** — `PostRideAnalysis`'s loading-skeleton wrapper was the one
  remaining `space-y-5` in the app (Paso 02's own `gap-5` sub-sections had already been
  tightened to `gap-3` in an earlier pass, per this same rule).
- **Frameless/zero-border verification** — a grep across the Dashboard's own components
  turned up no stray 1px borders beyond the already-deliberate exceptions documented
  elsewhere (`TabsList`'s own `border-b` underline, the spinner's `border-2`, the dashed
  GPX/route-preview drop-target borders) — the 100%-frameless system from earlier passes
  was already intact; nothing needed removing.
- **"Sincronizar" placement re-verified, no code change needed** — `SyncForm` still only
  renders inside `viewer-identity.tsx`'s sidebar identity card and as `PostRideAnalysis`'s
  empty-state CTA, never in the Dashboard header (moved out in the "PNS premium redesign"'s
  own fourth pass, see above).
- Verified together with the radius pass above via the same Playwright check — confirmed
  the greeting sits close beneath the sticky header, the tabs sit close beneath the
  greeting, "Planificador de nutrición"/"Análisis post-ruta" sit close beneath the tabs, and
  each numbered step/card sits close beneath its own title, while the porcelain gaps
  *between* the independent numbered cards (Post-Ride Analysis's 3 cards, Perfil's 3 cards)
  remain exactly as generous as before.

**A fourteenth pass partially reversed the thirteenth's own macro padding — the *only*
relationship that came back generous is `<main>`'s own top gap, everything else stays
tight.** A follow-up "Jerarquía de Espaciado Editorial y Estructura Frameless" request
re-specified the same proximity scale, but this time explicitly asked for the sticky
header → page title relationship to read as a comfortable, clearly differentiated "aire
visual," while every *internal* header relationship (greeting→tabs, tabs→title,
title→first-card, eyebrow→first-input, related-controls spacing) stays exactly as tight
as the thirteenth pass already left it — a literal reversal of just that one rule, not a
full revert of the whole ultracompact pass:

- **`<main>`'s own top padding** (`components/dashboard-shell.tsx`, shared by every
  interior route) — `pt-3 sm:pt-4` (the thirteenth pass's own ultracompact value) reversed
  back to `pt-6 sm:pt-8`, a deliberately generous gap between the sticky header/sidebar and
  "Hola, Alejandro" (or `/perfil`'s/`/estadisticas`'s/`/historial`'s own `<h1>`).
- **Every other spacing rule from the thirteenth pass was already correct and needed no
  change** — re-checked against the current code rather than blindly re-applied: greeting
  → tabs (`gap-3`), tabs → card title (`pt-2` on both `TabsContent` wrappers), card title →
  first numbered step (`CardTitle`'s own mobile `mb-3`), the eyebrow → first-input `mt-2`
  rhythm inside every numbered card, and the `gap-3` already governing related side-by-side
  controls (Paso 02's Intensidad/Fecha grids) — all confirmed still in place.
- **Frameless/zero-border, `rounded-sm`, and "Sincronizar" in the sidebar** — all
  re-verified already correct (no Dashboard borders beyond the established deliberate
  exceptions, every button/card/selector still `rounded-sm`, `SyncForm` still only in
  `viewer-identity.tsx`/`PostRideAnalysis`'s empty state) — nothing to change, matching this
  section's own "verify against current code, don't re-apply blindly" convention.
- Verified via `npm run build` (clean) and a live Playwright check (the same temporary
  `DashboardShell` preview pattern) at 390px and 1280px — confirmed a clearly visible,
  comfortable gap now separates the sticky header from "Hola, Alejandro," while the
  greeting→tabs→title→card sequence directly beneath it still reads as tightly bound, not
  reopened back to the pre-thirteenth-pass spacing.

### Spanish-only UI text

A pass removed the remaining "Spanglish" — English words left over in otherwise-Spanish
copy, mostly from this project's original English feature names bleeding into
user-visible strings. Only actual UI text/copy changed (headers, card titles, badges,
error messages, the clipboard/export text, PWA manifest/meta descriptions); internal
TypeScript identifiers, types, and code comments (`FuelingMode`, `fuelingMode` state,
`logFuelingPlan`, `recoveryDebt`, the `"pre-ride"`/`"post-ride"` `Tabs` `value`s, etc.)
were deliberately left alone — renaming those has no user-visible effect and would be a
large, risk-only mechanical refactor across API routes/DB-adjacent code. Changes:

- Dashboard tabs: "Pre-Ride"/"Post-Ride" → "Antes de salir"/"Al llegar" — later renamed
  again to "Pre-ruta"/"Post-ruta" for a more technical/professional register (see the
  "Code style" section's `TabsTrigger`/`font-mono` note above). The internal `"pre-ride"`/
  `"post-ride"` `Tabs` `value`s stayed the same through both renames, same "copy changes,
  identifiers don't" convention as everything else in this section.
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

### "Fecha y hora de salida" card & the planner's final CTA

`DeparturePicker` (`components/fueling-planner.tsx`) used to be just another bare grid cell
sitting alongside "Ruta"/"Intensidad objetivo" (or "Duración"/"Vatios objetivo" in quick
mode) — visually indistinguishable from the plain input fields around it, even though it's
actually a compound control (the Hoy/Mañana/Elegir fecha segmented pills, an optional date
picker, and an hour `<select>`). It now renders inside its own `rounded-lg border
border-neutral-200 px-3 py-3` wrapper headed by "Fecha y hora de salida" (replacing the
plain "Salida" eyebrow label), so the date+time controls read as one grouped unit at every
one of `DeparturePicker`'s three call sites (route/quick/GPX modes) — a single component
change rather than restructuring each mode's surrounding grid.

The planner's final "Calcular estrategia" button was restyled into a more prominent
closing CTA: relabeled "Calcular estrategia nutricional" with a leading `Zap` icon
(`lucide-react`, not a literal ⚡ emoji — this app's no-emoji convention applies to buttons
too), and widened from `w-full sm:w-fit` (fit-content on desktop) to always `w-full` with
taller `py-3.5` padding and a `mt-4` gap above it, so it reads as a clear final step
regardless of viewport rather than shrinking to an inline-sized button on wider screens.
Still `primaryButtonClass` (the shared terracotta token) underneath — not a new one-off
hex color, despite an initial spec suggesting one; this app's design-system convention
(see "Code style" below) is to reuse `--terracotta` for every primary action rather than
introduce a second near-identical accent color for the same role.

### UX flow, interaction logic & mobile usability pass

A bundled pass targeting login-copy redundancy, `/perfil` tooltip/z-index bugs, map
re-centering, and the planner's route-source/Calculadora/CTA flow:

- **Login copy, deduplicated.** `components/login-hero.tsx`'s `headerTagline` used to be a
  short uppercase eyebrow ("Planificación & avituallamiento") sitting directly under the
  h1 ("Nutrición de precisión para ciclistas") — two adjacent lines both claiming to
  introduce the app, reading as redundant. `headerTagline` is now a full sentence
  ("Estrategia de avituallamiento pre y post-ruta adaptada a tus vatios reales.") restyled
  from the uppercase/tracked eyebrow treatment to a plain sentence-case subtitle
  (`text-neutral-500`, no `uppercase`/`tracking-widest`/`text-terracotta`) — a full sentence
  in tracked uppercase mono would have read as shouted, not introductory copy. The h1 itself
  was already correct and needed no change.
- **`/perfil` tooltips: FTP and VLaMax, plus a real z-index/overflow fix.** Two new
  `InfoTooltip` call sites in `components/physiological-profile-form.tsx` — "FTP (W)"
  ("Potencia Máxima Sostenible en 1 hora (W). Si no lo conoces, puedes usar el 95% de tu
  mejor esfuerzo de 20 minutos.") and "Fenotipo metabólico (VLaMax)" ("Mide tu tasa de
  producción de lactato. Un VLaMax alto corresponde a un perfil explosivo/esprinter (mayor
  consumo de glucógeno); un VLaMax bajo corresponde a un perfil fondista/diésel.") — joining
  the pre-existing "Tasa de sudoración"/"Adaptación digestiva" tooltips, so every
  self-reported field on this page now has a plain-language explainer. The underlying bug
  these needed fixing alongside: `components/ui/card.tsx`'s base `Card` primitive carries
  `overflow-hidden` (needed elsewhere for image-corner clipping), which was silently
  clipping any tooltip popover that opened near a card's own top/bottom edge — a tooltip on
  a field near the boundary between two of `/perfil`'s three stacked cards would get cut off
  by whichever card's edge it crossed. Fixed with a scoped `className="overflow-visible"`
  override on all 3 `<Card>`s in `physiological-profile-form.tsx` specifically (not a change
  to the shared primitive itself, which other call sites still rely on for corner-clipping),
  plus bumping `InfoTooltip`'s own popover from `z-10` to `z-50` so it also clears any
  sibling card sitting on top of it in stacking order.
- **Redundant sodium block, consolidated.** The "Sudo mucha sal" checkbox used to carry its
  own two-line block ("Sudo mucha sal (cercos blancos en el maillot / escozor en los
  ojos)" + a second explanatory line) sitting directly below the "Tasa de sudoración"
  selector — but that selector's own "Alta" `RadioCard` description already reads "Sudoración
  abundante o muy salada. Marcas blancas evidentes en maillot y cintas del casco," the exact
  same visible-salt signal repeated almost verbatim. `is_salty_sweater` stays a real,
  independent DB field (sweat *concentration* is a genuinely different axis from sweat
  *volume* — see `getSodiumLossMgPerHour` in `lib/metabolic-engine.ts`), but its UI shrank
  from a two-line descriptive sub-block to one compact single-line checkbox row ("Además, mi
  sudor es especialmente salado (más allá del volumen) — sube el objetivo de sodio.") with no
  repeated "cercos blancos" phrasing — a refinement of the existing selector rather than a
  second descriptive block competing with it.
- **Map re-centering.** `components/route-map-preview.tsx`'s `MapZoomControls` gained a
  third button (a `Locate` icon from `lucide-react`) below the existing `+`/`−` pair, calling
  `map.fitBounds(points, { padding: [16, 16] })` — the exact same call `FitBoundsToRoute`
  already makes once on mount, just re-runnable on demand. A phone's own scroll/pan gesture
  easily drags the route out of frame, especially while the surrounding page is being
  scrolled past the map itself; this snaps straight back without needing to reload or
  reselect the route. Applies to every `RouteMapPreview` call site automatically (the
  Fueling Planner's own map and Post-Ride Analysis's telemetry-card map), since it's the one
  shared component behind both.
- **Route selection simplified from 3 tabs to 2.** The Paso 01 mode toggle used to be
  "Ruta Strava" / "Calculadora" / "Subir GPX" as three independent, equal-weight top-level
  modes — collapsed to "Ruta / GPX" / "Calculadora," since a Strava route and an uploaded
  GPX track are really the same underlying concept (a route with real geometry) differing
  only in *where* the geometry comes from, not two unrelated planning strategies deserving
  separate top-level tabs. Internally `mode` still has 3 values (`"route" | "quick" | "gpx"`)
  — every downstream consumer (Paso 02's conditionals, `handleCalculate`'s request-body
  branching, the map-render conditionals) is untouched; only Paso 01's own internals and the
  segmented toggle changed:
  - **"Ruta / GPX" tab** — when no GPX has been uploaded (`parsedGpx === null`), shows the
    Strava route `<select>` (or the "sin rutas" fallback) exactly as before, plus a new
    compact secondary action directly beneath it: "+ Subir GPX" (an `Upload` icon plus text,
    not a full third tab). Clicking it toggles a `gpxUploadOpen` boolean, revealing the same
    drag-and-drop dropzone that used to be its own standalone mode, now nested inside this
    one instead.
  - **Uploading a file resets the Strava selection.** `handleGpxFile`'s success branch now
    also calls `setMode("gpx")`, `setSelectedRouteId("")`, and `setGpxUploadOpen(false)` — the
    instant a GPX parses successfully, it becomes *the* active route source, and the Strava
    selector is cleared rather than left selected alongside it (there's only ever one active
    route at a time, never two simultaneously "current"). While `mode === "gpx"` and
    `parsedGpx` is set, the Strava `<select>` doesn't render at all — replaced by a compact
    porcelain row showing the uploaded file's name/distance/elevation plus a "Quitar GPX"
    button (resets `parsedGpx` to `null`, flips back to `mode: "route"`, and restores
    `selectedRouteId` to the first Strava route again, a sane default to land back on).
  - The segmented toggle's "Ruta / GPX" button is active whenever `mode` is `"route"` *or*
    `"gpx"`, and its `onClick` picks whichever sub-source is actually current
    (`setMode(parsedGpx ? "gpx" : "route")`) — so switching away to Calculadora and back
    returns to the GPX view if one was active, not always back to the Strava selector.
- **Calculadora: no pre-filled defaults, plus a structured-workout intensity selector.**
  `quickDurationHours`/`quickAverageWatts` used to default to `2`/`180` — plausible-looking
  numbers an athlete could easily calculate against without ever having entered their own
  real values. Replaced with 3 raw string inputs (`quickHoursInput`/`quickMinutesInput`/
  `quickAverageWattsInput`, all defaulting to `""`), with the single "Duración (h)" decimal
  field split into "Duración — Horas" and "Duración — Minutos" (an integer hours field plus
  a 0-59 minutes field, closer to how a rider actually thinks about ride length) — derived
  into one `quickDurationHours` decimal figure (`hours + minutes/60`) purely for the request
  body, same unit the backend always expected. A new "Intensidad objetivo / Tipo de entreno"
  `<select>` (`STRUCTURED_WORKOUT_OPTIONS`: Fondo (Z2) → `endurance`, Tempo (Z3) → `tempo`,
  Series/Intervalos (Z4-Z5) → `vo2max`, Competición → `threshold`, plus a default "Ritmo
  constante (usar solo vatios)" option) exists because a structured session's *average*
  watts routinely understates its real metabolic cost — an interval set spends meaningful
  time well above that average during the hard efforts, which is what actually drives
  glycogen burn, not the smoothed-out mean. When a session type is named,
  `handleCalculate` sends it as `structuredIntensity` in the request body; `POST
  /api/fueling/plan`'s quick-mode branch (`app/api/fueling/plan/route.ts`) now derives
  `relativeIntensity` from `getRelativeIntensityFromLevel(structuredIntensity)` when a valid
  one is present, falling back to the original `getRelativeIntensity(averageWatts, ftp)` path
  for an unnamed, steady-state ride — a genuinely optional enhancement, not a required field.
- **CTA gating, checkbox order, and a structured results card.** Three related fixes to the
  final CTA block:
  - **"Ruta objetivo / Competición" now sits strictly above "Calcular estrategia
    nutricional,"** not beside it in the same flex row — it's an input that changes what the
    button's click actually computes, so it reads more naturally as "one more thing to
    configure before pressing calculate" than as a peer action next to the button itself.
  - **The button's `disabled` gating gained a Calculadora branch**: `(mode === "quick" &&
    !quickValid)`, where `quickValid = quickDurationHours > 0 && quickAverageWatts > 0` —
    previously Calculadora mode had no gating at all (the button was always clickable there,
    even with the old prefilled 2h/180W defaults never having been genuinely
    entered/confirmed by the athlete). A small helper line ("Introduce una duración y unos
    vatios objetivo válidos para poder calcular.") renders under the disabled button in this
    specific case, mirroring the existing `ProfileRequiredBanner` pattern for the
    profile-incomplete case.
  - **The "OBJETIVO/CUBIERTO/RESTANTE" breakdown inside "Comida en bolsillo"** (both its
    calculated and not-yet-calculated placeholder states) moved from the porcelain
    `rounded-sm bg-[#F8F7F5] p-3` sub-block treatment to an explicit `rounded-xl border
    border-zinc-200 bg-white p-4 shadow-none` structured card, per an explicit request for
    this one breakdown to render "dentro de un bloque/tarjeta blanca estructurada." This is
    a deliberate, scoped exception to two of this app's own established conventions —
    the app-wide `rounded-sm` radius scale (see "PNS premium redesign" → "Radio de Bordes
    Pequeño Global" below) and the "porcelain sub-block nested inside an already-white card"
    pattern this same accordion uses everywhere else — applied narrowly to just this one
    block rather than expanded into a broader system change. The literal spec named
    `shadow-none` but not "no border" — a hairline `border-zinc-200` was added on top of the
    literal ask specifically because a bg-white block with zero shadow *and* zero border,
    nested inside Paso 03's own already-bg-white card, would otherwise be visually
    indistinguishable from its parent, defeating the "estructurada" half of the request.

Verified via `npx tsc --noEmit`/`npm run lint`/`npm run build` (all clean) and a live
Playwright check (a temporary route rendering the real `LoginHeroLayout`,
`PhysiologicalProfileForm`, and `FuelingPlanner` with mocked props) at 390px mobile and
1280px desktop — confirmed the deduplicated login copy, the FTP tooltip rendering
unclipped above its card boundary, the 2-tab "Ruta / GPX"/"Calculadora" toggle with the
"+ Subir GPX" secondary action and the map's new re-center button, the Calculadora's blank
duration/watts fields with the disabled CTA and its helper line, and the checkbox now
sitting above the (enabled, since a route was selected) CTA button in Ruta mode.

**A follow-up pass renamed the second tab.** "Calculadora" was flagged as an ambiguous
label — it describes the mechanism (a calculator) rather than what the athlete is actually
telling the planner (that there's no saved route/GPX for this session, just a manually
described workout) — so the segmented button's visible label changed to **"Entreno
Manual."** The internal `mode` value stays `"quick"` (unchanged identifier, same
convention as every other copy-only rename in this codebase — see "Spanish-only UI text"
below), so nothing downstream of the button (the request-body branching, Paso 02's
conditionals) needed to change. Every doc reference to "Calculadora" written *before* this
rename (throughout this file's history of the Fueling Planner) is left as-is — those
describe what the UI was called at the time, not what it's called now; only this section's
own verification note and the label itself were updated.

**A second follow-up pass removed every remaining silent default from Paso 01/02** —
auto-loading the athlete's last-used route/intensity/hour on every page load meant a
distracted click on "Calcular estrategia" could compute against a route or intensity the
athlete never actually chose for *this* session, silently reusing whatever happened to be
selected last time:

- **No route pre-selected.** `selectedRouteId` used to default to `routes[0]?.id ?? ""` —
  even with real saved Strava routes on hand, that meant the athlete's most recent route was
  silently active on every fresh page load. Now always starts at `""` regardless of how many
  routes exist, and the `<select>` renders a real placeholder option ("Seleccionar ruta de
  Strava...", `disabled` so it can't be re-selected once a real route is chosen) rather than
  jumping straight to the first route in the list. Removing an active GPX (the "Quitar GPX"
  button, see the pass above) now resets back to this same empty `""` too, not `routes[0]`
  — consistent with "never silently pick a route for the athlete" at every point in the
  flow, not just on first load.
- **The map's own empty state was already correct for free** — `RouteMapPreview` shows its
  neutral placeholder whenever `points` is `null`/has fewer than 2 entries, and an empty
  `selectedRouteId` already resolves to `selectedRoute === null` → `selectedRoutePoints ===
  null`, so no new conditional was needed there, just the state-default fix above. The
  default placeholder copy itself (`RouteMapPreview`'s own `emptyMessage` prop default, in
  `components/route-map-preview.tsx`) was reworded to match this pass's exact spec —
  "Selecciona una ruta o sube un archivo GPX para visualizar el trazado." (was "...de
  Strava o sube un GPX...") — Post-Ride Analysis's own call site passes its own explicit
  `emptyMessage` ("Sin datos de trazado GPS para esta actividad."), so this default-string
  change only affects the planner's two call sites (Ruta mode, GPX mode).
- **No intensity pre-selected.** `intensity` used to default to `"endurance"` ("Fondo Z2")
  — now typed `IntensityLevel | ""`, starting at `""`, with both Intensidad Objetivo
  `<select>`s (route mode's `#intensity` and GPX mode's `#intensity-gpx`, which share this
  one piece of state) gaining the same disabled placeholder pattern as the route select
  ("Seleccionar intensidad...").
- **"Hoy" stays the default departure day** — a same-day ride is still the overwhelmingly
  common case, and which day starts selected is a low-stakes default unlike a route or
  intensity choice that could silently drive a wrong calculation; only `departureDayMode`'s
  previous default (`"tomorrow"`) changed, to `"today"`. The **hour**, though, no longer
  defaults to a fixed "08:00" regardless of when the athlete actually opens the planner —
  **`getRoundedCurrentHour()`** (`components/fueling-planner.tsx`) rounds the real current
  local time to the nearest whole hour (30+ minutes rounds up) and clamps it into
  `DEPARTURE_HOUR_OPTIONS`' own 05:00-20:00 range, so the initial hour reads as "now-ish"
  rather than an arbitrary stand-in the athlete has to notice and correct — a `useState`
  lazy initializer, same pattern `departureCustomDate` already uses for `todayIsoDate`.
- **Entreno Manual's duration/watts fields were already blank** — no change needed here,
  since the prior "Calculadora" pass had already removed their `2`/`180` prefilled defaults
  in favor of empty string inputs with descriptive placeholders.
- **CTA gating extended to cover intensity, not just route/GPX presence.** A new derived
  `routeModeIncomplete` (`(mode === "route" && (!selectedRoute || !intensity)) || (mode ===
  "gpx" && (!parsedGpx || !intensity))`) feeds three things: the button's own `disabled`
  condition (previously only checked for a selected route/GPX, never intensity), a `title`
  attribute on the button itself ("Selecciona una ruta e intensidad para calcular" — a
  native-tooltip hover hint, satisfying the spec's "aviso sutil o tooltip" as a soft,
  non-blocking affordance), and a visible helper line below the button ("Selecciona una ruta
  e intensidad objetivo para poder calcular.") mirroring the existing Entreno Manual
  incomplete-state helper text exactly. Entreno Manual's own gating (`quickValid`) is
  unchanged — it never had an "Intensidad Objetivo" selector of its own to require, since
  average watts already serves that role there.

Verified via `npx tsc --noEmit`/`npm run lint`/`npm run build` (all clean) and a live
Playwright check (a temporary route rendering the real `FuelingPlanner` with a mocked
Strava route) at 390px mobile — confirmed the route select, intensity select, and hour
field's actual DOM values on a fresh load (`""`, `""`, and a real rounded-current-hour
value, not "08:00"), the map rendering its neutral empty state, the CTA disabled with the
new helper text visible, the button staying disabled after selecting only a route, and the
button becoming enabled only once both a route *and* an intensity were chosen.

**A further pass unified "Intensidad Objetivo" into one shared selector across all 3 modes.**
Before this, Ruta mode and GPX mode already shared one 5-option list (`recovery`/`endurance`/
`tempo`/`threshold`/`vo2max`, via `intensityLabels`), but Entreno Manual carried its own,
differently-scoped "Intensidad objetivo / Tipo de entreno" selector — 4 options
(`STRUCTURED_WORKOUT_OPTIONS`: Fondo/Tempo/Series-Intervalos/Competición), a different
tooltip (about why structured sessions need this at all), and a non-disabled empty option
("Ritmo constante (usar solo vatios)") rather than a disabled placeholder — three genuinely
different selectors doing conceptually the same job. All 3 now render through one shared
component, **`IntensityObjectiveSelect`** (`components/fueling-planner.tsx`, a plain
function component, not a hook — takes `id`/`value`/`onChange` so its 3 call sites can each
still bind to the one shared `intensity` state under a different `<select id>`):

- **One label + tooltip, byte-identical everywhere.** "Intensidad objetivo" (`font-mono
  text-xs font-semibold tracking-wider text-zinc-500 uppercase`, this pass's own literal
  class spec — slightly heavier/larger than the file's usual `eyebrow` constant, a
  deliberate one-off to match the request exactly) plus an `InfoTooltip` icon carrying a
  detailed 6-zone physiological guide (`INTENSITY_ZONE_TOOLTIP_NOTE`) — Recuperación (Z1),
  Fondo Aeróbico (Z2), Tempo/Sweetspot (Z3), Umbral (Z4), Intervalos/VO2 Max (Z5-Z7), and
  Competición/Carrera, each with its %FTP band and a short physiological note. This replaces
  Entreno Manual's old narrower tooltip (which only explained *why* naming a session type
  helps, without the actual zone guide) — the *same* rich reference now shows in every mode,
  not a different, thinner explainer depending on which tab happens to be open.
- **`InfoTooltip` itself widened to support this.** Its `note` prop was `string`-only (every
  existing call site — FTP, VLaMax, sweat rate, gut training — passes one plain sentence);
  the 6-zone guide needs several `<p>`/`<strong>` lines, so `note` is now typed `ReactNode`
  (a string is already a valid `ReactNode`, so no existing caller needed to change) and a
  new optional `panelClassName` prop (merged via `cn()`) lets this one richer tooltip widen
  itself past the default `w-64` (`w-72 sm:w-80`) without affecting any single-line caller
  that doesn't pass it.
- **One placeholder, one option list, everywhere.** The disabled "Seleccionar intensidad..."
  placeholder (already used in Ruta/GPX mode from the prior pass) now also gates Entreno
  Manual's selector — replacing its old, non-disabled "Ritmo constante (usar solo vatios)"
  empty option. `INTENSITY_SELECT_OPTIONS` is the one shared 6-entry list (value + label)
  every mode's `<select>` maps over now, instead of Ruta/GPX's old plain `INTENSITY_OPTIONS`
  (5 `IntensityLevel` values rendered via the generic `intensityLabels` record) and Entreno
  Manual's separate 4-entry `STRUCTURED_WORKOUT_OPTIONS` — both deleted outright, along with
  the now-fully-unused `StructuredWorkoutType` type and `structuredWorkoutType` state.
- **A real 6th `IntensityLevel` value, not a UI-only label collision.** The old
  `STRUCTURED_WORKOUT_OPTIONS` mapped both "Series / Intervalos (Z4-Z5)" and "Competición"
  to two *different* underlying `IntensityLevel`s (`vo2max` and `threshold`, respectively) —
  but the new unified list needs "Intervalos / VO2 Max (Z5-Z7)" and "Competición / Carrera"
  as two visually distinct rows that could easily have been mapped to the *same* value
  instead (both describe near-maximal effort). That would have been a real bug in a native
  `<select>`: two `<option>`s sharing one `value` means React can't tell which one the
  athlete actually picked on re-render — it just displays whichever matching option comes
  first in DOM order. So `IntensityLevel` (`lib/metabolic-engine.ts`) gained a genuine 6th
  value, `"competition"` (`intensityLabels.competition = "Competición"`,
  `INTENSITY_RELATIVE_FTP.competition = 1.2`, just above `vo2max`'s `1.15`) — a real,
  distinct value with its own %FTP figure, even though in practice it computes an
  *identical* carb-oxidation rate to `vo2max` today (`getCarbOxidationRateGPerHour`'s own
  bands already cap out at the 100g/h gut-absorption ceiling for anything ≥1.1 relative
  intensity, so both values land in the same top band) — this is a genuine, extensible
  value now, not a cosmetic label sitting on top of a reused one. `VALID_INTENSITIES`
  (`app/api/fueling/plan/route.ts`) gained `"competition"` alongside the original 5, so the
  server accepts and validates it exactly like every other named zone.
- **Entreno Manual's own gating is deliberately unchanged.** Unlike Ruta/GPX mode (where an
  unselected intensity now blocks the CTA, see the pass above), Entreno Manual's `quickValid`
  still only checks duration/watts — leaving "Intensidad Objetivo" on its placeholder there
  is a genuinely valid, common choice (real average watts already drive the calculation on
  their own; naming a zone is an optional correction for a structured session, not a
  required input), so `handleCalculate`'s quick-mode body still sends `structuredIntensity:
  intensity || undefined` — present only when the athlete actually picked one, falling back
  to the existing watts-derived intensity path server-side otherwise. This is a deliberate,
  explicitly-scoped decision, not an oversight: this request was about unifying what the
  selector *looks like and offers*, not about changing which modes require it.

Verified via `npx tsc --noEmit`/`npm run lint`/`npm run build` (all clean) and a live
Playwright check (a temporary route rendering the real `FuelingPlanner` with a mocked
Strava route) at 390px — confirmed both the Ruta-mode and Entreno-Manual selects render the
exact same 7-item option list (placeholder + 6 zones, byte-for-byte identical
`allTextContents()` output), the `(?)` tooltip renders fully unclipped above the surrounding
card in both tabs (not cut off, `z-50` holding), and the tooltip content is identical
between both tabs.

### "Reestructuración UX: Flujo Invertido" — calculate first, adjust pocket food after

Paso 03 ("Estrategia y comida en bolsillo" — the Óptimo/Mi Inventario/Híbrido selector plus
the pocket-food inventory) used to sit *before* the CTA, meaning the athlete had to plan a
food strategy against a carb/fluid/sodium target they hadn't seen yet. Inverted: the
pre-calculation form is now just Paso 01 (Selección y origen de ruta) + Paso 02 (Condiciones
de la salida) + the CTA — Paso 03's entire contents moved into the results container,
restructured as 3 labeled sub-blocks inside the same white "tarjeta madre" that used to be
Paso 03's own card, now positioned as the *first* thing shown once a result exists (above
the pre-existing Hero card/weather card/stat rows/accordions, which are otherwise
untouched):

- **A · Necesidades metabólicas totales** — a small 3-stat readout (Carbohidratos objetivo,
  Líquido objetivo, Sodio objetivo) giving the athlete the *ride-total* figures up front,
  before anything else. `totalRideCarbsG` already existed; `totalFluidMl`/`totalSodiumMg` are
  new client-derived totals (`fluidLossMlPerHour`/`sodiumMgPerHour × durationHours`) — the
  API only ever returned per-hour rates, and adding a dedicated response field for two
  numbers this trivial to derive client-side wasn't warranted (same reasoning that kept
  `totalRideCarbsG` itself a derived figure early in this app's history).
- **B · Configuración de bidones** — a genuinely new 3-option segmented selector (`BOTTLE_CONFIG_OPTIONS`:
  "Solo agua" / "1 Agua + 1 Mix" / "Ambos con Mix"), no default (same "never silently pick
  one" convention every other post-inversion selector in this file now follows). **This is
  a planning-preference selector, not a parameter that re-drives `getBottlePlan`'s own
  GI/solubility-capped math** — that engine already computes the real, optimal bottle split
  server-side (see "Bottle architecture & osmolarity control" above), and re-architecting it
  to accept a manual override was judged out of scope for what this request explicitly framed
  as a UX-flow restructuring, not a physiological-engine change (the request's own
  verification checklist never mentions validating a recomputed bottle plan, only the pocket-
  food deficit counter). Instead, **`getBottleConfigSummary(config, result)`** builds a
  plain-language preview *entirely from figures `result` already carries* — `recipe.totalCarbsG`,
  `bottlePlan.fuelBottles.count/count.malto/fructose`, `bottlePlan.waterBottles.count` — never
  a fabricated number. Each option's summary is genuinely different and, when the athlete's
  preference doesn't match what the recipe actually needs (e.g. picking "1 Agua + 1 Mix" when
  the real recipe needs 2+ concentrated bottles to stay under the 8% GI cap), the summary
  says so explicitly rather than silently contradicting the automatic recipe shown further
  below.
- **C · Ajustador de comida en bolsillo** — the Estrategia nutricional selector (Óptimo/Mi
  Inventario/Híbrido) + legend + the pocket-food `<details>` accordion, relocated here
  verbatim (identical `open`/`key={fuelingMode}` remount logic, identical stepper grid) from
  the old Paso 03. **The objetivo/cubierto/restante banner was changed to use
  `pocketFoodCarbsPreview` instead of the frozen `result.pocketFoodCarbsG`** — a real,
  necessary fix, not just a relocation: the old banner compared against `result.pocketFoodCarbsG`,
  a value frozen at the *last server calculation*, so it never actually updated on a stepper
  tap even before this pass (pocket food only existed pre-calc back then, so this discrepancy
  was latent/unnoticed). The new explicit "Contador Dinámico en Tiempo Real" requirement
  surfaced it — `pocketFoodCarbsPreview` (already a pure client derivation from
  `effectivePocketFood`, unchanged) is what actually recomputes on every +/- tap with zero
  network round-trip. Relabeled to match the request's own wording — "CUBIERTO CON SELECCIÓN"/
  "DÉFICIT RESTANTE" instead of the old "CUBIERTO"/"RESTANTE" — and the old `result ? (...) :
  (<placeholder>)` ternary was removed outright, since this block now only ever renders
  inside `{result && (...)}` (a placeholder for "no result yet" is unreachable once Paso 03
  moved into the results container). A new helper line ("Pulsa 'Calcular estrategia
  nutricional' (arriba) de nuevo para actualizar la receta casera y el plan de bidones con
  esta selección.") clarifies the two-tier reactivity this design intentionally keeps: the
  deficit counter is instant/client-only, but the actual DIY recipe/bottle-plan numbers
  shown further below the fold still only update on the next explicit "Calcular estrategia
  nutricional" click — this app's long-standing "button-triggered recompute, not live
  per-keystroke" convention for anything that's genuinely server-computed (weather, gut cap,
  bottle GI/solubility math), left completely unchanged by this pass. The CTA button itself
  was *not* duplicated near sub-block C — it stays exactly where it already was, above the
  results container, remaining clickable at any time to recalculate with whatever pocket-food/
  fueling-mode/bottle-config-irrelevant state currently exists.
- **Auto-scroll was already implemented** — `resultRef`/the `useEffect(() => { if (result)
  resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }) }, [result])` pair
  predates this pass entirely (see "Fueling planner" above, "A freshly calculated strategy
  renders below the fold..."). No new code was needed to satisfy this request's "auto-scroll
  on calculate" ask — it already fires on every `result` change, including a recalculation
  triggered from the newly-relocated sub-block C.
- **CTA gating is unchanged** — the button was already disabled until a valid route/GPX
  + intensity (or valid Entreno Manual duration/watts) existed, from an earlier pass; nothing
  about Paso 03's removal from the pre-calc form affects that gating, since Paso 03 never
  factored into it.

Verified via `npx tsc --noEmit`/`npm run lint`/`npm run build` (all clean) and a live
Playwright check (a temporary route rendering the real `FuelingPlanner` with a mocked Strava
route and a mocked `/api/fueling/plan` response) at 390px — confirmed the pre-calculation
form contains neither "03 ·" nor "Comida en bolsillo" anywhere in the DOM, clicking
"Calcular estrategia nutricional" scrolls the page from `scrollY: 0` to `740` (smooth
auto-scroll fired), sub-blocks A/B/C all render with the correct headers and real
(non-placeholder) figures, tapping a pocket-food stepper's `+` button twice updates
"DÉFICIT RESTANTE" from `180g` to `136g` **instantly with no second network request** (the
mocked route only ever fired once, for the initial calculation), and cycling through all 3
"Configuración de bidones" options renders 3 genuinely different, correctly-computed summary
strings.

### Label typography homologation & compact duration input

Two small Paso 02 fixes, bundled together:

- **`formFieldLabelClass`** (`components/fueling-planner.tsx`, `"text-xs font-mono
  font-semibold tracking-wider text-zinc-500 uppercase"`) is now the one shared class every
  Paso 02 input label uses — Intensidad Objetivo (`IntensityObjectiveSelect`, already this
  exact style before this pass, now sourced from the shared constant instead of its own
  inline string so it can't independently drift), Fecha y Hora de Salida
  (`DeparturePicker`'s own eyebrow span), Duración Estimada, Vatios Objetivo, and GPX mode's
  "Tiempo estimado (editar)" label — all 5 previously used `eyebrow` (`text-[10px] font-mono
  uppercase tracking-widest text-zinc-500`, a smaller size with no `font-semibold` and looser
  tracking) except Intensidad Objetivo, which already had its own slightly different inline
  string — so every label in this one step read at a subtly different size/weight than its
  neighbor. `eyebrow` itself is untouched and still used everywhere else in this file (stat
  readouts like Ruta/Carbohidratos objetivo/Distancia — a different concern, data labels
  rather than form-field labels, not part of this request's scope). Vatios Objetivo and the
  GPX "Tiempo estimado" label weren't named explicitly in the request, but both sit in the
  exact same row as a label that was renamed — leaving them on the old `eyebrow` style would
  have reintroduced the same inconsistency one field over, so both were included.
- **Duración — Horas / Duración — Minutos merged into one "Duración Estimada" row.** These
  used to be two independent, full-width `<input>`s, each its own cell in a
  `grid-cols-1 sm:grid-cols-3` row alongside Vatios Objetivo — on mobile (the default,
  single-column layout) that meant two full-width stacked boxes for what's really one
  logical duration value. Now one label ("Duración estimada") sits above a
  `grid grid-cols-2 gap-3` pair of compact inputs, each with its own absolutely-positioned
  unit suffix (`h`/`min`, `pointer-events-none` so it never intercepts a click meant for the
  input) instead of a separate text label per field — `aria-label="Horas"`/`aria-label="Minutos"`
  on each input preserves accessible naming now that there's no visible per-input `<label>`.
  The outer grid dropped from `sm:grid-cols-3` to `sm:grid-cols-2` (Duración block + Vatios
  Objetivo) to match. `quickHoursInput`/`quickMinutesInput` state and their
  derivation into one `quickDurationHours` figure for the request body are both unchanged —
  this is a pure layout/markup change, no new state or calculation logic.

Verified via `npx tsc --noEmit`/`npm run lint`/`npm run build` (all clean) and a live
Playwright check (a temporary route rendering the real `FuelingPlanner`) at 390px —
confirmed all 4 labels (Duración Estimada, Vatios Objetivo, Intensidad Objetivo, Fecha y
Hora de Salida) resolve to byte-identical computed styles (`font-size: 12px`, `font-weight:
600`, `letter-spacing: 0.6px`, `text-transform: uppercase`, `font-family: "Geist Mono"`),
the hours/minutes inputs render side by side at the same `y` coordinate (not stacked), and
the old "Duración — Horas" text is gone from the DOM in favor of "Duración estimada."

### Unificación Global de Iconos de Tooltip — `HelpCircle` everywhere, dark panel

Every tooltip trigger in the app previously used lucide-react's `Info` icon — this pass
switched to `HelpCircle` (renders as `lucide-circle-question-mark` in this lucide-react
version, functionally the same "(?)" glyph) and restyled the popover panel from this app's
usual light/porcelain palette to a dark `zinc-900` panel with white `font-mono` text — a
deliberate one-off exception to the rest of the app's card system, since a help affordance
reads more clearly as a distinct, universal UI convention than another content card in the
same palette as the page around it.

Only two components in the whole codebase render a tooltip trigger icon —
**`components/info-tooltip.tsx`**'s `InfoTooltip` (every call site: `/perfil`'s FTP, VLaMax,
Tasa de sudoración, and Adaptación digestiva tooltips, plus the Fueling Planner's Intensidad
Objetivo zone guide) and **`components/fueling-context-tooltip.tsx`**'s
`FuelingContextTooltips` (the carb-ratio context note next to the Carbohidratos stat) — so
fixing both centrally covers every tooltip in the app with no other call site needing a
change. Both were previously two independent, near-identical CSS-only `group-hover`/
`group-focus-within` implementations (no shadcn/Radix `Tooltip` primitive exists in
`components/ui` — confirmed via `ls components/ui/` before touching anything — and this
session's established convention, from an earlier prompt using the same `TooltipProvider`/
`TooltipTrigger` shadcn-style code sample, is to adapt the existing pure-CSS component rather
than introduce a new dependency for a visual restyle); `FuelingContextTooltips` still isn't
merged into `InfoTooltip` itself, since it computes its own note from `getCarbRatioContextNote`
rather than accepting one as a prop — kept in sync by hand instead.

- **Icon**: `Info` → `HelpCircle`, wrapped in a real `<button type="button">` (the prompt's
  own literal spec) rather than a bare focusable SVG — `tabIndex`/`aria-label` moved from the
  icon onto the button, `group-focus-within` still fires the same way since the button is a
  descendant of the wrapping `group` span either way.
- **Trigger classes**: `text-zinc-400 hover:text-zinc-600 transition-colors outline-none
  focus:outline-none` (was `text-neutral-400 hover:text-neutral-700 focus:text-neutral-700`)
  at a fixed `size-3.5` (was `size-3.5` on `InfoTooltip` already; `FuelingContextTooltips`'
  own icon grew from `size-3` to `size-3.5` to match the new unified size exactly).
- **Panel**: `bg-zinc-900 text-white border-0 shadow-lg p-3 font-mono text-xs max-w-xs`
  (was `bg-background text-neutral-700 border border-neutral-200 shadow-md px-2.5 py-2
  font-sans w-64`/`w-56`) — `max-w-xs` replaces a fixed `w-64`/`w-56` so `InfoTooltip`'s own
  `panelClassName` override (the Intensidad Objetivo zone guide's `w-72 sm:w-80`) still
  applies correctly without fighting a conflicting fixed width; `z-50` was already correct
  on `InfoTooltip` (fixed in an earlier pass alongside the `/perfil` card
  `overflow-visible` fix) and was raised to match on `FuelingContextTooltips`, which had
  been sitting at a lower `z-10`.

Verified via `npx tsc --noEmit`/`npm run lint`/`npm run build` (all clean) and a live
Playwright check (temporary routes rendering the real `FuelingPlanner` and
`PhysiologicalProfileForm`) at 390px — confirmed every tooltip trigger across both
components renders the `lucide-circle-question-mark` SVG at exactly `14×14px`
(`size-3.5`), hovering resolves the panel's computed background to a dark near-black
value with white text and `font-family: "Geist Mono"` at `z-index: 50`, and the FTP
tooltip on `/perfil` still renders fully unclipped above its card boundary (confirming the
prior `overflow-visible` fix holds with the new panel styling).

### "Modo Competición / Ruta Objetivo" integrated into Card 02

The "Ruta objetivo / Competición" checkbox used to float on the porcelain canvas in its
own `<div>`, between Card 02 (Condiciones de la salida) and the CTA button — a genuine
floating element, not encapsulated in any white card. It's now the last thing rendered
inside Card 02 itself, after all 3 mode-specific conditionals (route/quick/gpx), separated
by a thin `border-t border-zinc-100 pt-3` divider so it reads as this card's own trailing
sub-section (a departure condition, same category as Intensidad Objetivo/Fecha y hora)
rather than a fourth sibling alongside them. The CTA button and its own helper texts/
`ProfileRequiredBanner` stay exactly where they were, directly below Card 02 — only the
checkbox moved, since the button itself is an action, not a departure condition.

### Agrupación Estructurada de Resultados — 3 white "tarjeta madre" cards

The Pre-Ruta result panel used to mix one combined white card (the prior "Flujo Invertido"
pass's Sub-bloques A/B/C) with several genuinely floating elements below it on the bare
porcelain canvas — the dark "Dosis casera por bidón" Hero card, `WeatherImpactCard`, a bare
3-column stat row (Duración/Carbohidratos/Sodio), the gut-training warning banner, the
Balance Neto grid, and every recipe/timeline/reload/carb-loading `<details>` accordion —
none of those had their own white-card boundary. Restructured into 3 independent white
cards (`rounded-xl border-0 bg-white p-4 shadow-none`, this prompt's own literal spec),
`gap-4` apart on the canvas, absorbing every one of those previously-floating pieces so the
results container's direct children are now exactly these 3 cards and nothing else
(verified live — see below):

- **`rounded-xl` is a deliberate, scoped exception** to this app's app-wide `rounded-sm`
  "Radio de Bordes Pequeño Global" convention (see "PNS premium redesign" above) — this
  prompt's own code sample explicitly specifies `rounded-xl p-4 border-0 shadow-none` for
  these 3 result cards specifically. Every other card/button/select/selector in the app
  (Paso 01/02's own cards, every button, every `<select>`) is untouched and stays
  `rounded-sm` — this isn't a reversal of that global pass, just a one-off exception for
  this one prompt's own explicit spec on these 3 cards. Nested sub-blocks inside them use
  `rounded-lg` (the 2x2 grid cells, the Balance Neto block, the bottle-config/coverage
  banners), matching the prompt's own `rounded-lg` spec for nested sub-blocks — one step
  down from the outer card's `rounded-xl`, same "outer vs. nested" radius relationship this
  app already uses elsewhere (e.g. Perfil's cards vs. their own porcelain sub-blocks).
- **Tarjeta 1 · `03 · Metabolismo y objetivos calculados`** — the 2x2 grid the prompt asked
  for (Duración / Carbohidratos g/h+Total / Hidratación ml/h+Total / Sodio mg/h+Total,
  each its own `bg-[#F8F7F5] rounded-lg` cell) replaces two previously-separate figures
  (the old bare hourly-rate stat row and the old Sub-bloque A's separate ride-total grid) —
  Hidratación's total converts `totalFluidMl` to liters (`(totalFluidMl / 1000).toFixed(1)`)
  to match the prompt's own "X.X L" example. Below the grid: the Balance Neto sub-block
  (`bg-[#F8F7F5] rounded-lg p-3 mt-3`, the prompt's own literal spec) with the same
  Gasto Estimado/Ingesta Planificada/Déficit Neto figures as before, unchanged. **Three
  pieces not named in the prompt's own literal Card-1 outline were folded in anyway,
  rather than dropped** — the dark Hero card ("Dosis casera por bidón," nested here as a
  `bg-[#343334]` sub-block instead of its own floating card, preserving the deliberately-
  tuned bright-orange-on-dark callout documented across several "PNS premium redesign"
  passes), `WeatherImpactCard` (real Open-Meteo data — dropping it would violate this
  app's "never silently drop real data" convention), and the gut-training warning banner
  (also real, conditional data). All three are semantically about "the calculated
  metabolic targets," so Card 1 is their natural home even though the prompt's own outline
  only explicitly named the grid and the Balance Neto sub-block — flagged here
  transparently as a scope judgment call, not a silent addition.
- **Tarjeta 2 · `04 · Configuración de bidones y comida en bolsillo`** — the bottle-config
  selector (unchanged, still a planning preference built on real `result` figures via
  `getBottleConfigSummary`, not a parameter that re-drives the recipe engine — see that
  function's own doc comment) plus the Estrategia nutricional selector (Óptimo/Mi
  Inventario/Híbrido) and the pocket-food inventory, all flattened into one card with no
  `<details>` accordion — the old "Comida en bolsillo" accordion's own summary/counter row
  was pure duplication once this card's own header already frames the whole section, so it
  was removed rather than nested redundantly one level deeper. The coverage banner
  (`bg-[#F8F7F5] rounded-lg p-3`) was reworded from the prior pass's "OBJETIVO/CUBIERTO CON
  SELECCIÓN/DÉFICIT RESTANTE" ALLCAPS format to this prompt's own literal "Objetivo: Xg HC
  · Cubierto: Yg HC · Restante: Zg HC" wording — still driven by the same reactive
  `pocketFoodCarbsPreview` client-side derivation (recomputes instantly on every stepper
  tap, no network round-trip), just restyled. `pocketFoodItemCount` (the old accordion
  summary's own item-count figure) was deleted outright as genuinely dead code once its one
  call site — the removed accordion summary — was gone.
- **Tarjeta 3 · `05 · Pauta de ingesta y receta casera`** — the Receta de Laboratorio
  Casero accordion (+ Copiar Receta), the Cronograma Dinámico de Ingesta accordion, and the
  Estrategia de Carga Día −1 accordion (conditional), exactly as the prompt's own list
  specifies, plus the export block (Descargar GPX / Exportar a Garmin button + the alarm-
  clock guidance note) — all unchanged internally, just re-nested inside one white card
  instead of each floating as its own independent `bg-[#F8F7F5]` accordion on the canvas.
  **The reload-strategy accordion ("Estrategia de recarga en ruta") wasn't named in the
  prompt's own literal list either, but is real, conditional content** (only rendered when
  `result.reloadStrategy` isn't `null`) — folded in here too, between Cronograma and Carga
  Día −1 (its existing relative position), for the same "don't silently drop real data"
  reasoning as Card 1's extra pieces above.
- **Left genuinely outside all 3 cards**: the `isOfflineCache` badge, which still renders
  above Card 1 when applicable — a transient system-level notice about data freshness
  (same category as a toast), not calculated ride-nutrition content, so it doesn't belong
  inside any of the 3 result cards. The old floating eyebrow line ("Estrategia de bolsillo
  & receta casera") that used to sit above the old combined card was deleted outright —
  redundant now that each of the 3 new cards carries its own numbered header.

Verified via `npx tsc --noEmit`/`npm run lint`/`npm run build` (all clean) and a live
Playwright check (a temporary route rendering the real `FuelingPlanner` with a mocked
Strava route and a mocked `/api/fueling/plan` response including a populated
`reloadStrategy`/`carbLoading` to exercise every conditional block) at 390px — confirmed
the checkbox sits inside Card 02's own DOM subtree, none of the old "A ·"/"B ·"/"C ·"
sub-block headers or the old floating eyebrow remain anywhere in the page, and — critically
— evaluating the results container's direct DOM children confirms all 3 (and only 3) are
present, each carrying the exact `rounded-xl border-0 bg-white p-4 shadow-none` class
signature, with no other direct child (no loose text, no stray div) sitting alongside them.

### Entreno Manual: "Vatios Objetivo" removed, derived from Intensidad Objetivo × FTP

Entreno Manual used to ask for both a raw average-watts figure *and*, optionally, a named
intensity zone (`structuredIntensity`) as a correction on top of it — genuinely redundant
once the shared `IntensityObjectiveSelect` (see "Prompt de Unificación..." above) already
asks every mode for the same zone. The watts input is gone entirely now: `quickAverageWattsInput`
state, the `#watts` field, and the `averageWatts`/`structuredIntensity` request-body fields
were all removed. Relative intensity for Entreno Manual is now derived exactly the way
`estimateRideDurationHours` already derives a route-mode ride's target watts —
`getRelativeIntensityFromLevel(intensityLevel)`, the chosen zone's %FTP (e.g. Fondo Z2 =
65% FTP) — multiplied against the athlete's real profile FTP elsewhere in the engine, not a
new formula. `POST /api/fueling/plan`'s quick-mode branch now sends a plain `intensity`
field (matching route/GPX mode's own field name, rather than the old `structuredIntensity`)
and requires it to be one of `VALID_INTENSITIES` — previously optional (a steady-state ride
could fall back to the watts-derived figure), it's mandatory now, since there's no other
source of intensity left. `getRelativeIntensity` (the raw-watts-based function) is
untouched and still exported/used elsewhere (Post-Ride Analysis, the Strava sync route) —
only this one caller stopped using it.

- **`quickValid`** (`components/fueling-planner.tsx`) changed from `quickDurationHours > 0
  && quickAverageWatts > 0` to `quickDurationHours > 0 && intensity !== ""` — duration and a
  real zone selection are now the only two gates for Entreno Manual's CTA, matching
  route/GPX mode's own `routeModeIncomplete` gating exactly (both a route/GPX *and* an
  intensity are required there too).
- **Paso 01's Entreno Manual layout** — the "Duración Estimada" (Horas/Minutos, unchanged
  from the earlier "Homologación de Estilos de Etiqueta" pass) and "Vatios Objetivo" fields
  used to share a `sm:grid-cols-2` row; with Vatios gone, Duración now stands alone as a
  single full-width block, directly above the shared `IntensityObjectiveSelect` — the same
  vertical sequence Ruta/GPX mode's own Paso 02 already uses (Intensidad Objetivo above
  Fecha y Hora).
- **Helper text updated** — the disabled-CTA hint under Entreno Manual changed from
  "Introduce una duración y unos vatios objetivo válidos..." to "Introduce una duración
  válida y selecciona una intensidad objetivo para poder calcular," matching what's
  actually required now.

### Reseteo automático del estado de cálculo

A calculated result is only ever valid for the exact inputs it was computed from — editing
any of them after calculating used to leave the old, now-stale result on screen with no
indication it no longer matched the current selection. A single `useEffect` in
`FuelingPlanner` now watches every input that can invalidate a result — `mode`,
`selectedRouteId`, `parsedGpx`, `quickDurationHours`, `gpxDurationHours`, `intensity`,
`departureLocal` (covers both the departure date *and* hour — `buildDepartureLocal`'s own
memoized output already combines `departureDayMode`/`departureCustomDate`/`departureHour`
into one string, so watching it alone covers all three underlying pieces without a longer,
redundant dependency list), and `isTargetEvent` — and calls `setResult(null)` the instant
any of them changes, which is all "hiding" the result panel needs: it's a plain `{result &&
(...)}` conditional, so clearing `result` unmounts the whole panel immediately and the CTA's
own pre-existing `disabled` gating re-enables itself the moment its own conditions are met
again (unchanged — this effect only clears `result`, it never touches `loading`/`error`/the
disabled logic itself).

- **`isInitialInputRender`** (a `useRef(true)`, flipped to `false` on the effect's first
  run) guards against a real race this effect could otherwise cause on mount: the
  pre-existing "Modo Cobertura Limitada" effect right above it also runs on mount and may
  call `setResult(cachedOfflineStrategy)` if the athlete opened the app offline — without
  this guard, the reset effect's own first invocation (every `useEffect` runs at least once
  on mount, even with a populated dependency array) would immediately wipe that just-loaded
  cached result back to `null` before the athlete ever saw it. The guard makes this effect a
  no-op on mount and only ever fire in response to a genuine subsequent *change*.
- **Deliberately not reset**: `bottleConfig`/`fuelingMode`/`pocketFood`/`customCarbsG` (Card
  2's own post-calculation adjustments) — editing these doesn't invalidate the currently
  *shown* result the way changing a route or duration does; the existing "Pulsa 'Calcular
  estrategia nutricional' (arriba) de nuevo..." hint already communicates that a pocket-food
  edit needs a fresh calculation to actually change the recipe, without forcing the athlete
  to lose the whole result panel just to adjust their food selection. This matches the
  prompt's own explicit trigger list, which names route/GPX/duration/intensity/departure-
  time/target-event specifically and not the post-calculation Card 2 adjusters.
- **"Desaparece suavemente" interpreted as an immediate, clean hide** — matching this app's
  existing plain-conditional-render convention everywhere else (no animation library exists
  in this codebase, and no other conditional panel in the app animates its own exit) — rather
  than introducing a new keep-mounted-during-fade-out architecture for this one panel. The
  functionally-verifiable requirement ("resultados... ocultarse... hasta volver a pulsar el
  botón") is satisfied either way; flagged transparently as a scope interpretation rather
  than silently deciding it without a note.

Verified via `npx tsc --noEmit`/`npm run lint`/`npm run build` (all clean) and a live
Playwright check (a temporary route rendering the real `FuelingPlanner` with 2 mocked
Strava routes and a mocked `/api/fueling/plan` response, with the actual outgoing request
body captured via `page.route`) — confirmed Entreno Manual renders no `#watts` field and no
"Vatios objetivo" text anywhere, the captured quick-mode request body carries `intensity:
"tempo"` with no `averageWatts`/`structuredIntensity` field at all, and — across 4 separate
scenarios (changing intensity, changing duration, switching tabs, changing the selected
route, toggling the Ruta objetivo checkbox) — the result panel disappears immediately after
each edit and reappears correctly after clicking "Calcular estrategia nutricional" again.

### Tarjeta 03 cleanup — Balance Neto moved out, weather duplication removed

Tarjeta 1 (`03 · Metabolismo y objetivos calculados`) used to also carry the Balance Neto
sub-block (Gasto Estimado de HC / Ingesta Planificada / Déficit Neto al Finalizar) — a
burn-vs-intake comparison that genuinely doesn't make sense yet at this point in the flow,
since the athlete hasn't configured their bottle role or pocket-food selection (Card 04)
at all. Removed from Card 03 and relocated to the *end* of Card 04 (`04 · Configuración de
bidones y comida en bolsillo`), after the food-stepper list and its "Pulsa Calcular..."
hint — the natural place for a "here's where you land" summary once bottle config,
fueling strategy, and pocket-food selection are all already visible above it. Nothing
about the block's own content/figures changed, only its card.

- **Duplicated Hidratación/Sodio figures removed from `WeatherImpactCard`** — the
  component used to end with its own "Hidratación objetivo: X ml/h · Sodio objetivo: Y
  mg/h" caption line, restating exactly what Card 03's own 2x2 grid cells (Hidratación/
  Sodio, both already showing the same per-hour rate) already show once. `fluidLossMlPerHour`/
  `sodiumMgPerHour` were dropped from the component's own props entirely, not just hidden —
  there was no other reason for it to receive them.
- **"Impacto Térmico" copy now reflects what was actually sampled, not a vague catch-all.**
  `result.weather.multiPointSample` is `true` precisely when a real geographic 3-point
  sample (start/summit/finish) succeeded — only possible in route/GPX mode with a genuine
  elevation profile. The summary text now reads "Previsión real Open-Meteo · inicio /
  punto más alto / llegada" in that case, or "Previsión real Open-Meteo · inicio / mitad de
  ruta / llegada" for Entreno Manual (no coordinates at all) or a flat/no-peak route, both of
  which fall back to the same single-location forecast averaged across the ride's own
  departure-to-arrival time window — "mitad de ruta" describes that time-averaged reading in
  plain language, it doesn't imply a second physical location is actually sampled. The
  `planning_default`/`seasonal_average` branches (a generic estimate or historical average,
  neither a real live forecast) are untouched — this app's "never claim real data when it's
  actually a fallback" convention means neither of those get the new "Previsión real
  Open-Meteo" wording at all, regardless of `multiPointSample`.
- **Carbohidratos tooltip — verified already correctly unclipped**, `z-50` confirmed live
  (no change was actually needed: `FuelingContextTooltips` already carries `z-50` from the
  earlier "Unificación Global de Iconos de Tooltip" pass, and Card 03's own container has no
  `overflow-hidden` ancestor to clip it). Its grid cell gained an explicit `relative
  overflow-visible` anyway, matching the prompt's own literal example, as a defensive,
  self-documenting guarantee rather than relying on the *absence* of a clipping ancestor
  elsewhere in the tree.

Verified via `npx tsc --noEmit`/`npm run lint`/`npm run build` (all clean) and a live
Playwright check (two scenarios — a route-mode calculation with `multiPointSample: true`,
and an Entreno Manual calculation with `multiPointSample: false`) — confirmed the weather
summary reads "punto más alto" for the mountain-route case and "mitad de ruta" for Entreno
Manual, "Gasto estimado de HC" appears exactly once in the DOM and sits inside Card 04 (not
Card 03), no "Hidratación objetivo:"/"Sodio objetivo:" duplicate text remains anywhere, and
the Carbohidratos tooltip renders fully visible and unclipped on hover.

### W/kg micro-graduated scale bar (01 · Métricas físicas y equipamiento)

The plain-text W/kg readout (see "W/kg performance readout" above — "3.57 W/kg · Avanzado,"
no box, added in an earlier pass) gained a thin visual scale bar directly beneath it, so the
athlete's own position within the Coggan-style power-profile spectrum reads at a glance
instead of only as text.

- **`getWkgBarPercentage(wkg)`** (`lib/metabolic-engine.ts`, pure, exported) — clamps the
  athlete's live `wkg` value into a 0-100 position across a fixed 1.5-5.5 W/kg range
  (`((wkg - 1.5) / (5.5 - 1.5)) * 100`, clamped both ends so a genuine outlier — a very
  light athlete with a low FTP, or a world-tour-caliber reading — still renders a sane
  in-bounds marker instead of overflowing the bar). Deliberately doesn't duplicate
  `getWkgCategory`'s own label thresholds — both functions read the same 1.5-5.5-ish
  spectrum, but only the position math was missing, so this is the one new function added;
  the label itself (`wkgCategory.label`) is still `getWkgCategory`'s output, unchanged.
- **The bar itself** (`components/physiological-profile-form.tsx`) — a
  `flex h-1.5 w-full divide-x divide-white overflow-hidden rounded-full bg-zinc-100`
  five-segment track (`Principiante`/`Recreacional`/`Intermedio`/`Avanzado`/`Elite-Pro`,
  ascending `zinc-200/60` → `zinc-500/80` opacity — a gradient read through shade alone,
  no color), with a small `absolute` dark `rounded-sm` notch (`bg-zinc-900`, `-ml-1` so its
  own width centers on the computed position) positioned via inline `style={{ left:
  `${wkgBarPercentage}%` }}` — `transition-all duration-300` so it animates smoothly as
  Peso/FTP change, rather than snapping. Sits inside the same `wkgCategory && (...)` guard
  as the text readout (both derive from the same `wkg > 0` check), so it's simply absent
  until both Peso and FTP are valid — never a bar sitting at a meaningless 0% position for
  an athlete who hasn't finished typing yet.
- **Deliberately not `rounded-sm`** like every button/card/field/select/tab/stepper in the
  app's global radius scale (see "Radio de Bordes Pequeño Global" under "PNS premium
  redesign" below) — a progress-bar track was already one of that pass's own named
  exceptions (alongside the radio-indicator dot, spinner rings, and floating glass chips),
  so `rounded-full` here is consistent with that carve-out, not a regression of it.
- **Purely reactive, zero persistence** — recalculated on every render directly from the
  same controlled `weight`/`ftp` state the text readout already uses; no new field, no new
  network round-trip, matching this component's existing "never its own input, never
  persisted" convention for the W/kg figure itself.

Verified via `npx tsc --noEmit`/`npm run lint`/`npm run build` (all clean) and a live
Playwright check (a temporary route rendering the real `PhysiologicalProfileForm` with a
mocked profile) — confirmed the initial 250W/70kg reading renders "3.57 W/kg · Avanzado"
with the notch at the correct proportional position; raising FTP to 400 (5.71 W/kg, past
the scale's own upper bound) clamps the notch to exactly `left: 100%`; setting FTP to 140
(exactly 2.0 W/kg, the Recreacional threshold) renders the notch at `left: 12.5%` and the
label "Recreacional"; and clearing the weight field removes the bar (and the text readout)
entirely rather than rendering a broken position. Also confirmed correct rendering with no
overflow at a 390px mobile viewport.

### Route dynamic rendering

Both `app/(app)/page.tsx` and `app/(app)/perfil/page.tsx` export `dynamic = "force-dynamic"` because
each reads live Supabase data — without it Next prerenders the route at build time and
the figures would be frozen from whenever `next build` last ran.

### Granular loading states (no giant skeleton blocks)

A Suspense fallback or a client-side `loading` flag that swaps an entire card for a
generic, unrelated set of gray bars reads as "a different loading card," not "the same UI,
filling in" — the PNS-style convention this app follows instead is: real static chrome
(card titles, field labels, button text) renders immediately since none of it actually
depends on the data in flight, and only the genuinely data-dependent *values* get a muted,
pulsing placeholder, in roughly the same position/size the real value will occupy.

- **`components/fueling-planner.tsx`'s "Ruta" `<select>`** — while `refreshingRoutes` is
  true (the "Recargar rutas desde Strava" button, see "Strava saved-routes cache" above),
  the select itself never unmounts or changes shape: it's simply `disabled`, showing one
  muted option ("Sincronizando rutas de Strava...", `text-neutral-400`) instead of the real
  route list, with a micro-spinner (`size-3.5 border-2 border-neutral-300
  border-t-neutral-800 rounded-full animate-spin`) absolutely positioned at `right-8` —
  just to the left of the select's own native dropdown arrow, not on top of it (verified
  live via Playwright screenshot at 500px width: both render side by side with no overlap).
- **`FuelingPlannerSkeleton`** (`app/(app)/page.tsx`) mirrors the real form directly: the
  real `CardTitle`/`CardDescription` text, a muted 3-pill mode-toggle shape, a "Ruta" field
  reusing the *exact* same select+spinner treatment above, "Intensidad objetivo" and "Fecha
  y hora de salida" field shapes, and a translucent CTA button with its real label — so
  even on a cold cache, the fallback is indistinguishable in structure from the form a
  moment later. For a stretch of this project's history this had moved to an *inner*
  Suspense boundary (see the now-removed "two-stage profile gate," under "Mandatory profile
  completion" below) since `FuelingPlannerSection` could still resolve into a differently-
  shaped "sin perfil" card back then — now that the mandatory-profile-completion navigation
  guard makes a complete profile a guaranteed invariant by the time this page ever renders,
  there's only one possible outcome left, so this is back to being the single, direct
  `<Suspense>` fallback for the whole section.
- **`PostRideAnalysisSkeleton`** used to similarly mirror `PostRideAnalysis`'s own real
  `CardTitle`/`CardDescription` plus a muted "Analizando tu última salida…" status line.
  Deleted outright once `PostRideAnalysisSection` could resolve into either the real
  `PostRideAnalysis` or a very differently-shaped "sin perfil" card (`ProfileRequiredCard`,
  itself since deleted — see "Mandatory profile completion" below), which made a fallback
  mirroring only one of those two outcomes unsafe to show while the profile check was still
  in flight. `PostRideAnalysisSection` no longer has that branch at all anymore, but the
  generic `DashboardSectionSkeleton` it settled on remains its fallback — there was no need
  to reintroduce a detailed one once the branch went away.
- **`components/post-ride-analysis.tsx`'s own `loading && !result` branch** — used to be a
  single plain text line ("Analizando tu última salida…") with nothing else on screen.
  Replaced with the real telemetry card's shape rendered early: the same bordered/
  `bg-surface` container, a status pill with a spinner, a muted map-shaped rectangle, and
  the five real stat labels (Distancia, Tiempo en movimiento, Potencia, Gasto energético,
  Frecuencia cardíaca) each showing a pulsing `--` instead of nothing — the labels are
  static and can render immediately; only the numbers genuinely don't exist yet.
- **`PhysiologicalProfileSkeleton`** (`app/(app)/perfil/page.tsx`) used to be 3 identical
  generic 4-field grids with no real label text. Rebuilt to show the real three numbered
  cards with their actual static labels (Peso (kg), FTP (W), Soportes de bidón, Capacidad
  por bidón, Fenotipo metabólico, Tasa de sudoración, Adaptación digestiva) — only the
  input/selector *values* (which depend on `getAthleteProfile()`) are muted placeholders
  ("Cargando…" text or a pulsing empty box), never the labels around them.

All of the above were verified visually via a temporary, unauthenticated route rendering
these components/skeletons directly (same Playwright-screenshot pattern used elsewhere in
this codebase — added to `proxy.ts`'s `PUBLIC_PATH_PREFIXES` and `useState(true)`-forced
for the one client state that needed to be pinned open, both reverted before committing).

### Mobile-first layout

**Flat mobile cards (no "muñeca rusa"/Russian-doll nesting).** The Fueling Planner's and
Post-Ride Analysis's own root `<Card>` used to render as a real bordered/shadowed/padded box
at every breakpoint — on mobile, that meant the card's own border and padding sat *inside*
`DashboardShell`'s `<main>` padding, doubling up into a visibly boxed-in, narrower content
area exactly when screen width is already scarcest. **`flatMobileCardClass`**
(`lib/ui-classes.ts`) strips the card down to nothing on mobile — `rounded-none border-0
bg-transparent shadow-none` — and restores the real card look at `sm:` and up (`sm:rounded-xl
sm:bg-card sm:shadow-sm` — no border, not even at `sm:`, since a later PNS pass dropped it
app-wide in favor of background-only contrast against the porcelain canvas; see "PNS premium
redesign" above), applied as the
`className` on both components' root `<Card>` (`cn()`'s "later utility wins" merge lets this
override `Card`'s own built-in `border`/`bg-card`/`rounded-sm` defaults). The trickier part
is padding: `Card`/`CardHeader`/`CardContent` all key their own `py-`/`px-` off one shared
`--card-spacing` CSS custom property that `Card` itself declares and its children inherit —
so `flatMobileCardClass` only needs to override that *one* variable
(`[--card-spacing:0px] sm:[--card-spacing:--spacing(6)]`) on the outer `Card`, and every
descendant's padding zeroes out on mobile and returns to `24px` at `sm:` for free, with no
separate override needed on `CardHeader`/`CardContent` themselves. Scoped deliberately to
just the outer card — the many smaller nested boxes *inside* the planner (the departure-
date card, the weather stat block, the Hero result card, the accordions) were left as-is;
flattening every one of those into divider-separated sections would be a much larger
redesign than "remove the outer card," and wasn't part of this pass.

**Pure white cards, zero borders — the full "PNS card system" pass.** A later request
asked for every card app-wide to replicate Pas Normal Studios' own hierarchy explicitly:
pure white (`#FFFFFF`) cards floating with **no border at all**, separated from the warm
porcelain canvas purely through a soft diffuse shadow, and nested sub-blocks (breakdown
rows, stat groups) using the porcelain tone itself rather than a border to read as
"inside" their parent card. This landed as one shared token plus a handful of scoped
call-site changes:

- **`cardShadowClass`** (`lib/ui-classes.ts`) — `shadow-[0_2px_12px_rgba(0,0,0,0.03)]`,
  the one shadow value every card in the app now shares, deliberately not Tailwind's
  generic `shadow-sm` (flatter, harder-edged by comparison). Every place a card used to
  pair `border-neutral-200`/`border-zinc-200` with `shadow-sm` now pairs zero border with
  this token instead.
- **The base `Card` primitive** (`components/ui/card.tsx`) — its long-standing
  `border border-neutral-200` was removed outright and `cardShadowClass` added directly to
  its own default class string. This is a genuine hand-edit to a shadcn-managed primitive
  (normally left alone per this project's convention), justified because every plain
  `<Card>` in the app (all 3 numbered cards on `/perfil`, all 6 on `/estadisticas`, all 5 on
  `/historial`, and the Dashboard's own "sin perfil" fallback card) needed the exact same
  change — patching each call site individually would have meant 15+ near-identical edits
  instead of one shared-token fix, and no call site currently passes its own conflicting
  `border-*`/`shadow-*` override that this could have clobbered (verified via a full grep
  before making the change). `bg-card` itself needed no change — it was already pure white
  (`#ffffff`) per this app's existing design tokens.
- **`flatMobileCardClass`** (`lib/ui-classes.ts`) — its `sm:shadow-sm` (a plain Tailwind
  default) switched to `sm:${cardShadowClass}` via template-literal interpolation, so the
  Fueling Planner's and Post-Ride Analysis's own root cards (already borderless at every
  breakpoint, see "Flat mobile cards" above) now share the exact same shadow value as
  every other card in the app instead of a slightly different generic one.
- **"Comida en bolsillo" (`components/fueling-planner.tsx`)** — the unified white card
  (see the section by that name above) picked up `cardShadowClass` in place of its own
  `shadow-sm`. Its one internal "desglose interno" — the objetivo/en bolsillo/déficit
  breakdown + progress bar, previously floating bare on the white card with no background
  of its own — gained the same `bg-[#F8F7F5] rounded-lg p-3` treatment the empty-state
  placeholder in that same slot already used, so both states of this slot (calculated vs.
  not-yet-calculated) now read as one consistent porcelain-tinted sub-block rather than
  the placeholder alone standing out as boxed while the real result floated free.
- **Post-Ride Analysis's telemetry summary card** (`components/post-ride-analysis.tsx`) —
  the "Ruta sincronizada desde Strava" card (and its two alternate-state siblings rendered
  into the exact same slot: the loading skeleton and the `needsRpe` "¿cómo sentiste el
  esfuerzo?" prompt) all switched from `border border-neutral-200 bg-surface` to
  `bg-white` + `cardShadowClass` — all three needed the same treatment since a loading
  fallback must mirror the real eventual shape (this app's own established "granular
  loading states" convention) and the RPE prompt occupies that identical visual slot.
- **Balance neto de recuperación** — the outer wrapper around the three
  Carbohidratos/Líquido/Sodio rows switched from `border border-neutral-200` to
  `rounded-lg bg-[#F8F7F5]` (no border) — the porcelain tone marking it as a sub-block
  nested inside the (borderless, white-at-`sm:`) parent card. Each individual
  `BalanceNetoRow` already used `bg-surface` with no border of its own (unchanged by this
  pass) — a subtly darker shade one layer inside the new porcelain wrapper, giving a clear
  three-tier hierarchy: porcelain page → white card → porcelain sub-block → surface row.
- **Fase 1 / Fase 2, and their sibling Grasas límite / Rehidratación stat cards** — all
  four switched from `border border-neutral-200` to `bg-white` + `cardShadowClass` (Grasas
  límite/Rehidratación weren't named explicitly in the request, but share the exact same
  `border border-neutral-200 px-3 py-2.5` shape immediately below Fase 1/2 in the same
  "Objetivo de recuperación post-ruta" block — leaving them bordered would have read as a
  half-migrated inconsistency in the same visual group, not a deliberate choice).
- **Deliberately left untouched**: form-field-shaped containers that happen to share the
  `border border-neutral-200`/`rounded-lg` look but aren't "cards" in this system's sense —
  the Consumo Real input rows (Carbohidratos/Agua/Sodio), the "Cambiar salida" `<select>`
  wrapper, the DIY-recipe/reload-strategy/carb-loading `<details>` accordions, the Net Carb
  Deficit 3-column stat row, warning/status banners (`bg-status-warning/10`), and the
  pocket-food stepper's own list-row borders — all pre-existing, deliberately-scoped
  decisions from earlier passes (see "Result panel visual hierarchy" and "Hybrid
  nutrition" above) that this request didn't ask to reopen.
- Verified live via a temporary unauthenticated route rendering a plain `<Card>`, the
  Fueling Planner (with a mocked Strava route), and Post-Ride Analysis (with a mocked
  `/api/post-ride/analysis` response covering the Balance Neto and Fase 1/2 blocks) side by
  side — confirmed every card renders pure white with zero visible border and a clearly
  perceptible soft shadow against the porcelain canvas at both mobile (390px) and desktop
  (1280px), and that the porcelain sub-blocks (Comida en bolsillo's breakdown, Balance
  Neto's wrapper) read as visually nested inside their white parent cards rather than
  floating independently.

**A follow-up pass reversed the shadow half of this system entirely** — a request for
"100% flat" layering with **zero shadows anywhere**, differentiating cards from the
porcelain canvas through background contrast alone, no elevation cue at all. `cardShadowClass`
was deleted outright from `lib/ui-classes.ts` (not repurposed to `"shadow-none"` — every
call site either dropped the shadow class entirely or added an explicit `shadow-none`,
matching this codebase's "no vestigial constants" convention) and every one of its call
sites updated:

- **The base `Card` primitive** — `cardShadowClass` removed, `shadow-none` added
  explicitly, and its corner radius stepped up from `rounded-sm` to `rounded-lg`
  (`CardHeader`/`CardFooter`'s own `rounded-t-sm`/`rounded-b-sm` and the image-slot corner
  classes updated to match) — a direct, explicit reversal of this app's own long-standing
  "`rounded-sm` reserved for dense data cards" convention, per this request's literal
  `bg-white border-0 shadow-none rounded-lg` spec for every container card. `--card-spacing`
  (governing `Card`'s own `py-`/`CardHeader`/`CardContent`'s `px-`) was bumped from a flat
  `--spacing(4)` to a responsive `--spacing(5)` / `sm:--spacing(6)` to match the request's
  literal `p-5 sm:p-6` padding figure — the `data-size=sm` compact-card variant's own
  `--spacing(3)` override is untouched, a separate, intentionally-smaller card size
  unrelated to this breakpoint-driven default.
- **`flatMobileCardClass`** — `sm:${cardShadowClass}` reverted to a plain `sm:shadow-none`.
- **"Comida en bolsillo"** (`components/fueling-planner.tsx`) — the outer card dropped
  `cardShadowClass` for an explicit `shadow-none` (padding bumped to `p-5 sm:p-6` to match).
  Its internal objetivo/cubierto/déficit breakdown and the empty-state placeholder both
  moved from `rounded-lg p-3` to `rounded-md p-4` — the literal "sub-bloques anidados"
  spec this request gave (`bg-[#F8F7F5] border-0 shadow-none rounded-md p-4`), distinct
  from the `rounded-lg` a top-level card gets.
- **The Ruta/map widget and the dark "Dosis casera por bidón" Hero card** (both in
  `components/fueling-planner.tsx`) — their own `shadow-sm` also removed (`shadow-none`),
  even though neither was named explicitly in either the original card-system request or
  this one; both are "contenedores principales" under this request's broad "todas las
  tarjetas... y contenedores principales" wording, so leaving their shadows in place would
  have been an inconsistent half-migration. Their own borders/background colors (the Ruta
  widget's `border-zinc-200/60 bg-surface`, the Hero card's `bg-[#343334]`) were untouched —
  this pass is scoped to shadows only, borders were the *previous* pass's concern.
- **Post-Ride Analysis's telemetry summary card** (and its loading/`needsRpe` siblings) —
  `cardShadowClass` dropped for an explicit `shadow-none`, kept as `bg-white` (still a
  top-level "contenedor principal" reached directly inside the root Card, not a nested
  breakdown).
- **Balance neto de recuperación, and now also Fase 1 / Fase 2 / Grasas límite /
  Rehidratación** — all five converted from `bg-white`/`bg-[#F8F7F5]` + shadow to the
  literal sub-block spec, `rounded-md bg-[#F8F7F5] p-4 shadow-none`. Fase 1/2 and Grasas/
  Rehidratación specifically had to move from white to porcelain here, not just lose their
  shadow: they're nested *inside* the same (white-at-`sm:`) root Card as the telemetry
  card, and removing their shadow while keeping them `bg-white` would have made them
  visually disappear into their own white parent with zero cue that they're a distinct
  block — the flat-UI hierarchy this request asks for (page → card → sub-block, each a
  visually distinct tone) only holds together if a nested block actually changes color,
  since shadow and border — the two devices that used to carry that distinction — are
  both gone now. `BalanceNetoRow`'s own `bg-surface` (one shade darker than the porcelain
  wrapper around it) was left untouched, preserving the three-tier porcelain → surface
  hierarchy inside the Balance Neto block specifically.
- **Deliberately left untouched**: every shadow that isn't a "card," reusing the same
  scoping judgment as the previous pass's border sweep — `primaryButtonClass`/
  `secondaryButtonClass`'s own `shadow-sm` (buttons, not cards), form-field shadows (the
  Consumo Real inputs, the custom-carbs input), `components/toast.tsx`'s `shadow-xl`
  (a floating notification, not a card), `components/fueling-context-tooltip.tsx`/
  `components/info-tooltip.tsx`'s `shadow-md` (floating popovers), `components/
  route-map-preview.tsx`'s zoom-control/badge `shadow-sm` (translucent glass chips floating
  over map tiles — a distinct, extensively-tuned design language of their own, not the
  page's card system), and `components/dashboard-shell.tsx`'s sticky-header shadow (chrome/
  navigation, and explicitly *intensified* at the user's own request in the immediately
  prior pass — reopening that here would have directly contradicted a just-completed,
  explicit instruction).
- Verified live via the same temporary-route/Playwright pattern as the original card-system
  pass — confirmed every card (the base `Card` primitive, Comida en bolsillo, the Post-Ride
  telemetry card, Balance Neto, Fase 1/2/Grasas/Rehidratación) renders with zero visible
  shadow and zero border at both mobile and desktop widths, and that the porcelain
  sub-blocks remain legibly distinct from their white parents through background contrast
  alone now that shadow is gone.

**A final refinement pass corrected the exact radius/padding figures** once a follow-up
message re-confirmed the shadow/border removal (already correct from the pass above — the
message described the state from *before* that pass, not a regression) but gave a more
precise literal spec: **main "tarjeta principal" cards** — `bg-white border-0 shadow-none
rounded-xl p-5` — and **nested "sub-bloques anidados"** — `bg-[#F8F7F5] border-0
shadow-none rounded-lg p-4`. Both radii stepped up one notch from the prior pass
(`rounded-lg` → `rounded-xl` for main cards, `rounded-md` → `rounded-lg` for sub-blocks),
and every main card's padding flattened to a plain `p-5` (dropping the earlier `sm:p-6`
responsive step, and — on the base `Card` primitive's own `--card-spacing` — dropping its
`sm:--spacing(6)` override entirely in favor of one flat `--spacing(5)` at every
breakpoint):

- **Base `Card` primitive** — `rounded-lg` → `rounded-xl` (`CardHeader`/`CardFooter`/
  image-slot corners updated to match), `--card-spacing` simplified to a flat
  `[--card-spacing:--spacing(5)]` (no `sm:` bump).
- **`flatMobileCardClass`** — `sm:rounded-lg` → `sm:rounded-xl`, `sm:[--card-spacing:
  --spacing(6)]` → `sm:[--card-spacing:--spacing(5)]`, so the Fueling Planner's/Post-Ride
  Analysis's own flattened root cards match the base primitive's radius and padding
  exactly again.
- **"Comida en bolsillo"** (`components/fueling-planner.tsx`) — outer card `rounded-lg` →
  `rounded-xl`, `p-5 sm:p-6` → flat `p-5`; its own internal objetivo/cubierto/déficit
  breakdown and empty-state placeholder both `rounded-md` → `rounded-lg` (still `p-4`,
  already matching the sub-block spec).
- **Post-Ride Analysis's telemetry summary card** (and its loading/`needsRpe` siblings) —
  `rounded-lg` → `rounded-xl` (still `bg-white px-4 py-3 shadow-none`, unchanged
  otherwise).
- **Balance neto de recuperación, Fase 1, Fase 2, Grasas límite, Rehidratación** — all
  five `rounded-md` → `rounded-lg` (still `bg-[#F8F7F5] p-4 shadow-none`).
- **Left as-is, deliberately**: the Ruta/map widget (`border-zinc-200/60 bg-surface`,
  still `rounded-lg`) and the dark "Dosis casera por bidón" Hero card (`bg-[#343334]`,
  already `rounded-xl`) — neither is categorized as a "tarjeta principal" (white) or
  "sub-bloque" (porcelain) in this system, so neither was in scope for this radius pass.
- Re-verified with `npm run build` (clean) plus the same Playwright check, confirming the
  new `rounded-xl`/`rounded-lg` corners render correctly at both radii and that nothing
  regressed on the shadow/border front already fixed by the prior pass.

The multi-column grids across the Dashboard and Perfil pages (profile form, planner
inputs, result-panel stat rows, the Net Carb Deficit breakdown) stack to a single column
at the default breakpoint and only go multi-column at `sm:` — mobile is the default
layout, not an afterthought squeezed into a desktop grid. The `app/(app)/page.tsx` header
(greeting/title + Strava button) keeps both on one row (`justify-between`) with the
greeting/title in their own `min-w-0` truncating column — an earlier `flex-col`-wrapping
version let a long label clip the greeting text on a narrow phone; truncating each side
independently instead of wrapping the whole row fixed that. The Sync button itself
(`components/sync-button.tsx`) has since shrunk to one compact style at every breakpoint —
a single "Sincronizar" label, no separate mobile/desktop text variants — small enough now
that the old responsive two-label split (a short mobile-only label vs. a longer desktop
one) was no longer needed to avoid clipping. It now renders through the shared
`secondaryButtonClass` (see "Code style" below) rather than its own one-off
`h-8 border-neutral-300/80 bg-white` treatment, which also carried a hardcoded
Strava-orange (`#FC4C02`) `RefreshCw` icon — restyled to this app's own `--surface`/
`--terracotta` palette, with the icon simply inheriting the button's own text color
instead of a hardcoded brand color unrelated to Strava-specific branding requirements
(unlike the CTA button on `/login`, this Dashboard-internal button has no Strava-branding
obligation to keep its icon orange — see "Strava API compliance" below). The planner's
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

**Bottom padding, corrected.** `components/dashboard-shell.tsx`'s shared `<main>` — used by
every interior route (Dashboard, `/perfil`, `/estadisticas`, `/historial`) — went through a
misdiagnosis: an iOS Safari floating-bottom-bar overlap was blamed on insufficient bottom
padding and pushed from `pb-24` up to `pb-28`/`pb-32` across a couple of passes, which just
left a large empty "desert" at the bottom of every page instead. The real overlap was
Safari's floating chrome *at the top* of the viewport (its own well-known behavior when at
the very top of a scrolled page), unrelated to `<main>`'s bottom padding at all — corrected
back down to a plain `pb-12 sm:pb-16`, no special extra safe-area allowance.

**iOS status-bar fusion + tighter mobile lateral padding + a sobered-down radius scale.**
Three related PNS-editorial requests, applied together:

- **`viewport.themeColor`** (`app/layout.tsx`) set to `#F8F7F5` (this app's own porcelain
  `--background` token's literal value) plus explicit `width: "device-width"`/
  `initialScale: 1` — this is what actually gets iOS Safari's status bar (clock/battery) to
  render in the page's own tone instead of a mismatched default, the same "fuse with the
  page" effect PNS's own site uses. `<html>` gained an explicit `bg-background` alongside
  `<body>`'s pre-existing one, so there's no unstyled flash at either level.
- **The mobile sticky header** (`components/dashboard-shell.tsx`) dropped its
  `border-b border-neutral-200/80` and opaque `bg-white/90` entirely, replaced by
  `bg-background/80` (the same porcelain token, translucent, not literal white) plus a soft
  diffuse shadow that only reads once content has actually scrolled underneath it, rather
  than a permanent hard rule always visible even at the very top of the page. This is what
  makes the header read as "the same surface as the page, just floating," matching the iOS
  status-bar fusion above rather than fighting it with a visibly different white bar
  directly beneath a porcelain status bar. The shadow itself started at a barely-perceptible
  `shadow-[0_2px_12px_rgba(0,0,0,0.03)]` and was later intensified — a follow-up request
  found it too subtle to actually read as "floating" — to a more pronounced, wider-spread
  `shadow-[0_4px_20px_rgba(0,0,0,0.06)]`, matching Pas Normal Studios' own floating-header
  depth. Still zero `border-b` at either version — only the shadow's spread/opacity
  changed, not the underlying "no rigid line" approach.

  **A later pass reversed the "porcelain-on-porcelain" half of this design outright** — a
  request for the header to instead read as PNS's own opaque white bar, distinct from the
  page rather than blended with it. The header's `bg-background/80` (translucent porcelain)
  became a plain opaque `bg-white`, `backdrop-blur-md` was dropped along with it (nothing
  shows through an opaque fill for a blur to soften), and the shadow deepened a second time,
  from `shadow-[0_4px_20px_rgba(0,0,0,0.06)]` to `shadow-[0_6px_20px_rgba(0,0,0,0.07)]` —
  wider spread, slightly darker. `viewport.themeColor` (`app/layout.tsx`) followed the same
  reversal, from the porcelain `#F8F7F5` to pure `#FFFFFF`, so iOS Safari's status bar keeps
  matching whatever color actually sits at the very top of the viewport (the header itself,
  the topmost element on every interior route) — still zero `border-b` either way, the
  header has never used a hard divider line, only ever a shadow, regardless of which
  background tone it's carried. `<html>`/`<body>` themselves keep their own `bg-background`
  (porcelain) unchanged — this reversal is scoped to the header bar and the status-bar color
  it dictates, not the page canvas underneath it, which every card in the app still floats
  over as porcelain.

  **A further pass replaced this header's own approximated shadow with Pas Normal Studios'
  real `box-shadow` value verbatim.** PNS's own site uses a two-layer stack —
  `box-shadow: 0 0 #0000, 0 0 #0000, 0 4px 6px -1px #0000001a, 0 2px 4px -2px #0000001a`
  (the first two `0 0 #0000` entries are inert — Tailwind's own multi-layer shadow
  utilities always emit a 4-value stack with unused layers zeroed out like this; only the
  last two entries are visually real). Translated directly to Tailwind's arbitrary-value
  syntax: `shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]` — this
  replaced the header's own prior *approximation* of that same PNS look
  (`shadow-[0_6px_20px_rgba(0,0,0,0.07)]`, a single-layer, wider/softer guess) with PNS's
  literal recipe. **`viewport.themeColor` reverted from `#FFFFFF` back to the porcelain
  `#F8F7F5`** in the same pass — a deliberate, explicit instruction: the header itself
  stays pure white (its own shadow, not a matching status-bar tone, is what separates it
  from the page), but iOS Safari's status bar now fuses with the porcelain page canvas
  beneath the header instead of the header's own white — the two are intentionally
  different tones now, not synced the way they were in the immediately prior pass.
- **Lateral padding tightened**: `<main>`'s own `px-6 sm:px-8` → `px-4 sm:px-6 md:px-8` (16px
  on a phone, was 24px) — PNS's own mobile layout sits much closer to the viewport edge than
  this app previously did, and the header's own horizontal padding was updated to match
  (`px-4 sm:px-6`, both the brand mark's left edge and the hamburger's right edge now line up
  with the card edges in the content below, rather than sitting inset from them). `/login`'s
  own outer padding (`p-3 sm:p-4`) was deliberately left untouched — at 12px it was already
  tighter than the 16px this pass introduced elsewhere, and that page's spacing had already
  been tuned carefully across several earlier passes specifically to fit one mobile screen
  with zero scroll; reopening it wasn't needed and risked undoing that work.
- **Border-radius sobered app-wide** — every shared button/field/card token in
  `lib/ui-classes.ts` stepped down one notch: `primaryButtonClass`/`secondaryButtonClass`
  `rounded-lg` → `rounded-md`; `fieldClass`/`selectableFieldClass`/`selectableFieldDarkClass`
  `rounded-xl` → `rounded-md`; `flatMobileCardClass`'s `sm:rounded-xl` → `sm:rounded-lg`.
  Same step-down applied at each of the remaining one-off usages: `segmentedButtonClass`
  (`components/fueling-planner.tsx`) `rounded-lg` → `rounded-md`; the dark Obsidian widget's
  own `rounded-2xl` → `rounded-lg`; the login hero's mobile card `rounded-3xl` → `rounded-lg`.
  A more "technical/industrial" corner radius throughout, rather than the softer, rounder
  geometry these all carried before.
- **The "Calcula tu estrategia..." placeholder and the "Comida en bolsillo" accordion,
  unified into one card.** These used to be two independently bordered boxes stacked
  directly on top of each other (`border border-neutral-200 bg-surface` for the objetivo/
  cubierto/déficit summary or its placeholder text, `rounded-lg border border-neutral-200`
  for the accordion) — read as two unrelated concepts rather than one continuous "your
  pocket-food strategy" flow. Now a single frameless `rounded-lg bg-white shadow-sm p-5`
  card holds both, separated purely by `space-y-4` — no border on the outer card, no border
  on the accordion, no border-t between the accordion's `<summary>` and its content. The
  empty-state placeholder text ("Calcula tu estrategia...") is its own small internal
  `bg-[#F8F7F5] rounded-lg` banner (the canvas tone itself, not a new gray) rather than a
  bordered box, so it still reads as *inside* the white card rather than a box of its own.
  Once a result exists, the same slot swaps to the real objetivo/cubierto/déficit progress
  bar — this card's content is genuinely stateful, not just a static subtitle, which is why
  it couldn't be simplified to a plain caption under the "Comida en bolsillo" title.

**Normalized header-to-first-card spacing (`gap-6` everywhere, Dashboard tighter on
mobile).** The outer page wrapper governing the gap between each route's `<header>` and
its first content block had drifted to three different values across four routes that all
use the exact same visual pattern: `/perfil` and `/estadisticas` were `gap-10` (40px), the
Dashboard was `gap-4` (16px), and only `/historial` already matched the intended `gap-6`
(24px). All four were normalized to `gap-6`. The Dashboard's own wrapper later gained a
mobile-specific exception, `gap-4 sm:gap-6` (plus its `TabsContent` inner padding, `pt-4
sm:pt-6`) — tightened specifically to fit more of the Fueling Planner/Post-Ride content
above the fold on a phone, at the cost of no longer matching the other three routes'
spacing exactly on mobile only; `sm:` and up still use the shared `gap-6`. Note this outer
gap is deliberately a *different* concern from the inner `gap-6` that already existed
inside `/perfil` and `/estadisticas` (which spaces their own multiple sibling `Card`s apart
from each other) — both happen to be the same 24px value at `sm:`, but they're two
independent spacings that were never in conflict, only the outer one needed changing.

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
exclusive on the same edge of the screen. This was written when the drawer opened from the
left, the same edge iOS Safari's own back-swipe lives on; now that the drawer opens from the
right instead (see "Mobile drawer now opens from the right" above), that specific conflict
no longer applies to *this* edge — still tap/click-only, though, since no gesture layer was
ever added back.

**Mobile dashboard priority reorder.** A brand-new athlete's first useful action is
calculating a fueling strategy, not reading a week of stats they don't have yet — so on
small screens `app/(app)/page.tsx` renders the Tabs block (Pre-Ride's Fueling Planner is its
default tab) *before* the Weekly Performance Panel, reverting to the original
stats-then-tabs order at `sm:` and up. Both blocks are wrapped in their own `div` (`order-2
sm:order-0` on the Weekly panel's wrapper, `order-1 sm:order-0` on the Tabs wrapper) inside
the page's outer `flex flex-col` container — plain CSS `order` on two siblings, not a DOM
restructure, so neither component needed to change and the Tabs' internal Pre-Ride/Post-Ride
behavior is untouched.

**Auto-scroll: fixed in the Fueling Planner, removed entirely from Post-Ride Analysis.**
Both tabs had a `resultRef`/`scrollIntoView({ block: "start" })` effect nudging the viewport
to a freshly computed result, but they needed opposite fixes:
- **Fueling Planner ("Antes de salir")** — the ref was already on the *correct* element (the
  results container, whose very first child is the "Estrategia de bolsillo & receta casera"
  eyebrow label), but `block: "start"` aligns that element's top edge with the viewport's
  top edge with no allowance for the app's own sticky header sitting on top of it — so the
  scroll landed with the eyebrow label hidden *behind* the header, and the dark Hero card's
  "Dosis casera por bidón" line (the next visible thing below the header) read as if the
  scroll had jumped past the section title entirely. Fixed with `scroll-mt-20` on the
  results container — native `scrollIntoView` already honors `scroll-margin-top`, so this
  needed no JS change, just the one Tailwind class.
- **Post-Ride Analysis ("Al llegar")** — this scrollIntoView effect made sense back when a
  manual "Analizar" click triggered a fresh result the athlete needed to be nudged toward.
  Once this tab switched to auto-loading the latest ride on mount and re-analyzing in place
  the moment "Cambiar salida" picks a different one (see "Sidebar navigation..." above), the
  same effect meant the page jumped around on its own every time the tab opened or a ride was
  switched — removed entirely, along with the now-unused `resultRef`. Verified live: `window.
  scrollY` stays at whatever the athlete scrolled to, both on the initial auto-load and after
  switching activities via "Cambiar salida."

### PWA / "Add to Home Screen"

`app/manifest.ts` (Next's `MetadataRoute.Manifest` file convention — auto-linked into
`<head>`, no manual `<link rel="manifest">` needed) declares `display: "standalone"` so
Android/Chrome's install prompt launches the app without browser chrome. `app/icon.tsx`
(512×512) and `app/apple-icon.tsx` (180×180) both generate a PNG at request time via
`next/og`'s `ImageResponse` — the same brand-mark SVG paths as
`components/icons/RatioLogo.tsx` (same cropped viewBox, embedded directly as inline
`<svg>`/`<path>` elements inside the `ImageResponse` JSX — `satori` renders raw SVG
children natively, no rasterization step needed — with a hardcoded `#171717` fill rather
than `currentColor`, since a standalone `ImageResponse` render tree has no ambient text
color to inherit) on a `--background` cream square, rather than needing a hand-exported
image asset; Next auto-injects the corresponding
`<link rel="icon">`/`<link rel="apple-touch-icon">` tags. **Deliberately not** a static
`app/icon.svg`/`public/icon.svg` file even though `icon.(svg|png|...)` is also a valid
convention — Next allows only one `icon` resolution per route segment, and this segment
already has the dynamic `icon.tsx`; adding a static file alongside it would conflict
rather than layer. `app/layout.tsx`'s `metadata`
sets `appleWebApp: { title, statusBarStyle: "default" }`, which is what actually gets iOS
Safari's "Add to Home Screen" to launch standalone (Android reads the manifest instead).
`viewport.themeColor` matches `--background` (`#faf9f5`) so the installed app's title/
status bar blends with the page instead of showing a mismatched color.

**A stray `app/favicon.ico` (the default Next.js/Vercel scaffold icon, dated well before
`icon.tsx`/`apple-icon.tsx` existed) was found and deleted** — this is the actual root
cause of a reported "the browser tab still shows the default triangle" bug. Next's file
convention treats a literal `app/favicon.ico` as its own special, highest-precedence icon
source (separate from the dynamic `icon.tsx` route), and browsers commonly request
`/favicon.ico` directly regardless of what the `<link rel="icon">` tag says — so the two
coexisting meant the tab favicon and the auto-injected `<link>` tag could point at two
different images. Deleting the stray file (rather than replacing it with a *static*
`favicon.ico`/`icon.png` alongside the dynamic files, which the "no static file alongside
a dynamic one" rule above already rules out) makes `icon.tsx` the sole source of truth
again — verified live: `/favicon.ico` now cleanly 404s, `<link rel="icon">` in `<head>`
correctly resolves to `/icon`, and fetching `/icon` renders the real bronze RATIO `R`
mark, not a placeholder.

### SEO & social sharing metadata (production domain)

`app/layout.tsx`'s `metadata` export is the real, production-facing SEO/Open Graph/Twitter
Card configuration, keyed off the live domain **`https://www.ratiovelo.com`** (the app was
previously only reachable at its Vercel-assigned `*.vercel.app` URL — no code anywhere
actually referenced that old URL as a literal string, so pointing this at the real domain
needed no find-and-replace elsewhere, just this one export). `metadataBase` is the one
field every relative/absolute URL elsewhere in the metadata tree resolves against — Next
warns at build time if Open Graph image URLs are relative with no `metadataBase` set, so
this being correct here is what keeps any future `og:image` addition from silently
resolving to `localhost` in production. `title` is the `{ default, template }` form (`%s |
RATIO`) so any route that sets its own page-level `title` (none currently do) would render
as "X | RATIO" rather than needing to repeat the full brand name itself. `alternates.canonical`
and `openGraph.url` both point at the same bare domain (no path) since this metadata is
declared once at the root layout, not per-route — a route-level canonical would need its own
`alternates.canonical` override if one were ever added. `twitter.creator` (`@ratiovelo`) is
asserted as the real handle, not verified live from this environment (no browser/network
access to confirm the handle exists) — flag to the user if that handle turns out not to be
registered. `appleWebApp` (see "PWA / Add to Home Screen" above) was preserved from the
pre-existing metadata rather than dropped, since it's what actually makes iOS's "Add to
Home Screen" launch standalone.

**`app/sitemap.ts` and `app/robots.ts`** are Next's `MetadataRoute.Sitemap`/
`MetadataRoute.Robots` file conventions — auto-served at `/sitemap.xml`/`/robots.txt`, no
manual XML/plain-text file needed, same "generate at request time" pattern
`app/manifest.ts` already uses for the PWA manifest. The sitemap deliberately lists only
the 3 URLs actually reachable with **no session at all** — the root domain, `/login`, and
`/privacidad` (mirroring `proxy.ts`'s own `PUBLIC_PATH_PREFIXES`, minus `/auth/callback`,
which is a transient single-use-token OAuth transition screen with nothing worth
indexing) — every other route (`/`'s own authenticated Dashboard once signed in,
`/perfil`, `/estadisticas`, `/historial`) requires a real athlete and renders per-user
data, so an anonymous crawler hitting any of them just gets redirected to `/login`
anyway; listing them would be pure noise. `robots.ts` disallows `/api/` (no page content,
and every route there is either auth-gated or a Strava OAuth handshake step) and points
`sitemap` at the same production domain.

**Both had to be added to `proxy.ts`'s `PUBLIC_PATH_PREFIXES`.** A real bug caught during
verification: a crawler requesting `/robots.txt`/`/sitemap.xml` has no session by
definition, and neither path was in the middleware's public allowlist — so both 307'd
straight to `/login` instead of ever reaching the actual generated file (confirmed live:
`curl /robots.txt` returned a 307 before the fix, a clean `200` with the real body after).
Left unfixed, this would have made both files completely unreachable to the one audience
they exist for, silently defeating the entire point of adding them.

**JSON-LD structured data** (`schema.org` `WebApplication`) is a plain module-level
`const jsonLd` object in `app/layout.tsx`, rendered via a `<script
type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />`
as the first child of `<body>` — the root layout has no manual `<head>` of its own (the
`metadata` export manages `<head>` entirely), so `<body>` is where a static JSON-LD script
belongs in this App Router structure; Google's structured-data crawler reads it from
anywhere in the rendered document, not specifically `<head>`. `applicationCategory:
"HealthApplication"` and the free (`price: "0"`) `Offer` both describe this app
accurately — no invented pricing/category to game a rich-result eligibility check.

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
  porcelain white (`--background` `#f9f8f6`, `bg-background`) rather than a cold white/gray,
  with `--card`/`--popover` pure white (`#ffffff`) so cards visually lift off that base, and
  `--surface` (`#f1efea`, `bg-surface`) one layer between the two for input backgrounds
  and secondary containers. Earth-tone technical accents replace the old monochrome
  black-on-white for anything "active"/"primary": `--terracotta` (`#6e6658` — "PNS Bronze,"
  a muted, matte bronze/olive; a brighter terracotta/orange, `#c85231`, was used here until a
  later rebrand pass swapped only the *value*, never the token/class name, since every
  component already reuses this one semantic token — see `app/globals.css`'s own comment on
  this — `bg-terracotta`/`text-terracotta`/`border-terracotta`, a second refinement pass
  later darkened it again from an intermediate `#827b66`, still the same token/class name
  both times, `--terracotta-hover` (`#5e574b`) on hover) is the one accent for every primary
  action button, active tab, and active segmented-control pill; `--sage` (`#526553`) marks
  carb-coverage "cubierto"/positive-progress state,
  distinct from the older, more muted `--status-good` (`#526553` too, same hex, kept as a
  separate token since status banners and the carb-coverage meter may need to diverge
  later); `--sand` (`#d5cfbf`) is the "restante/déficit" tone — deliberately not a second
  red/warning color, since an unfilled carb target isn't an error state; `--slate-tech`
  (`#52606d`) is reserved for future route/weather context, not yet wired into any
  component. `--badge-bg`/`--badge-foreground`/`--badge-border` (`bg-badge`/
  `text-badge-foreground`/`border-badge-border`) style small data pills (weather readouts,
  Gut Training level) via `badgeClass` below.
- **No `tailwind.config.ts`/`.js` exists in this project, deliberately.** Tailwind v4's
  CSS-first setup (`@import "tailwindcss"` at the top of `app/globals.css`) makes the
  `@theme inline` block above the actual, current way to extend the theme — a legacy
  `tailwind.config.ts` with its own `theme.extend.colors`/`fontFamily` block wouldn't just
  be redundant here, it would go largely *unread* by this version of Tailwind. A pass that
  formalized this app's "PNS design system" was scoped accordingly: rather than introducing
  a second, `pns-*`-prefixed color namespace (`pns-brand`, `pns-bg`, etc.) sitting alongside
  the existing `--terracotta`/`--surface`/`--background` tokens — which, hex-for-hex, are
  already the same PNS palette under different names (`--terracotta` is already "PNS
  Bronze," refined since to `#6e6658`) — the existing token set was confirmed complete and reused
  as-is, with one genuinely missing piece added: a brand-colored `::selection` rule in
  `app/globals.css`'s `@layer base` (`background-color: var(--terracotta); color: #ffffff`),
  so selecting text anywhere in the app shows this app's own accent instead of the browser's
  default blue highlight. A codebase-wide audit for stray bright colors outside the token
  system (`grep` for `hover:`/`focus:`/plain `bg-`/`text-`/`border-` utilities in red/
  orange/blue/etc.) turned up only semantically-justified exceptions already documented
  elsewhere — inline form-validation red (`invalidFieldClass`), the logout button's
  destructive-action red hover, the amber `ProfileRequiredBanner`'s own darker-amber hover,
  and the Strava icomark's required brand orange (`components/strava-mark.tsx`, `#FC4C02`,
  see "Strava API compliance" below) — plus the Sync button's own now-fixed stray orange
  icon (see "Strava OAuth" below). Nothing else needed changing.
- **`lib/ui-classes.ts`** is the shared button/field/badge class-string baseline — every
  hand-rolled `<button>`/`<input>`/`<select>` across the Dashboard, Pre-Ride planner,
  Post-Ride analysis, and Physiological Profile form imports `primaryButtonClass`
  (terracotta fill, `rounded-lg`, `font-mono` uppercase — CALCULAR ESTRATEGIA, ANALIZAR,
  GUARDAR, GUARDAR CONSUMO REAL), `secondaryButtonClass` (terracotta-outlined counterpart,
  filling solid `bg-terracotta`/`text-white` on hover — Copiar receta, Descargar GPX,
  Sincronizar; originally a plain `border-neutral-200 bg-white text-neutral-700` gray
  treatment, restyled off this app's own `--surface`/`--terracotta` tokens once the Sync
  button's own one-off white-card-plus-Strava-orange style was identified as a fourth,
  undocumented button variant — see "Strava OAuth" below for `SyncButton` specifically),
  `fieldClass`/`selectableFieldClass` (every
  plain input vs. every select/date field), or `badgeClass` — plain exported strings
  composed via `cn()` at each call site for its own state-dependent classes (disabled,
  active, etc.), not a wrapping component, since every call site already needs that
  composition anyway. A file-local `const inputClass = fieldClass` alias is fine where a
  file already had many call sites under that name; don't invent a *second* set of
  near-identical classes for a new button/field — import from here.
- Bold uppercase tracked headers (`CardTitle`'s default, the page `<h1>`) stay in the same
  clean geometric sans as everything else — never a monospace/retro face for names or
  labels — with `font-mono` reserved strictly for *displayed numeric metrics* (stat blocks,
  recipe grams, ride distances, the pocket-food carb figures — never on user-editable form
  inputs like a `<select>` full of words, and never on a food/label *name*, only the number
  next to it), the uppercase label text on every shared button/badge class (design-system
  pass), and — as of the Dashboard's "Pre-ruta"/"Post-ruta" rename — `TabsTrigger` labels
  too. `TabsTrigger` was a deliberate, later exception to "never on names": the Dashboard's
  two tabs are short, technical-reading labels (closer to a mode/status indicator than a
  prose name), so this one spot intentionally reads as mono/caps like the rest of this
  app's technical chrome rather than staying in the sans face `CardTitle`/`<h1>` keep.
  Post-Ride Analysis's own "Estilo Strava Mobile" metrics grid (see that section under
  "Post-Ride Analysis" above) is the inverse exception — a deliberate *absence* of
  `font-mono` on genuine numeric values (Distancia, Potencia Media, etc.), scoped to that
  one grid, to match Strava's own plain-sans numeral display; every other numeric readout
  in the app keeps `font-mono` unchanged.
  Structural
  dividers are soft `border-neutral-200`/`border-neutral-300` lines, not `border-neutral-900`
  — a stark black divider reads as heavy-handed/brutalist rather than clean; `border-neutral-900`
  itself is no longer used for "active/selected" states either (that's `border-terracotta`
  now), only for genuinely monochrome one-off elements that have no accent-color reason to
  exist (e.g. the app's own Flame mark). **Corners are `rounded-sm` everywhere** — a later
  "Radio de Bordes Pequeño Global" pass (see "PNS premium redesign" below) reversed the
  softer `rounded-lg`/`rounded-xl`/`rounded-2xl` geometry every button/field/select/tab/
  card used to carry, in favor of one small, technical, industrial radius shared by
  literally every interactive control and every card in the app (`primaryButtonClass`/
  `secondaryButtonClass`/`fieldClass`/`selectableFieldClass`, the base `Card` primitive,
  `Tabs`/`TabsTrigger`, `RadioCard`, the pocket-food quantity stepper, `/login`'s auth-flow
  card — all `rounded-sm` now). The few deliberate exceptions are non-card/non-button
  shapes that were never part of this radius scale to begin with: the small circular
  radio-indicator dot inside `RadioCard`, spinner/loading rings, avatar circles, progress-
  bar tracks, and floating glass chips (the map's zoom controls' own distance/elevation
  badge, `badgeClass`, the W/kg pill) — none of those are "buttons/cards/fields/selects/
  tabs/steppers," the six categories this pass explicitly named. Never a bare
  `rounded-none`/no-radius button — every button shares one of the two classes above
  specifically so this can't regress file-by-file.
  `--font-sans` in `app/globals.css` must stay wired to `var(--font-geist-sans)` (the
  actual variable `next/font/google`'s `Geist` sets in `app/layout.tsx`) — it was
  accidentally self-referential (`var(--font-sans)`) for a long stretch of this project's
  history, which silently fell back to the browser's default serif for every heading; if
  headings ever look serif again, check this line first.

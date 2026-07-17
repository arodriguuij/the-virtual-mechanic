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

## Supabase schema

Tables: `profiles` (id references `auth.users`), `bikes` (`profile_id` FK), `components`
(`bike_id` FK), `wear_logs` (`component_id` FK). RLS is enabled and ownership-scoped
(`auth.uid() = profile_id`, etc.) on all four — there is no public/anon read or write
access. No generated types yet — if the schema stabilizes, generate them with
`supabase gen types typescript` and type the client instead of guessing column shapes.

### No login yet (pre-Auth.js)

There's no Auth.js session wired up, but RLS requires an authenticated `auth.uid()` for
every read and write. Until real login exists, both `scripts/seed.ts` and
`lib/dashboard-data.ts` sign in as one dev test user (`SEED_USER_EMAIL`/`SEED_USER_PASSWORD`)
to satisfy RLS. `lib/dashboard-data.ts` is `server-only` and re-authenticates per request
(deduped per-request via React `cache`) — replace that sign-in with the real user's
session as soon as Auth.js lands, and delete `scripts/seed.ts`'s reliance on the same
credentials at that point too.

### Seeding dev data

`npm run seed` (`scripts/seed.ts`) signs in as the dev test user and, only if missing,
inserts: their `profiles` row, a "Scott Addict 30" bike, and a "Cadena Shimano Ultegra
11v" chain component (`max_km: 3000`, `current_wear_percentage: 35`). It's safe to
re-run — every insert is guarded by an existence check first.

### Route dynamic rendering

`app/page.tsx` exports `dynamic = "force-dynamic"` because it reads live Supabase data —
without it Next prerenders the dashboard at build time and the wear percentages would be
frozen from whenever `next build` last ran.

## Code style

- Functional components, no class components.
- Server Components by default; add `"use client"` only where interactivity/state is
  needed (e.g. the sidebar toggle in `components/dashboard-shell.tsx`).
- Compose UI from `components/ui` primitives rather than raw HTML where one exists.
- Tailwind utility classes only — no CSS modules, no styled-components.
- Design tokens (`--brand`, `--status-good`, `--status-warning`, `--status-critical`)
  live in `app/globals.css` alongside the shadcn theme variables; reuse them instead of
  hardcoding hex colors so the dark, Rapha/Strava-inspired look stays consistent.

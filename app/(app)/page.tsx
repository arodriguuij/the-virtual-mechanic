import { Suspense } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FuelingPlanner } from "@/components/fueling-planner";
import { PostRideAnalysis } from "@/components/post-ride-analysis";
import { ProfileSavedToast } from "@/components/profile-saved-toast";
import {
  ensureLatestActivitySynced,
  getAthleteProfile,
  getRecentActivities,
  getStravaRoutes,
  getViewerIdentity,
} from "@/lib/dashboard-data";
import { primaryButtonClass, selectableFieldClass } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Technical/data-label convention (weather stats, field labels, badges) —
// small, uppercase, wide-tracked, mono. This is the *only* place uppercase
// survives in the redesigned Dashboard typography; everything that reads as
// prose (headings, greetings, descriptions) is sentence case instead.
const eyebrow = "text-[10px] font-mono uppercase tracking-widest text-zinc-500";
// The Dashboard's single headline — replaces the old two-line "eyebrow +
// uppercase DASHBOARD title" block with one sentence-case greeting, PNS
// editorial style rather than a shouty all-caps app-shell label. A fixed
// "Hola" rather than the earlier time-of-day-prefixed "Buenos días"/"Buenas
// tardes"/"Buenas noches" — that variance made the greeting's length itself
// vary (a much longer string at midday than at night), which was fighting
// this component's own `truncate` on a narrow phone; a flat, always-short
// "Hola" sidesteps that entirely rather than trying to size around the
// longest possible prefix. `text-2xl sm:text-3xl` (down from `text-3xl
// sm:text-4xl`) for the same reason — smaller text has more room before
// truncating on a small viewport. The real athlete's name is still live
// data via `getViewerIdentity()`, never hardcoded.
const greetingClass = "truncate text-2xl font-semibold tracking-tight text-[#181818] sm:text-3xl";

// Its own Suspense boundary (like `StravaButton` below) so the greeting's
// Strava round-trip via `getViewerIdentity()` never
// blocks the rest of the Dashboard from rendering — `getViewerIdentity` is
// `cache()`-deduped, so this costs no extra query beyond what the sidebar's
// own `ViewerIdentity` already fetches this request.
async function GreetingSection() {
  const identity = await getViewerIdentity();
  const firstName = identity.name.split(" ")[0];
  return <h1 className={greetingClass}>Hola, {firstName}</h1>;
}

function GreetingSkeleton() {
  return <Skeleton className="h-8 w-40 sm:h-9 sm:w-52" />;
}

// Fetches the athlete's saved Strava routes/average speed and renders the
// real planner directly — no "perfil incompleto" branch here anymore.
// `proxy.ts`'s Edge Middleware redirects an incomplete profile to `/perfil`
// before this page can ever render (see CLAUDE.md's "Mandatory profile
// completion" section), so by the time this component runs, a complete
// profile is a guaranteed invariant, not something to check for again.
// `isProfileComplete` is passed as a literal `true` for the same reason —
// `FuelingPlanner`'s own internal lock-button/`ProfileRequiredBanner`
// handling stays in place as a harmless defensive layer (see that
// component's own doc comment), it's just permanently unreachable through
// this call site now. `ftp`/`weightKg` are passed through too — needed so
// "Tiempo estimado" (Card 02) can run the same real, athlete-specific
// `estimateRideDurationHours()` physics model client-side, the instant an
// intensity zone is chosen, instead of a generic distance/speed guess with
// no relationship to the athlete's own real power profile. This physics
// model — real FTP/peso + the route's own distance/desnivel — replaced the
// old Strava-average-speed-based duration guess entirely, which is why
// `getAthleteAverageSpeedKmh()` is no longer fetched here at all.
// `getAthleteProfile()` is `cache()`-deduped, so calling it here costs no
// extra query beyond whatever already resolved it earlier this request.
async function FuelingPlannerSection() {
  const [routes, athleteProfile] = await Promise.all([getStravaRoutes(), getAthleteProfile()]);
  return (
    <FuelingPlanner
      routes={routes}
      ftp={athleteProfile?.ftp ?? 0}
      weightKg={athleteProfile?.weight_kg ?? 0}
      experienceMode={athleteProfile?.experience_mode ?? "standard"}
      isProfileComplete
    />
  );
}


// Generic loading placeholder for `PostRideAnalysisSection` below — an icon+
// title row, then two content bars of different widths, reusing this app's
// own `bg-surface`/`bg-terracotta` design tokens rather than a hardcoded
// cream/bronze hex pair. No border (this app's 100%-frameless pass dropped
// the `border-terracotta/20` this used to carry, relying on the `bg-surface`
// tint alone for definition). `FuelingPlannerSection`'s own tab uses the
// more detailed `FuelingPlannerSkeleton` below instead, since that one now
// always resolves into the same real planner shape (no more branching), so
// there's no risk of it ever being shown for the wrong eventual outcome.
function DashboardSectionSkeleton() {
  return (
    <div className="w-full animate-pulse space-y-4 rounded-sm bg-surface/60 p-5">
      <div className="flex items-center space-x-3">
        <Skeleton className="h-5 w-5 rounded-full bg-terracotta/20" />
        <Skeleton className="h-4 w-40 bg-terracotta/20" />
      </div>
      <Skeleton className="h-10 w-full rounded-sm bg-terracotta/10" />
      <Skeleton className="h-20 w-full rounded-sm bg-terracotta/10" />
    </div>
  );
}

// Mirrors the real `FuelingPlanner` shell (mode toggle, "Ruta" select, the
// same sync spinner/placeholder text `refreshingRoutes` uses, "Intensidad
// objetivo," and the "Fecha y hora de salida" card) instead of a generic
// unrelated set of gray bars — this is the *rare* fallback (getStravaRoutes()
// is cached for 24h, so it only ever shows on a cold cache), but per the
// "never tape over the real structure" convention, even a rare fallback
// should read as "the same form, filling in" rather than a different loading
// card. Only the title/labels/chrome are real, static text; every
// data-dependent value is a muted/pulsing placeholder, never a fabricated
// number.
function FuelingPlannerSkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="h-9 animate-pulse rounded-sm bg-neutral-100" />
          <div className="h-9 animate-pulse rounded-sm bg-neutral-100" />
          <div className="h-9 animate-pulse rounded-sm bg-neutral-100" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={eyebrow}>Ruta</span>
            <div className="relative">
              <div
                className={cn(
                  selectableFieldClass,
                  "flex items-center font-mono text-xs text-neutral-400 cursor-default"
                )}
              >
                Sincronizando rutas de Strava...
              </div>
              <span
                className="pointer-events-none absolute top-1/2 right-8 size-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-800"
                aria-hidden="true"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={eyebrow}>Intensidad objetivo</span>
            <div className={cn(selectableFieldClass, "animate-pulse bg-neutral-100")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={eyebrow}>Fecha y hora de salida</span>
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="h-9 animate-pulse rounded-sm bg-neutral-100" />
                <div className="h-9 animate-pulse rounded-sm bg-neutral-100" />
                <div className="h-9 animate-pulse rounded-sm bg-neutral-100" />
              </div>
              <div className={cn(selectableFieldClass, "animate-pulse bg-neutral-100")} />
            </div>
          </div>
        </div>

        <div className={cn(primaryButtonClass, "pointer-events-none w-full justify-center py-3.5 opacity-50")}>
          Calcular estrategia nutricional
        </div>
      </CardContent>
    </Card>
  );
}

// No "perfil incompleto" branch here either — same invariant as
// `FuelingPlannerSection` above, enforced once by `proxy.ts`'s Edge
// Middleware rather than re-checked on every render. `ensureLatestActivitySynced()`
// runs first (see its own doc comment in `lib/dashboard-data.ts`) so a ride
// finished since the athlete's last visit is already in `activities` by the
// time `getRecentActivities()` reads the list below — instant/no-op when
// nothing's new, since that function's own Strava-vs-DB check short-circuits
// before any real work.
async function PostRideAnalysisSection() {
  await ensureLatestActivitySynced();
  const activities = await getRecentActivities(8);
  return (
    <PostRideAnalysis
      activities={activities.map((a) => ({
        id: a.id,
        name: a.name,
        activity_date: a.activity_date,
      }))}
      isProfileComplete
    />
  );
}

// Login-time Strava errors (from `/api/auth/strava/callback`) surface on
// `/login` instead — the proxy never lets a logged-out visitor reach this
// page. The "Sincronizar rutas" action itself moved out of this header
// entirely — see `components/viewer-identity.tsx`'s own `SyncForm` usage in
// the Sidebar's identity card, next to "Conectado con Strava."
//
// `?profile_saved=1` lands here (not on `/perfil`) because
// `/api/athlete-profile/update` now always redirects a successful save
// straight to the Dashboard — see that route's own doc comment and
// CLAUDE.md's "Mandatory profile completion" section.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const profileSaved = params.profile_saved === "1";

  return (
    // "Unificación de Fondo Porcelana entre Rutas" — an explicit
    // `bg-[#F8F7F5] min-h-[100dvh] w-full` on this page's own root, on top
    // of (not instead of) `<body>`'s existing `bg-background` — the same
    // literal hex, `--background`'s own value. Belt-and-suspenders: this is
    // the one element Next's App Router actually swaps during a client-side
    // navigation between `/`, `/perfil`, and `/metodologia` ("Base
    // científica" — see that page's own doc comment), so it's the layer
    // most likely to matter if a future change ever left a route's own
    // content transparent for a frame during that swap — iOS Safari's
    // floating "pill" toolbar reads any such gap as "opaque bar" territory.
    <div className="min-h-dvh w-full flex flex-col gap-3 bg-[#F8F7F5]">
      {profileSaved && <ProfileSavedToast />}
      {/* "Jerarquía de Espaciado Editorial y Estructura Frameless" — an
          ultracompact scale (roughly half of every prior gap) so the
          Dashboard reads as a dense, native-feeling app rather than a
          spacious editorial page. Greeting → tabs is now a flat `gap-3`
          (12px) — down from the previous generous `gap-6` a still-earlier
          explicit "margen generoso" request had asked for; this later,
          more specific instruction supersedes that one. No divider line
          below the greeting either way — the gap alone is still the only
          separator between it and the tabs. */}
      <header className="w-full">
        <Suspense fallback={<GreetingSkeleton />}>
          <GreetingSection />
        </Suspense>
      </header>

      <Tabs defaultValue="pre-ride">
        <TabsList variant="line" className="w-full justify-start border-b border-neutral-200">
          {/* "Normalización Tipográfica" — PNS-style sober typography: the
              tabs used to read as a technical `font-mono`/uppercase/
              tracking-widest label; now plain sentence-case `font-medium
              text-sm` prose, matching this pass's broader "reduce the abuse
              of uppercase blocks" direction. The obsidian-black active
              accent itself (`#18181B`, matching Card 01's active mode
              toggle, Card 02's active date/stop pills, and the CTA button
              below) is unchanged — only the type treatment carrying it is.
              Still the shared `TabsTrigger`'s own `after:` pseudo-element
              underline mechanic (see `components/ui/tabs.tsx`). */}
          <TabsTrigger
            value="pre-ride"
            className="flex-none text-sm font-medium data-active:font-semibold data-active:text-zinc-900 after:bg-[#18181B]"
          >
            Pre ruta
          </TabsTrigger>
          {/* "Deshabilitación Temporaria de Pestaña Post-Ruta" — early users
              should be funneled exclusively into Pre-Ruta for now. `disabled`
              is base-ui's own real prop on `Tabs.Tab` (not a stripped
              onClick/href), so this is a genuine, keyboard-safe inert state —
              it can never be selected via click, Enter, or arrow-key
              navigation, and `TabsTrigger`'s own shared styles already carry
              `disabled:pointer-events-none disabled:cursor-not-allowed
              disabled:opacity-50`. The dimmed `text-zinc-400` here is layered
              on top of that shared opacity, not a replacement for it. */}
          <TabsTrigger
            value="post-ride"
            disabled
            className="flex-none gap-0 text-sm font-medium text-zinc-400 select-none"
          >
            Post ruta
            <span className="ml-1.5 inline-flex items-center rounded-sm border border-zinc-200/60 bg-zinc-100 px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-wider text-zinc-500 uppercase">
              Próximas
            </span>
          </TabsTrigger>
        </TabsList>

        {/* Tabs → title gap reduced further to `pt-2` (8px, down from
            `pt-4`) — same ultracompact pass, so the tab bar and the card
            title below it read as tightly bound rather than two separate
            blocks. */}
        <TabsContent value="pre-ride">
          <div className="flex flex-col gap-10 pt-2">
            <Suspense fallback={<FuelingPlannerSkeleton />}>
              <FuelingPlannerSection />
            </Suspense>
          </div>
        </TabsContent>

        <TabsContent value="post-ride">
          <div className="flex flex-col gap-10 pt-2">
            <Suspense fallback={<DashboardSectionSkeleton />}>
              <PostRideAnalysisSection />
            </Suspense>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { Link2 } from "lucide-react";
import { Suspense } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FuelingPlanner } from "@/components/fueling-planner";
import { PostRideAnalysis } from "@/components/post-ride-analysis";
import { ProfileSavedToast } from "@/components/profile-saved-toast";
import { SyncForm } from "@/components/sync-button";
import {
  getAthleteAverageSpeedKmh,
  getProfile,
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
// this call site now.
async function FuelingPlannerSection() {
  const [routes, avgSpeedKmh] = await Promise.all([getStravaRoutes(), getAthleteAverageSpeedKmh()]);
  return <FuelingPlanner routes={routes} avgSpeedKmh={avgSpeedKmh} isProfileComplete />;
}

// Generic loading placeholder for `PostRideAnalysisSection` below — an icon+
// title row, then two content bars of different widths, reusing this app's
// own `border-terracotta/20`/`bg-surface` design tokens rather than a
// hardcoded cream/bronze hex pair. `FuelingPlannerSection`'s own tab uses the
// more detailed `FuelingPlannerSkeleton` below instead, since that one now
// always resolves into the same real planner shape (no more branching), so
// there's no risk of it ever being shown for the wrong eventual outcome.
function DashboardSectionSkeleton() {
  return (
    <div className="w-full animate-pulse space-y-4 rounded-xl border border-terracotta/20 bg-surface/60 p-5">
      <div className="flex items-center space-x-3">
        <Skeleton className="h-5 w-5 rounded-full bg-terracotta/20" />
        <Skeleton className="h-4 w-40 bg-terracotta/20" />
      </div>
      <Skeleton className="h-10 w-full rounded-lg bg-terracotta/10" />
      <Skeleton className="h-20 w-full rounded-lg bg-terracotta/10" />
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
      <CardHeader>
        <CardTitle>Planificador de nutrición</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="h-9 animate-pulse rounded-lg border border-terracotta/20 bg-neutral-100" />
          <div className="h-9 animate-pulse rounded-lg border border-terracotta/20 bg-neutral-100" />
          <div className="h-9 animate-pulse rounded-lg border border-terracotta/20 bg-neutral-100" />
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
                <div className="h-9 animate-pulse rounded-lg border border-terracotta/20 bg-neutral-100" />
                <div className="h-9 animate-pulse rounded-lg border border-terracotta/20 bg-neutral-100" />
                <div className="h-9 animate-pulse rounded-lg border border-terracotta/20 bg-neutral-100" />
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
// Middleware rather than re-checked on every render.
async function PostRideAnalysisSection() {
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

async function StravaButton() {
  const profile = await getProfile();
  const connected = Boolean(profile?.strava_athlete_id);

  if (!connected) {
    return (
      <a
        href="/api/strava/connect"
        className={cn(primaryButtonClass, "w-fit shrink-0 px-3 py-1.5 text-xs sm:px-4 sm:py-2")}
      >
        <Link2 className="size-3.5" />
        Conectar Strava
      </a>
    );
  }

  return <SyncForm />;
}

function StravaButtonSkeleton() {
  return <Skeleton className="h-7 w-28 rounded-lg" />;
}

// Login-time Strava errors (from `/api/auth/strava/callback`) surface on
// `/login` instead — the proxy never lets a logged-out visitor reach this
// page. The "Sincronizar rutas" button's own errors (`/api/strava/sync`) no
// longer round-trip through a query param either — `SyncForm` reports them
// via its own toast now, since the sync flow no longer navigates at all.
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
    <div className="flex flex-col gap-4 sm:gap-6">
      {profileSaved && <ProfileSavedToast />}
      <header className="flex w-full items-center justify-between gap-4 border-b border-neutral-200/80 pb-4">
        <div className="min-w-0">
          <Suspense fallback={<GreetingSkeleton />}>
            <GreetingSection />
          </Suspense>
        </div>
        <Suspense fallback={<StravaButtonSkeleton />}>
          <StravaButton />
        </Suspense>
      </header>

      <Tabs defaultValue="pre-ride">
        <TabsList variant="line" className="w-full justify-start border-b border-neutral-200">
          <TabsTrigger
            value="pre-ride"
            className="flex-none font-mono text-[11px] font-semibold tracking-widest uppercase data-active:text-terracotta after:bg-terracotta"
          >
            Pre-ruta
          </TabsTrigger>
          <TabsTrigger
            value="post-ride"
            className="flex-none font-mono text-[11px] font-semibold tracking-widest uppercase data-active:text-terracotta after:bg-terracotta"
          >
            Post-ruta
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pre-ride">
          <div className="flex flex-col gap-10 pt-4 sm:pt-6">
            <Suspense fallback={<FuelingPlannerSkeleton />}>
              <FuelingPlannerSection />
            </Suspense>
          </div>
        </TabsContent>

        <TabsContent value="post-ride">
          <div className="flex flex-col gap-10 pt-4 sm:pt-6">
            <Suspense fallback={<DashboardSectionSkeleton />}>
              <PostRideAnalysisSection />
            </Suspense>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

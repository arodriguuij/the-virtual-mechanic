import { Link2 } from "lucide-react";
import NextLink from "next/link";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FuelingPlanner } from "@/components/fueling-planner";
import { PostRideAnalysis } from "@/components/post-ride-analysis";
import { ProfileCheckBanner } from "@/components/profile-check-banner";
import { SyncForm } from "@/components/sync-button";
import {
  getAthleteAverageSpeedKmh,
  getAthleteProfile,
  getMissingProfileFields,
  getProfile,
  getRecentActivities,
  getStravaRoutes,
  getViewerIdentity,
  isProfileComplete,
} from "@/lib/dashboard-data";
import { primaryButtonClass, selectableFieldClass } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const eyebrow = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
const greetingClass =
  "truncate font-mono text-[10px] tracking-wider text-neutral-500 uppercase sm:text-xs";

function getGreetingPrefix(hour: number): string {
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

// Its own Suspense boundary (like `StravaButton`/`ProfileCheckBannerSection`
// below) so the greeting's Strava round-trip via `getViewerIdentity()` never
// blocks the rest of the Dashboard from rendering — `getViewerIdentity` is
// `cache()`-deduped, so this costs no extra query beyond what the sidebar's
// own `ViewerIdentity` already fetches this request.
async function GreetingSection() {
  const identity = await getViewerIdentity();
  const firstName = identity.name.split(" ")[0];
  const greeting = getGreetingPrefix(new Date().getHours());
  return (
    <p className={greetingClass}>
      {greeting}, {firstName}
    </p>
  );
}

function GreetingSkeleton() {
  return <Skeleton className="h-3 w-28" />;
}

async function FuelingPlannerSection() {
  const profile = await getAthleteProfile();

  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Planificador de nutrición</CardTitle>
          <CardDescription className={eyebrow}>
            Configura tu{" "}
            <NextLink href="/perfil" className="underline underline-offset-2 hover:text-neutral-900">
              perfil fisiológico
            </NextLink>{" "}
            para planificar tus bidones
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [routes, avgSpeedKmh] = await Promise.all([getStravaRoutes(), getAthleteAverageSpeedKmh()]);
  return (
    <FuelingPlanner
      routes={routes}
      avgSpeedKmh={avgSpeedKmh}
      isProfileComplete={isProfileComplete(profile)}
    />
  );
}

async function ProfileCheckBannerSection() {
  const profile = await getAthleteProfile();
  const missingFields = getMissingProfileFields(profile);
  return <ProfileCheckBanner missingFields={missingFields} />;
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
        <CardDescription className={eyebrow}>Estrategia de bolsillo &amp; receta casera</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-neutral-100 p-1">
          <div className="h-9 animate-pulse rounded-md bg-neutral-200/60" />
          <div className="h-9 animate-pulse rounded-md bg-neutral-200/60" />
          <div className="h-9 animate-pulse rounded-md bg-neutral-200/60" />
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
            <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 px-3 py-3">
              <div className="grid grid-cols-3 gap-1">
                <div className="h-9 animate-pulse rounded-md bg-neutral-100" />
                <div className="h-9 animate-pulse rounded-md bg-neutral-100" />
                <div className="h-9 animate-pulse rounded-md bg-neutral-100" />
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

async function PostRideAnalysisSection() {
  const [activities, profile] = await Promise.all([getRecentActivities(8), getAthleteProfile()]);
  return (
    <PostRideAnalysis
      activities={activities.map((a) => ({
        id: a.id,
        name: a.name,
        activity_date: a.activity_date,
      }))}
      isProfileComplete={isProfileComplete(profile)}
    />
  );
}

// Mirrors what `PostRideAnalysis` itself shows in the instant right after it
// mounts (it auto-analyzes the most recent ride with no separate selector/
// button left to show — see CLAUDE.md's "Sidebar navigation..." section) —
// real title/description, a muted status line, nothing fabricated.
function PostRideAnalysisSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Análisis post-ruta</CardTitle>
        <CardDescription className={eyebrow}>
          Deuda de glucógeno y objetivo de recuperación por macros
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="animate-pulse text-sm text-neutral-400">Analizando tu última salida…</p>
      </CardContent>
    </Card>
  );
}

async function StravaButton() {
  const profile = await getProfile();
  const connected = Boolean(profile?.strava_athlete_id);

  if (!connected) {
    return (
      <a href="/api/strava/connect" className={cn(primaryButtonClass, "w-fit shrink-0")}>
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
export default async function Home() {
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <header className="flex w-full items-center justify-between border-b border-neutral-200/80 pb-4">
        <div className="mr-2 flex min-w-0 flex-col">
          <Suspense fallback={<GreetingSkeleton />}>
            <GreetingSection />
          </Suspense>
          <h1 className="truncate font-mono text-xl font-bold tracking-tight text-neutral-900 uppercase sm:text-2xl">
            Dashboard
          </h1>
        </div>
        <Suspense fallback={<StravaButtonSkeleton />}>
          <StravaButton />
        </Suspense>
      </header>

      <Suspense fallback={null}>
        <ProfileCheckBannerSection />
      </Suspense>

      <Tabs defaultValue="pre-ride">
        <TabsList variant="line" className="w-full justify-start border-b border-neutral-200">
          <TabsTrigger
            value="pre-ride"
            className="flex-none text-[11px] font-semibold tracking-widest uppercase data-active:text-terracotta after:bg-terracotta"
          >
            Antes de salir
          </TabsTrigger>
          <TabsTrigger
            value="post-ride"
            className="flex-none text-[11px] font-semibold tracking-widest uppercase data-active:text-terracotta after:bg-terracotta"
          >
            Al llegar
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
            <Suspense fallback={<PostRideAnalysisSkeleton />}>
              <PostRideAnalysisSection />
            </Suspense>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

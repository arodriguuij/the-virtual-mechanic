import { Droplets, ExternalLink, Flame, Link2 } from "lucide-react";
import NextLink from "next/link";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardShell } from "@/components/dashboard-shell";
import { ViewerIdentity, ViewerIdentitySkeleton } from "@/components/viewer-identity";
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
} from "@/lib/dashboard-data";
import { primaryButtonClass } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const eyebrow = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
const greetingClass =
  "truncate font-mono text-[10px] tracking-wider text-neutral-500 uppercase sm:text-xs";

function formatRelativeDate(iso: string) {
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

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
          <CardTitle>Planificador de fueling</CardTitle>
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
  return <FuelingPlanner routes={routes} avgSpeedKmh={avgSpeedKmh} />;
}

async function ProfileCheckBannerSection() {
  const profile = await getAthleteProfile();
  const missingFields = getMissingProfileFields(profile);
  return <ProfileCheckBanner missingFields={missingFields} />;
}

function FuelingPlannerSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-3 w-64" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-36" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </CardContent>
    </Card>
  );
}

async function PostRideAnalysisSection() {
  const activities = await getRecentActivities(8);
  return (
    <PostRideAnalysis
      activities={activities.map((a) => ({
        id: a.id,
        name: a.name,
        activity_date: a.activity_date,
      }))}
    />
  );
}

function PostRideAnalysisSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-end gap-3">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-28" />
        </div>
      </CardContent>
    </Card>
  );
}

function weatherLabel(humidityAvg: number, rainMm: number): string {
  const parts = [`${Math.round(humidityAvg)}% humedad`];
  if (rainMm > 0) parts.push(`${rainMm}mm lluvia`);
  return parts.join(" · ");
}

async function RideHistorySection() {
  const activities = await getRecentActivities(8);

  if (activities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Historial de rutas</CardTitle>
          <CardDescription className={eyebrow}>
            Sin actividades registradas todavía
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de rutas</CardTitle>
        <CardDescription className={eyebrow}>
          Últimas salidas sincronizadas desde Strava
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {activities.map((activity, index) => (
          <div
            key={activity.id}
            className={cn(
              "flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
              index !== activities.length - 1 && "border-b border-neutral-200"
            )}
          >
            <div className="flex items-baseline gap-3 sm:w-56 sm:shrink-0">
              <span className="font-mono text-xs text-neutral-400 tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-neutral-900">{activity.name}</span>
                <span className={eyebrow}>{formatRelativeDate(activity.activity_date)}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pl-8 text-sm sm:pl-0">
              <span className="font-mono font-medium text-neutral-900 tabular-nums">
                {(activity.distance / 1000).toFixed(1)} km
              </span>
              <span className="flex items-center gap-1.5 text-neutral-500">
                <Droplets className="size-3.5" />
                {weatherLabel(activity.humidity_avg, activity.rain_mm)}
              </span>
              {activity.carbs_burned_g != null && (
                <span className="flex items-center gap-1 font-mono font-medium text-status-good">
                  <Flame className="size-3.5" />
                  {activity.carbs_burned_g} g HC
                </span>
              )}
              <a
                href={`https://www.strava.com/activities/${activity.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex cursor-pointer items-center gap-1 text-neutral-400 transition-colors duration-150 hover:text-neutral-900"
              >
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function RideHistorySkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de rutas</CardTitle>
        <Skeleton className="h-3 w-56" />
      </CardHeader>
      <CardContent className="flex flex-col">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between",
              i !== 3 && "border-b border-neutral-200"
            )}
          >
            <div className="flex flex-col gap-2 sm:w-56 sm:shrink-0">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-14" />
            </div>
            <Skeleton className="h-4 w-full max-w-xs" />
          </div>
        ))}
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
    <DashboardShell
      identitySlot={
        <Suspense fallback={<ViewerIdentitySkeleton />}>
          <ViewerIdentity />
        </Suspense>
      }
    >
      <div className="flex flex-col gap-10">
        <header className="mb-6 flex w-full items-center justify-between border-b border-neutral-200/80 pb-4">
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
              Pre-Ride
            </TabsTrigger>
            <TabsTrigger
              value="post-ride"
              className="flex-none text-[11px] font-semibold tracking-widest uppercase data-active:text-terracotta after:bg-terracotta"
            >
              Post-Ride
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pre-ride">
            <div className="flex flex-col gap-10 pt-6">
              <Suspense fallback={<FuelingPlannerSkeleton />}>
                <FuelingPlannerSection />
              </Suspense>
            </div>
          </TabsContent>

          <TabsContent value="post-ride">
            <div className="flex flex-col gap-10 pt-6">
              <Suspense fallback={<PostRideAnalysisSkeleton />}>
                <PostRideAnalysisSection />
              </Suspense>
              <Suspense fallback={<RideHistorySkeleton />}>
                <RideHistorySection />
              </Suspense>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardShell>
  );
}

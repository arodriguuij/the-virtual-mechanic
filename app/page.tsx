import { Droplets, ExternalLink, Flame, Link2, TriangleAlert } from "lucide-react";
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
  getWeeklyPerformance,
} from "@/lib/dashboard-data";
import { gutTrainingLevelLabels, gutTrainingLevelRanges } from "@/lib/metabolic-engine";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const eyebrow = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
const statLabel = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";

function formatRelativeDate(iso: string) {
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
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

function hydrationLabel(score: number): string {
  if (score >= 9) return "Óptimo";
  if (score >= 7) return "Bueno";
  if (score >= 5) return "Mejorable";
  return "Bajo";
}

const weeklyStatValue = "font-mono text-xl font-bold text-neutral-900 tabular-nums";

async function WeeklyPerformancePanel() {
  const weekly = await getWeeklyPerformance();

  return (
    <div className="border border-neutral-200 bg-neutral-50/60 px-4 py-4 sm:px-6">
      <span className={eyebrow}>Rendimiento semanal · últimos 7 días</span>

      {weekly.ridesThisWeekCount === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">
          0 km registrados esta semana — sincroniza tu primera salida para ver tu progreso aquí.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-6 sm:grid-cols-4">
          {weekly.compliancePct == null && weekly.avgIntakeGPerHour == null ? (
            <div className="col-span-2 flex items-center border border-dashed border-neutral-300 bg-white/60 px-3 py-2.5">
              <p className="text-sm text-neutral-500">
                Calcula tu primera estrategia de nutrición para empezar a registrar tu balance
                semanal.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <span className={statLabel}>Cumplimiento 7D</span>
                <span className={weeklyStatValue}>
                  {weekly.compliancePct != null ? (
                    <>
                      {weekly.compliancePct}
                      <span className="ml-0.5 text-sm font-normal text-neutral-500">%</span>
                    </>
                  ) : (
                    "—"
                  )}
                </span>
                {weekly.compliancePct == null && (
                  <span className="text-xs text-neutral-500">Sin datos de consumo aún</span>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <span className={statLabel}>Promedio ingesta</span>
                <span className={weeklyStatValue}>
                  {weekly.avgIntakeGPerHour != null ? (
                    <>
                      {weekly.avgIntakeGPerHour}
                      <span className="ml-1 text-sm font-normal text-neutral-500">g/h</span>
                    </>
                  ) : (
                    "—"
                  )}
                </span>
                {weekly.avgIntakeGPerHour == null && (
                  <span className="text-xs text-neutral-500">Sin datos de consumo aún</span>
                )}
              </div>
            </>
          )}

          <div className="flex flex-col gap-1">
            <span className={statLabel}>Gut training</span>
            <span className={cn(weeklyStatValue, "uppercase")}>
              {gutTrainingLevelLabels[weekly.gutTrainingLevel]}
            </span>
            <span className="text-xs text-neutral-500">
              {gutTrainingLevelRanges[weekly.gutTrainingLevel]}
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <span className={statLabel}>Balance hídrico</span>
            <span className={weeklyStatValue}>
              {weekly.hydrationScore != null ? (
                <>
                  {weekly.hydrationScore.toFixed(1)}
                  <span className="ml-0.5 text-sm font-normal text-neutral-500">/10</span>
                </>
              ) : (
                "—"
              )}
            </span>
            {weekly.hydrationScore != null ? (
              <span className="text-xs text-neutral-500 uppercase">
                {hydrationLabel(weekly.hydrationScore)}
              </span>
            ) : (
              <span className="text-xs text-neutral-500">Sin datos de consumo aún</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WeeklyPerformancePanelSkeleton() {
  return (
    <div className="border border-neutral-200 bg-neutral-50/60 px-4 py-4 sm:px-6">
      <Skeleton className="h-3 w-40" />
      <div className="mt-3 grid grid-cols-2 gap-6 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

const stravaButtonClass =
  "inline-flex cursor-pointer items-center gap-2 px-4 py-2.5 text-[11px] font-semibold tracking-widest uppercase transition-colors duration-150";

async function StravaButton() {
  const profile = await getProfile();
  const connected = Boolean(profile?.strava_athlete_id);

  if (!connected) {
    return (
      <a
        href="/api/strava/connect"
        className={cn(
          stravaButtonClass,
          "border border-neutral-900 bg-neutral-900 text-background hover:bg-neutral-700"
        )}
      >
        <Link2 className="size-3.5" />
        Conectar Strava
      </a>
    );
  }

  return (
    <SyncForm
      className={cn(
        stravaButtonClass,
        "border border-neutral-900 bg-transparent text-neutral-900 hover:bg-neutral-900 hover:text-background"
      )}
    />
  );
}

function StravaButtonSkeleton() {
  return <Skeleton className="h-8.5 w-40" />;
}

// Login-time Strava errors (from `/api/auth/strava/callback`) now surface
// on `/login` instead — the proxy never lets a logged-out visitor reach
// this page, so only errors from an already-logged-in action (the
// "Sincronizar rutas" button hitting `/api/strava/sync`) land here.
const stravaErrorMessages: Record<string, string> = {
  not_connected: "Conecta Strava antes de sincronizar rutas.",
  no_rides: "No se encontró ninguna actividad de ciclismo reciente en Strava.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;

  const stravaErrorCode = params.strava_error;
  const stravaError =
    typeof stravaErrorCode === "string"
      ? (stravaErrorMessages[stravaErrorCode] ?? "No se pudo completar la operación con Strava.")
      : null;

  return (
    <DashboardShell
      identitySlot={
        <Suspense fallback={<ViewerIdentitySkeleton />}>
          <ViewerIdentity />
        </Suspense>
      }
    >
      <div className="flex flex-col gap-10">
        <header className="flex flex-col items-start gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={eyebrow}>Buenas tardes, Alejandro</p>
            <h1 className="mt-1 text-2xl font-bold tracking-wide text-neutral-900 uppercase">
              Dashboard
            </h1>
          </div>
          <Suspense fallback={<StravaButtonSkeleton />}>
            <StravaButton />
          </Suspense>
        </header>

        {stravaError && (
          <div className="flex items-center gap-2 border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-sm text-status-warning">
            <TriangleAlert className="size-4 shrink-0" />
            {stravaError}
          </div>
        )}

        <Suspense fallback={null}>
          <ProfileCheckBannerSection />
        </Suspense>

        {/*
          Mobile-first priority: a new athlete's very first useful action is
          calculating a fueling strategy, not reading last week's stats — so
          the Tabs block (Pre-Ride's Fueling Planner is its default tab)
          renders before the Weekly Performance Panel on small screens via
          `order`, reverting to the original stats-then-tabs order at `sm:`
          and up, where there's enough width to not need the reprioritization.
        */}
        <div className="order-2 sm:order-0">
          <Suspense fallback={<WeeklyPerformancePanelSkeleton />}>
            <WeeklyPerformancePanel />
          </Suspense>
        </div>

        <div className="order-1 sm:order-0">
          <Tabs defaultValue="pre-ride">
            <TabsList variant="line" className="w-full justify-start border-b border-neutral-200">
              <TabsTrigger
                value="pre-ride"
                className="flex-none text-[11px] font-semibold tracking-widest uppercase"
              >
                Pre-Ride
              </TabsTrigger>
              <TabsTrigger
                value="post-ride"
                className="flex-none text-[11px] font-semibold tracking-widest uppercase"
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
      </div>
    </DashboardShell>
  );
}

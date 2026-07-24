import { Droplets, ExternalLink, Flame, Link2, RefreshCw, TriangleAlert } from "lucide-react";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardShell } from "@/components/dashboard-shell";
import { FuelingPlanner } from "@/components/fueling-planner";
import { PostRideAnalysis } from "@/components/post-ride-analysis";
import {
  getAthleteProfile,
  getFuelingTotals,
  getProfile,
  getRecentActivities,
  getStravaRoutes,
} from "@/lib/dashboard-data";
import { gutTrainingLevelLabels, gutTrainingLevelRanges, sweatRateLabels } from "@/lib/metabolic-engine";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const eyebrow = "text-[10px] font-medium tracking-widest text-neutral-600 uppercase";
const statLabel = "text-[10px] font-medium tracking-widest text-neutral-600 uppercase";
const statValue = "text-2xl font-semibold text-neutral-900 tabular-nums";

function formatRelativeDate(iso: string) {
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

const profileInputClass =
  "border border-neutral-300 bg-background px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900";

async function PhysiologicalProfileCard() {
  const profile = await getAthleteProfile();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-medium text-neutral-900">Perfil fisiológico</CardTitle>
        <CardDescription className={eyebrow}>
          {profile
            ? "Tu línea base metabólica — peso sincronizado desde Strava al conectar"
            : "Todavía no has configurado tu perfil de atleta"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form
          action="/api/athlete-profile/update"
          method="POST"
          className="grid grid-cols-2 gap-4 sm:grid-cols-5 sm:items-end"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="weight_kg" className={eyebrow}>
              Peso (kg)
            </label>
            <input
              id="weight_kg"
              name="weight_kg"
              type="number"
              step="0.1"
              min="1"
              required
              defaultValue={profile?.weight_kg ?? ""}
              className={profileInputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ftp" className={eyebrow}>
              FTP (W)
            </label>
            <input
              id="ftp"
              name="ftp"
              type="number"
              min="1"
              required
              defaultValue={profile?.ftp ?? ""}
              className={profileInputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sweat_rate" className={eyebrow}>
              Sudoración
            </label>
            <select
              id="sweat_rate"
              name="sweat_rate"
              defaultValue={profile?.sweat_rate ?? "medium"}
              className={profileInputClass}
            >
              {(Object.keys(sweatRateLabels) as (keyof typeof sweatRateLabels)[]).map((rate) => (
                <option key={rate} value={rate}>
                  {sweatRateLabels[rate]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="gut_training_level" className={eyebrow}>
              Gut training
            </label>
            <select
              id="gut_training_level"
              name="gut_training_level"
              defaultValue={profile?.gut_training_level ?? "intermediate"}
              className={profileInputClass}
            >
              {(
                Object.keys(gutTrainingLevelLabels) as (keyof typeof gutTrainingLevelLabels)[]
              ).map((level) => (
                <option key={level} value={level}>
                  {gutTrainingLevelLabels[level]} ({gutTrainingLevelRanges[level]})
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center border border-neutral-900 bg-neutral-900 px-4 py-2 text-[11px] font-medium tracking-widest text-background uppercase transition-colors hover:bg-neutral-700"
          >
            Guardar
          </button>
        </form>

        <div className="border-t border-neutral-200 pt-4">
          <span className={eyebrow}>Escala de adaptación digestiva (Gut Training)</span>
          <p className="mt-1.5 text-sm text-neutral-500">
            El intestino se entrena igual que las piernas — tolerar más carbohidratos por hora
            en ruta es una capacidad que se gana progresivamente. Tu nivel actual limita el
            máximo que el planificador te recomendará, aunque la intensidad de la ruta pida
            más.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm text-neutral-700 sm:grid-cols-4">
            {(
              Object.keys(gutTrainingLevelLabels) as (keyof typeof gutTrainingLevelLabels)[]
            ).map((level) => (
              <li key={level} className="flex flex-col gap-0.5 border border-neutral-200 px-3 py-2">
                <span className="font-medium text-neutral-900">{gutTrainingLevelLabels[level]}</span>
                <span className="text-xs text-neutral-500">{gutTrainingLevelRanges[level]}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function PhysiologicalProfileSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

async function FuelingPlannerSection() {
  const profile = await getAthleteProfile();

  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-medium text-neutral-900">
            Planificador de fueling
          </CardTitle>
          <CardDescription className={eyebrow}>
            Configura tu perfil fisiológico arriba para planificar tus bidones
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const routes = await getStravaRoutes();
  return <FuelingPlanner routes={routes} />;
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
          <CardTitle className="font-medium text-neutral-900">Historial de rutas</CardTitle>
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
        <CardTitle className="font-medium text-neutral-900">Historial de rutas</CardTitle>
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
              <span className="text-xs text-neutral-400 tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-neutral-900">{activity.name}</span>
                <span className={eyebrow}>{formatRelativeDate(activity.activity_date)}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pl-8 text-sm sm:pl-0">
              <span className="font-medium text-neutral-900 tabular-nums">
                {(activity.distance / 1000).toFixed(1)} km
              </span>
              <span className="flex items-center gap-1.5 text-neutral-500">
                <Droplets className="size-3.5" />
                {weatherLabel(activity.humidity_avg, activity.rain_mm)}
              </span>
              {activity.carbs_burned_g != null && (
                <span className="flex items-center gap-1 font-medium text-status-good">
                  <Flame className="size-3.5" />
                  {activity.carbs_burned_g} g HC
                </span>
              )}
              <a
                href={`https://www.strava.com/activities/${activity.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-neutral-400 hover:text-neutral-900"
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
        <CardTitle className="font-medium text-neutral-900">Historial de rutas</CardTitle>
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

async function GlobalMetricsBar() {
  const totals = await getFuelingTotals();

  return (
    <div className="grid grid-cols-2 gap-6 border-b border-neutral-200 pb-6 sm:grid-cols-4">
      <div className="flex flex-col gap-1">
        <span className={statLabel}>€ Ahorrado</span>
        <span className={statValue}>
          {totals.totalMoneySaved.toFixed(2)}
          <span className="ml-1 text-sm font-normal text-neutral-500">€</span>
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span className={statLabel}>Glucógeno rastreado</span>
        <span className={statValue}>
          {totals.totalGlycogenKg.toFixed(2)}
          <span className="ml-1 text-sm font-normal text-neutral-500">kg</span>
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span className={statLabel}>Hidratación gestionada</span>
        <span className={statValue}>
          {totals.totalFluidL.toFixed(1)}
          <span className="ml-1 text-sm font-normal text-neutral-500">L</span>
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span className={statLabel}>Sodio gestionado</span>
        <span className={statValue}>
          {totals.totalSodiumG.toFixed(1)}
          <span className="ml-1 text-sm font-normal text-neutral-500">g</span>
        </span>
      </div>
    </div>
  );
}

function GlobalMetricsBarSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-6 border-b border-neutral-200 pb-6 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

const stravaButtonClass =
  "inline-flex items-center gap-2 px-4 py-2 text-[11px] font-medium tracking-widest uppercase transition-colors";

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
    <form action="/api/strava/sync" method="POST">
      <button
        type="submit"
        className={cn(
          stravaButtonClass,
          "border border-neutral-900 bg-transparent text-neutral-900 hover:bg-neutral-900 hover:text-background"
        )}
      >
        <RefreshCw className="size-3.5" />
        Sincronizar rutas
      </button>
    </form>
  );
}

function StravaButtonSkeleton() {
  return <Skeleton className="h-8.5 w-40" />;
}

const stravaErrorMessages: Record<string, string> = {
  access_denied: "Cancelaste la conexión con Strava.",
  missing_code: "Strava no envió un código de autorización válido.",
  token_exchange_failed: "No se pudo intercambiar el código con Strava.",
  no_session: "No se pudo verificar la sesión de desarrollo.",
  save_failed: "No se pudieron guardar los tokens de Strava.",
  update_blocked_by_rls: "Los tokens no se guardaron: falta la policy de UPDATE en profiles.",
  not_connected: "Conecta Strava antes de sincronizar rutas.",
  no_rides: "No se encontró ninguna actividad de ciclismo reciente en Strava.",
};

const profileErrorMessages: Record<string, string> = {
  invalid_weight: "Introduce un peso válido.",
  invalid_ftp: "Introduce un FTP válido.",
  invalid_sweat_rate: "Selecciona una tasa de sudoración válida.",
  invalid_gut_training_level: "Selecciona un nivel de Gut Training válido.",
  no_session: "No se pudo verificar la sesión de desarrollo.",
  update_blocked_by_rls: "No se pudo guardar el perfil: RLS bloqueó el UPDATE.",
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

  const profileErrorCode = params.profile_error;
  const profileError =
    typeof profileErrorCode === "string"
      ? (profileErrorMessages[profileErrorCode] ?? "No se pudo guardar el perfil fisiológico.")
      : null;

  return (
    <DashboardShell>
      <div className="flex flex-col gap-10">
        <header className="flex items-end justify-between border-b border-neutral-200 pb-6">
          <div>
            <p className={eyebrow}>Buenas tardes, Alejandro</p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight text-neutral-900">
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

        {profileError && (
          <div className="flex items-center gap-2 border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-sm text-status-warning">
            <TriangleAlert className="size-4 shrink-0" />
            {profileError}
          </div>
        )}

        <Suspense fallback={<GlobalMetricsBarSkeleton />}>
          <GlobalMetricsBar />
        </Suspense>

        <Tabs defaultValue="pre-ride">
          <TabsList variant="line">
            <TabsTrigger value="pre-ride">Pre-Ride</TabsTrigger>
            <TabsTrigger value="post-ride">Post-Ride</TabsTrigger>
            <TabsTrigger value="profile">Perfil &amp; Gut Training</TabsTrigger>
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

          <TabsContent value="profile">
            <div className="flex flex-col gap-10 pt-6">
              <Suspense fallback={<PhysiologicalProfileSkeleton />}>
                <PhysiologicalProfileCard />
              </Suspense>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardShell>
  );
}

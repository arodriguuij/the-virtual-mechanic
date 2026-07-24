import { Droplets, ExternalLink, Flame, Link2, RefreshCw, TriangleAlert } from "lucide-react";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardShell } from "@/components/dashboard-shell";
import { FuelingPlanner } from "@/components/fueling-planner";
import {
  getAthleteProfile,
  getProfile,
  getRecentActivities,
  getStravaRoutes,
} from "@/lib/dashboard-data";
import { getPostRideRecoveryTarget, sweatRateLabels } from "@/lib/metabolic-engine";
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
      <CardContent>
        <form
          action="/api/athlete-profile/update"
          method="POST"
          className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:items-end"
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
          <button
            type="submit"
            className="inline-flex items-center justify-center border border-neutral-900 bg-neutral-900 px-4 py-2 text-[11px] font-medium tracking-widest text-background uppercase transition-colors hover:bg-neutral-700"
          >
            Guardar
          </button>
        </form>
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

async function RecoveryCard() {
  const [profile, activities] = await Promise.all([
    getAthleteProfile(),
    getRecentActivities(8),
  ]);
  const activity = activities[0];

  if (!activity) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-medium text-neutral-900">
            Recuperación de la última ruta
          </CardTitle>
          <CardDescription className={eyebrow}>
            Sin actividades registradas todavía
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const hasNutritionData = activity.carbs_burned_g != null;
  const recovery = profile ? getPostRideRecoveryTarget(profile.weight_kg) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-medium text-neutral-900">
          Recuperación de la última ruta
        </CardTitle>
        <CardDescription className={eyebrow}>
          &ldquo;{activity.name}&rdquo; · {formatRelativeDate(activity.activity_date)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {hasNutritionData ? (
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1">
              <span className={statLabel}>Glucógeno quemado</span>
              <span className={statValue}>
                {activity.carbs_burned_g}
                <span className="ml-1 text-sm font-normal text-neutral-500">g</span>
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className={statLabel}>Líquido perdido</span>
              <span className={statValue}>
                {(((activity.fluid_loss_ml ?? 0) / 1000).toFixed(1))}
                <span className="ml-1 text-sm font-normal text-neutral-500">L</span>
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className={statLabel}>Sodio perdido</span>
              <span className={statValue}>
                {activity.sodium_loss_mg}
                <span className="ml-1 text-sm font-normal text-neutral-500">mg</span>
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">
            Configura tu FTP en el perfil fisiológico para calcular el gasto metabólico de esta
            ruta.
          </p>
        )}

        {recovery && (
          <>
            <Separator className="bg-neutral-200" />
            <div>
              <span className={eyebrow}>Objetivo de recuperación (primeros 30 min)</span>
              <div className="mt-2 flex items-center gap-2 text-sm">
                <span className="font-medium text-neutral-900">
                  {recovery.carbsG}g carbohidratos
                </span>
                <span className="text-neutral-400">·</span>
                <span className="font-medium text-neutral-900">{recovery.proteinG}g proteína</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RecoveryCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-3 w-40" />
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-14" />
          </div>
        ))}
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

        <Suspense fallback={<PhysiologicalProfileSkeleton />}>
          <PhysiologicalProfileCard />
        </Suspense>

        <Suspense fallback={<FuelingPlannerSkeleton />}>
          <FuelingPlannerSection />
        </Suspense>

        <Suspense fallback={<RecoveryCardSkeleton />}>
          <RecoveryCard />
        </Suspense>

        <Suspense fallback={<RideHistorySkeleton />}>
          <RideHistorySection />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

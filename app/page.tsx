import { Progress } from "@base-ui/react/progress";
import {
  ArrowDownRight,
  Bike,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Link2,
  MapPin,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Suspense } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardShell } from "@/components/dashboard-shell";
import { getLatestActivity, getPrimaryBike, getProfile } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const eyebrow = "text-[10px] font-medium tracking-widest text-neutral-500 uppercase";
const statLabel = "text-[10px] font-medium tracking-widest text-neutral-500 uppercase";
const statValue = "text-2xl font-semibold text-neutral-900 tabular-nums";

type WearStatus = "good" | "warning" | "critical";

function wearStatus(pct: number): WearStatus {
  if (pct >= 80) return "critical";
  if (pct >= 50) return "warning";
  return "good";
}

const statusMeta: Record<
  WearStatus,
  { label: string; icon: typeof CircleCheck; dot: string; text: string }
> = {
  good: {
    label: "Óptimo",
    icon: CircleCheck,
    dot: "bg-status-good",
    text: "text-status-good",
  },
  warning: {
    label: "Vigilar",
    icon: TriangleAlert,
    dot: "bg-status-warning",
    text: "text-status-warning",
  },
  critical: {
    label: "Reemplazar",
    icon: CircleAlert,
    dot: "bg-status-critical",
    text: "text-status-critical",
  },
};

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatRelativeDate(iso: string) {
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

async function BikeHeroCard() {
  const bike = await getPrimaryBike();

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-6 sm:grid-cols-[220px_1fr]">
        <div className="flex items-center justify-center border-b border-neutral-200 bg-neutral-100 p-8 sm:border-r sm:border-b-0">
          <Bike className="size-14 text-neutral-900" strokeWidth={1} />
        </div>
        <CardContent className="flex flex-col justify-center gap-2 py-6 pl-0 sm:pl-2">
          <CardDescription className={eyebrow}>Mi bicicleta actual</CardDescription>
          {bike ? (
            <>
              <CardTitle className="text-xl font-medium text-neutral-900">
                {bike.brand} {bike.model}
              </CardTitle>
              {bike.weight != null && (
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <span className="text-4xl font-semibold tracking-tight text-neutral-900">
                    {bike.weight}
                  </span>
                  <span className="pb-1 text-sm text-neutral-500">kg</span>
                </div>
              )}
            </>
          ) : (
            <CardTitle className="text-xl font-medium text-neutral-500">
              Todavía no has registrado ninguna bicicleta
            </CardTitle>
          )}
        </CardContent>
      </div>
    </Card>
  );
}

function BikeHeroSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-6 sm:grid-cols-[220px_1fr]">
        <div className="flex items-center justify-center border-b border-neutral-200 bg-neutral-100 p-8 sm:border-r sm:border-b-0">
          <Skeleton className="size-14 rounded-full" />
        </div>
        <CardContent className="flex flex-col justify-center gap-3 py-6 pl-0 sm:pl-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-9 w-24" />
        </CardContent>
      </div>
    </Card>
  );
}

async function ChainWearCard() {
  const bike = await getPrimaryBike();
  const chain = bike?.components.find((c) => c.type === "chain");

  if (!chain) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-medium text-neutral-900">
            Semáforo de desgaste
          </CardTitle>
          <CardDescription className={eyebrow}>Sin cadena registrada todavía</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const wear = chain.current_wear_percentage;
  const status = wearStatus(wear);
  const meta = statusMeta[status];
  const Icon = meta.icon;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-medium text-neutral-900">Semáforo de desgaste</CardTitle>
        <CardDescription className={eyebrow}>{chain.name}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "size-2 rounded-full",
                status === "good" ? "bg-status-good" : "bg-status-good/20"
              )}
            />
            <span
              className={cn(
                "size-2 rounded-full",
                status === "warning" ? "bg-status-warning" : "bg-status-warning/20"
              )}
            />
            <span
              className={cn(
                "size-2 rounded-full",
                status === "critical" ? "bg-status-critical" : "bg-status-critical/20"
              )}
            />
          </div>
          <span className={cn("flex items-center gap-1 text-xs font-medium tracking-wide uppercase", meta.text)}>
            <Icon className="size-3.5" />
            {meta.label}
          </span>
        </div>

        <Progress.Root value={wear}>
          <ProgressTrack className="bg-neutral-200">
            <ProgressIndicator className={meta.dot} />
          </ProgressTrack>
        </Progress.Root>

        <p className="text-sm text-neutral-500">
          {wear}% de vida útil consumida · límite estimado {chain.max_km.toLocaleString("es-ES")} km.
        </p>
      </CardContent>
    </Card>
  );
}

function ChainWearSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-medium text-neutral-900">Semáforo de desgaste</CardTitle>
        <Skeleton className="h-3 w-40" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-2 w-12 rounded-full" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-1 w-full rounded-full" />
        <Skeleton className="h-4 w-full" />
      </CardContent>
    </Card>
  );
}

async function WattsTaxCard() {
  const activity = await getLatestActivity();

  if (!activity || activity.average_watts == null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-medium text-neutral-900">Impuesto de vatios</CardTitle>
          <CardDescription className={eyebrow}>Sin actividades registradas todavía</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const wattsActual = activity.average_watts;
  const wattsLost = activity.watts_lost;
  const wattsTheoretical = wattsActual + wattsLost;

  const captionParts: string[] = [];
  if (activity.humidity_avg) {
    captionParts.push(`${Math.round(activity.humidity_avg)}% de humedad`);
  }
  if (activity.rain_mm) {
    captionParts.push(`${activity.rain_mm}mm de lluvia`);
  }
  const caption =
    captionParts.length > 0
      ? `perdidos por ${captionParts.join(" y ")} durante la ruta`
      : "perdidos por fricción y suciedad en los componentes";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-medium text-neutral-900">Impuesto de vatios</CardTitle>
        <CardDescription className={eyebrow}>
          Pérdida estimada en &ldquo;{activity.name}&rdquo;
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <span className={statLabel}>Vatios teóricos</span>
            <span className={statValue}>
              {Math.round(wattsTheoretical)}
              <span className="ml-1 text-sm font-normal text-neutral-500">W</span>
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className={statLabel}>Vatios netos</span>
            <span className={statValue}>
              {Math.round(wattsActual)}
              <span className="ml-1 text-sm font-normal text-neutral-500">W</span>
            </span>
          </div>
        </div>
        <Separator className="bg-neutral-200" />
        <div className="flex items-center gap-2 text-sm">
          <span className="flex items-center gap-1 font-medium text-status-warning">
            <ArrowDownRight className="size-4" />
            -{Math.round(wattsLost)} W
          </span>
          <span className="text-neutral-500">{caption}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function WattsTaxSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-medium text-neutral-900">Impuesto de vatios</CardTitle>
        <Skeleton className="h-3 w-48" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-16" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-16" />
          </div>
        </div>
        <Skeleton className="h-px w-full" />
        <Skeleton className="h-4 w-full" />
      </CardContent>
    </Card>
  );
}

async function ActivityCard() {
  const activity = await getLatestActivity();

  if (!activity) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-medium text-neutral-900">Última actividad</CardTitle>
          <CardDescription className={eyebrow}>Sin actividades registradas todavía</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-medium text-neutral-900">Última actividad</CardTitle>
        <CardDescription className={eyebrow}>
          Vía Strava · {formatRelativeDate(activity.activity_date)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-neutral-900">
            <MapPin className="size-3.5 text-neutral-500" />
            {activity.name}
          </div>
          <a
            href={`https://www.strava.com/activities/${activity.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-medium tracking-wide text-neutral-900 uppercase hover:underline"
          >
            Ver en Strava
            <ExternalLink className="size-3" />
          </a>
        </div>
        <Separator className="bg-neutral-200" />
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="flex flex-col gap-1">
            <span className="text-lg font-semibold text-neutral-900 tabular-nums">
              {(activity.distance / 1000).toFixed(1)}
            </span>
            <span className={statLabel}>km</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-lg font-semibold text-neutral-900 tabular-nums">
              {activity.total_elevation_gain != null
                ? Math.round(activity.total_elevation_gain).toLocaleString("es-ES")
                : "—"}
            </span>
            <span className={statLabel}>m D+</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-lg font-semibold text-neutral-900 tabular-nums">
              {formatDuration(activity.moving_time)}
            </span>
            <span className={statLabel}>duración</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-lg font-semibold text-neutral-900 tabular-nums">
              {activity.average_watts != null ? Math.round(activity.average_watts) : "—"}
            </span>
            <span className={statLabel}>W medios</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActivitySkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-medium text-neutral-900">Última actividad</CardTitle>
        <Skeleton className="h-3 w-32" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-px w-full" />
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton className="h-5 w-10" />
              <Skeleton className="h-3 w-8" />
            </div>
          ))}
        </div>
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
  update_blocked_by_rls:
    "Los tokens no se guardaron: falta la policy de UPDATE en profiles.",
  not_connected: "Conecta Strava antes de sincronizar rutas.",
  no_rides: "No se encontró ninguna actividad de ciclismo reciente en Strava.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const stravaErrorCode = (await searchParams).strava_error;
  const stravaError =
    typeof stravaErrorCode === "string"
      ? (stravaErrorMessages[stravaErrorCode] ?? "No se pudo completar la operación con Strava.")
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

        <Suspense fallback={<BikeHeroSkeleton />}>
          <BikeHeroCard />
        </Suspense>

        <section className="grid gap-6 md:grid-cols-2">
          <Suspense fallback={<ChainWearSkeleton />}>
            <ChainWearCard />
          </Suspense>

          <Suspense fallback={<WattsTaxSkeleton />}>
            <WattsTaxCard />
          </Suspense>
        </section>

        <Suspense fallback={<ActivitySkeleton />}>
          <ActivityCard />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

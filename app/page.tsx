import { Progress } from "@base-ui/react/progress";
import {
  ArrowDownRight,
  Bike,
  CircleAlert,
  CircleCheck,
  Droplets,
  ExternalLink,
  Link2,
  OctagonAlert,
  RefreshCw,
  TriangleAlert,
  Wrench,
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
import {
  type BikeWithComponents,
  getPrimaryBike,
  getProfile,
  getRecentActivities,
} from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const eyebrow = "text-[10px] font-medium tracking-widest text-neutral-600 uppercase";
const statLabel = "text-[10px] font-medium tracking-widest text-neutral-600 uppercase";
const statValue = "text-2xl font-semibold text-neutral-900 tabular-nums";

type WearStatus = "optimal" | "warning" | "critical" | "exhausted";

function wearStatus(pct: number): WearStatus {
  if (pct >= 100) return "exhausted";
  if (pct >= 85) return "critical";
  if (pct >= 60) return "warning";
  return "optimal";
}

const statusMeta: Record<
  WearStatus,
  { label: string; icon: typeof CircleCheck; dot: string; text: string }
> = {
  optimal: {
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
    label: "Crítico",
    icon: CircleAlert,
    dot: "bg-status-critical",
    text: "text-status-critical",
  },
  exhausted: {
    label: "Agotado",
    icon: OctagonAlert,
    dot: "bg-status-critical",
    text: "text-status-critical",
  },
};

const componentTypeLabels: Record<string, string> = {
  chain: "Cadena",
  cassette: "Cassette",
  chainring: "Platos",
};

/** Null for `optimal` — nothing worth saying yet. */
function getWearMessage(status: WearStatus, componentType: string): string | null {
  if (status === "optimal") return null;
  if (status === "warning") {
    return componentType === "chain"
      ? "Desgaste moderado. El estiramiento está empezando a acelerar el desgaste del cassette (fricción ×1.5)."
      : "Rendimiento óptimo, vigilar en las próximas salidas.";
  }
  if (status === "critical") {
    return "Mantenimiento requerido. Programa el cambio de pieza para evitar daños estructurales en la transmisión.";
  }
  return "Sustitúyelo de inmediato. Rodar en este estado compromete tu seguridad y destroza el resto de componentes.";
}

/**
 * Manual thousand-separator insertion instead of `.toLocaleString("es-ES")`
 * — Node's ICU data for es-ES grouping isn't guaranteed to be present in
 * every environment (it was silently missing locally), which is exactly
 * what produced "7500 km" next to "18.000 km" on the same page. This is
 * deterministic everywhere.
 */
function formatKm(km: number): string {
  return Math.round(km)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
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
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="flex items-center justify-center border-b border-neutral-200 bg-neutral-100 p-8 sm:w-55 sm:shrink-0 sm:border-r sm:border-b-0">
          {/* mt-1.5 is an optical nudge, not a layout fix: the container above
              is measured pixel-symmetric (verified with Playwright), but the
              Bike glyph's own ink (wheels) sits low in its viewBox, so
              geometric centering alone reads as "stuck to the top". */}
          <Bike className="mt-1.5 size-14 text-neutral-900" strokeWidth={1} />
        </div>
        <CardContent className="flex flex-1 flex-col justify-center gap-2 py-6 pl-0 sm:pl-2">
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

async function WorkshopAlertsBanner() {
  const bike = await getPrimaryBike();
  const flagged = (bike?.components ?? [])
    .map((component) => ({ component, status: wearStatus(component.current_wear_percentage) }))
    .filter(({ status }) => status === "critical" || status === "exhausted");

  if (flagged.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 border border-status-critical/40 bg-status-critical/5 px-5 py-4">
      <div className="flex items-center gap-2 text-xs font-medium tracking-widest text-status-critical uppercase">
        <Wrench className="size-4" />
        Alertas de taller
      </div>
      <ul className="flex flex-col gap-1.5">
        {flagged.map(({ component, status }) => (
          <li
            key={component.id}
            className="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-baseline sm:gap-2"
          >
            <span className="font-medium text-neutral-900">
              {componentTypeLabels[component.type] ?? component.type} · {statusMeta[status].label}
            </span>
            <span className="text-neutral-600">
              {getWearMessage(status, component.type)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DrivetrainComponentCard({
  component,
}: {
  component: BikeWithComponents["components"][number];
}) {
  const wear = component.current_wear_percentage;
  const status = wearStatus(wear);
  const meta = statusMeta[status];
  const Icon = meta.icon;
  const message = getWearMessage(status, component.type);
  const severe = status === "critical" || status === "exhausted";
  const label = componentTypeLabels[component.type] ?? component.type;

  return (
    <Card className={cn(severe && "border-status-critical/40")}>
      <CardHeader>
        <CardTitle className="font-medium text-neutral-900">{label}</CardTitle>
        <CardDescription className={eyebrow}>{component.name}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "text-neutral-900 tabular-nums transition-all",
              severe ? "text-3xl font-bold" : "text-2xl font-semibold"
            )}
          >
            {wear}%
          </span>
          <span
            className={cn(
              "flex items-center gap-1 text-xs font-medium tracking-wide uppercase",
              meta.text
            )}
          >
            <Icon className="size-3.5" />
            {meta.label}
          </span>
        </div>

        <Progress.Root value={Math.min(wear, 100)}>
          <ProgressTrack className="bg-neutral-200">
            <ProgressIndicator className={meta.dot} />
          </ProgressTrack>
        </Progress.Root>

        <p className="text-sm text-neutral-500">
          {message ??
            `${wear}% de vida útil consumida · límite estimado ${formatKm(component.max_km)} km.`}
        </p>

        {status === "critical" && (
          <span className="inline-flex w-fit items-center gap-1.5 border border-status-critical/40 bg-status-critical/10 px-3 py-1 text-[10px] font-medium tracking-widest text-status-critical uppercase">
            Agendar cambio
          </span>
        )}
        {status === "exhausted" && (
          <span className="inline-flex w-fit items-center gap-1.5 bg-status-critical px-3 py-1 text-[10px] font-medium tracking-widest text-background uppercase">
            Pieza agotada
          </span>
        )}
      </CardContent>
    </Card>
  );
}

async function DrivetrainSection() {
  const bike = await getPrimaryBike();
  const components = bike?.components ?? [];

  if (components.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-medium text-neutral-900">Transmisión</CardTitle>
          <CardDescription className={eyebrow}>
            Sin componentes registrados todavía
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      {components.map((component) => (
        <DrivetrainComponentCard key={component.id} component={component} />
      ))}
    </div>
  );
}

function DrivetrainSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-32" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-8 w-14" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-1 w-full rounded-full" />
            <Skeleton className="h-4 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

async function WattsTaxCard() {
  const activities = await getRecentActivities(8);
  const activity = activities[0];

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
              <span className="flex items-center gap-1 font-medium text-status-warning">
                <ArrowDownRight className="size-3.5" />
                {Math.round(activity.watts_lost)} W perdidos
              </span>
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

        <Suspense fallback={null}>
          <WorkshopAlertsBanner />
        </Suspense>

        <Suspense fallback={<BikeHeroSkeleton />}>
          <BikeHeroCard />
        </Suspense>

        <Suspense fallback={<DrivetrainSkeleton />}>
          <DrivetrainSection />
        </Suspense>

        <Suspense fallback={<RideHistorySkeleton />}>
          <RideHistorySection />
        </Suspense>

        <Suspense fallback={<WattsTaxSkeleton />}>
          <WattsTaxCard />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

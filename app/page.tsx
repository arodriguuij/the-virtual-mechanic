import { Progress } from "@base-ui/react/progress";
import {
  ArrowDownRight,
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
import { CalibrationDialog } from "@/components/calibration-dialog";
import { DashboardShell } from "@/components/dashboard-shell";
import {
  type BikeWithComponents,
  getPrimaryBike,
  getProfile,
  getRecentActivities,
} from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";
import { LUBRICANT_LIMIT_KM, type LubricantType } from "@/lib/wear-model";

export const dynamic = "force-dynamic";

const eyebrow = "text-[10px] font-medium tracking-widest text-neutral-600 uppercase";
const statLabel = "text-[10px] font-medium tracking-widest text-neutral-600 uppercase";
const statValue = "text-2xl font-semibold text-neutral-900 tabular-nums";

type WearStatus = "optimal" | "warning" | "critical" | "exhausted";

// Tires turn critical earlier than the rest of the garage (80% vs. 85%) —
// a thin-tread tire is a puncture/blowout risk well before it's "used up"
// the way a chain or a rotor is.
const CRITICAL_THRESHOLD_OVERRIDES: Record<string, number> = {
  tire_front: 80,
  tire_rear: 80,
};
const DEFAULT_CRITICAL_THRESHOLD = 85;

function wearStatus(pct: number, componentType?: string): WearStatus {
  if (pct >= 100) return "exhausted";
  const criticalThreshold =
    (componentType ? CRITICAL_THRESHOLD_OVERRIDES[componentType] : undefined) ??
    DEFAULT_CRITICAL_THRESHOLD;
  if (pct >= criticalThreshold) return "critical";
  if (pct >= 60) return "warning";
  return "optimal";
}

const TIRE_TYPES = new Set(["tire_front", "tire_rear"]);

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
  disc_pad: "Pastillas",
  disc_rotor: "Discos",
  rim_pad: "Zapatas",
  wheel_rim: "Llanta",
  tire_front: "Neumático delantero",
  tire_rear: "Neumático trasero",
};

const lubricantLabels: Record<LubricantType, string> = {
  oil: "Aceite tradicional",
  liquid_wax: "Cera líquida",
  hot_wax: "Cera en caliente",
};

/** Null for `optimal` — nothing worth saying yet. */
function getWearMessage(
  status: WearStatus,
  componentType: string,
  wearPercentage: number
): string | null {
  if (TIRE_TYPES.has(componentType)) {
    if (status === "exhausted") {
      return "¡PELIGRO DE REVENTÓN! Neumático completamente plano. Riesgo estructural para tu seguridad en marcha.";
    }
    if (wearPercentage >= 90) {
      return "Riesgo de pinchazo: MUY ALTO. Probabilidad crítica de quedar tirado por cámara pellizcada o destalonamiento.";
    }
    if (wearPercentage >= 80) {
      return "Riesgo de pinchazo: ALTO. La banda de rodadura está muy delgada. Sutil riesgo de cortes bajando puertos.";
    }
    if (status === "warning") {
      return "Rendimiento óptimo, vigilar en las próximas salidas.";
    }
    return null;
  }

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
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="pt-6 pl-6 sm:py-6 sm:pl-8">
          {/* eslint-disable-next-line @next/next/no-img-element -- local
              static asset, fixed intrinsic size, no responsive/optimization
              needs that would justify next/image here. */}
          <img
            src="/images/scott-addict.webp"
            alt={bike ? `${bike.brand} ${bike.model}` : "Scott Addict 30"}
            className="h-16 w-auto object-contain md:h-20"
          />
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
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="pt-6 pl-6 sm:py-6 sm:pl-8">
          <Skeleton className="h-16 w-24 md:h-20" />
        </div>
        <CardContent className="flex flex-1 flex-col justify-center gap-3 py-6 pl-0 sm:pl-2">
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
    .map((component) => ({
      component,
      status: wearStatus(component.current_wear_percentage, component.type),
    }))
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
              {getWearMessage(status, component.type, component.current_wear_percentage)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Replaces the per-card "Estimado / Certificado" badges with a single global
 * readout — how much of the bike's wear data comes from real physics
 * simulation (`certified`) vs. a manual estimate (`estimated`). Rounds down
 * so the score never claims more confidence than it has.
 */
async function DigitalTwinConfidenceCard() {
  const bike = await getPrimaryBike();
  const components = bike?.components ?? [];
  const total = components.length;
  const certified = components.filter((c) => c.status_type === "certified").length;
  const score = total > 0 ? Math.floor((certified / total) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-medium text-neutral-900">
          Precisión del Gemelo Digital
        </CardTitle>
        <CardDescription className={eyebrow}>
          {certified} de {total} componentes con simulación física certificada
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <span className="text-3xl font-semibold text-neutral-900 tabular-nums">{score}%</span>
        <Progress.Root value={score}>
          <ProgressTrack className="bg-neutral-200">
            <ProgressIndicator className="bg-neutral-900" />
          </ProgressTrack>
        </Progress.Root>
        <p className="text-xs text-neutral-500">
          Tu precisión aumentará a medida que instales componentes nuevos desde cero con la
          app.
        </p>
      </CardContent>
    </Card>
  );
}

function DigitalTwinConfidenceSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-3 w-64" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-1 w-full rounded-full" />
        <Skeleton className="h-3 w-full" />
      </CardContent>
    </Card>
  );
}

type LubricationInfo = {
  lubricantType: LubricantType;
  kmsSinceLastLube: number;
  limitKm: number;
  ratio: number;
  isOverdue: boolean;
  isWashedOut: boolean;
  statusLabel: string;
};

/**
 * A rain wash-out jumps `kms_since_last_lube` to *exactly* the lubricant's
 * limit (see `getNextKmsSinceLastLube` in `lib/wear-model.ts`); ordinary
 * riding almost never lands on that precise value given real-world
 * fractional ride distances, so exact equality is a reliable enough signal
 * to tell "washed out by rain" apart from "just organically overdue"
 * without a dedicated status column.
 */
function getLubricationInfo(
  lubricantType: LubricantType | null,
  kmsSinceLastLube: number | null
): LubricationInfo {
  const type = lubricantType ?? "oil";
  const kms = kmsSinceLastLube ?? 0;
  const limitKm = LUBRICANT_LIMIT_KM[type];
  const isOverdue = kms >= limitKm;
  const isWashedOut = kms === limitKm;
  const statusLabel = isWashedOut
    ? "Lavada por lluvia"
    : isOverdue
      ? "Cadena seca"
      : `${formatKm(limitKm - kms)} km para relubricar`;

  return {
    lubricantType: type,
    kmsSinceLastLube: kms,
    limitKm,
    ratio: Math.min((kms / limitKm) * 100, 100),
    isOverdue,
    isWashedOut,
    statusLabel,
  };
}

function DrivetrainComponentCard({
  component,
}: {
  component: BikeWithComponents["components"][number];
}) {
  const wear = component.current_wear_percentage;
  const status = wearStatus(wear, component.type);
  const meta = statusMeta[status];
  const Icon = meta.icon;
  const message = getWearMessage(status, component.type, wear);
  const severe = status === "critical" || status === "exhausted";
  const label = componentTypeLabels[component.type] ?? component.type;
  const lubrication =
    component.type === "chain"
      ? getLubricationInfo(component.lubricant_type, component.kms_since_last_lube)
      : null;

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

        {lubrication && (
          <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className={eyebrow}>
                Propulsión: {lubricantLabels[lubrication.lubricantType]}
              </span>
              {lubrication.isOverdue && (
                <span className="text-[10px] font-medium tracking-widest text-status-critical uppercase">
                  {lubrication.statusLabel}
                </span>
              )}
            </div>
            <Progress.Root value={lubrication.ratio}>
              <ProgressTrack className="bg-neutral-200">
                <ProgressIndicator
                  className={lubrication.isOverdue ? "bg-status-critical" : "bg-neutral-900"}
                />
              </ProgressTrack>
            </Progress.Root>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-neutral-500">
                {lubrication.isOverdue
                  ? lubrication.statusLabel
                  : `${formatKm(lubrication.kmsSinceLastLube)} / ${formatKm(lubrication.limitKm)} km`}
              </span>
              <form action="/api/components/lube" method="POST">
                <input type="hidden" name="componentId" value={component.id} />
                <button
                  type="submit"
                  className="text-[10px] font-medium tracking-widest text-neutral-500 uppercase transition-colors hover:text-neutral-900"
                >
                  Lubricar cadena
                </button>
              </form>
            </div>
          </div>
        )}

        <div className="border-t border-neutral-200 pt-3">
          <CalibrationDialog
            componentId={component.id}
            componentType={component.type}
            componentName={label}
            currentLubricantType={component.lubricant_type}
          />
        </div>
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
          <CardTitle className="font-medium text-neutral-900">Componentes</CardTitle>
          <CardDescription className={eyebrow}>
            Sin componentes registrados todavía
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {components.map((component) => (
        <DrivetrainComponentCard key={component.id} component={component} />
      ))}
    </div>
  );
}

function DrivetrainSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 7 }).map((_, i) => (
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
  wrong_bike:
    "La última actividad de Strava está registrada con otra bicicleta y se ha descartado sin aplicar desgaste.",
};

const calibrationErrorMessages: Record<string, string> = {
  missing_fields: "Faltan datos para calibrar la pieza.",
  not_found: "No se encontró el componente a calibrar.",
  invalid_km: "Introduce un número de kilómetros válido.",
  invalid_gauge: "Selecciona una lectura válida del medidor de desgaste.",
  gauge_not_supported: "El medidor de desgaste físico solo aplica a la cadena.",
  invalid_method: "Selecciona un método de calibración.",
  update_blocked_by_rls: "No se pudo guardar la calibración: RLS bloqueó el UPDATE.",
};

const lubeErrorMessages: Record<string, string> = {
  missing_fields: "Faltan datos para procesar la lubricación.",
  not_found: "No se encontró el componente.",
  not_a_chain: "La lubricación solo aplica a la cadena.",
  invalid_lubricant_type: "Selecciona un tipo de lubricante válido.",
  update_blocked_by_rls: "No se pudo guardar: RLS bloqueó el UPDATE.",
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

  const calibrationErrorCode = params.calibration_error;
  const calibrationError =
    typeof calibrationErrorCode === "string"
      ? (calibrationErrorMessages[calibrationErrorCode] ??
        "No se pudo completar la calibración.")
      : null;

  const lubeErrorCode = params.lube_error;
  const lubeError =
    typeof lubeErrorCode === "string"
      ? (lubeErrorMessages[lubeErrorCode] ?? "No se pudo completar la operación de lubricación.")
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

        {calibrationError && (
          <div className="flex items-center gap-2 border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-sm text-status-warning">
            <TriangleAlert className="size-4 shrink-0" />
            {calibrationError}
          </div>
        )}

        {lubeError && (
          <div className="flex items-center gap-2 border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-sm text-status-warning">
            <TriangleAlert className="size-4 shrink-0" />
            {lubeError}
          </div>
        )}

        <Suspense fallback={<DigitalTwinConfidenceSkeleton />}>
          <DigitalTwinConfidenceCard />
        </Suspense>

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

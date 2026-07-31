"use client";

import {
  AlarmClock,
  CalendarDays,
  ChevronDown,
  Copy,
  Download,
  Droplet,
  FlaskConical,
  Fuel,
  Lock,
  MapPin,
  Pencil,
  RefreshCw,
  Send,
  TrendingDown,
  TriangleAlert,
  Upload,
  Utensils,
  Zap,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { stripEmoji } from "@/lib/gpx-export";
import { parseGpxFile, type ParsedGpxRoute } from "@/lib/gpx-import";
import { decodePolyline } from "@/lib/polyline";
import { refreshStravaRoutes } from "@/lib/strava-actions";
import { WeatherImpactCard } from "@/components/weather-impact-card";
import { FuelingContextTooltips } from "@/components/fueling-context-tooltip";
import { InfoTooltip } from "@/components/info-tooltip";
import { ProfileRequiredBanner } from "@/components/profile-required-banner";
import {
  fieldClass,
  flatMobileCardClass,
  primaryButtonClass,
  secondaryButtonClass,
  selectableFieldClass,
  selectChevronClass,
} from "@/lib/ui-classes";
import {
  calculateHouseholdMeasures,
  formatGarminExportText,
  formatRecipeForSharing,
  getPocketFoodTotalCarbsG,
  getTableSaltGrams,
  HYPERTONIC_THRESHOLD_PCT,
  intensityLabels,
  pocketFoodCarbsG as POCKET_FOOD_CARBS_G,
  pocketFoodLabels,
  type FuelingMode,
  type IntensityLevel,
  type PocketFoodItemType,
  type PocketFoodSelection,
} from "@/lib/metabolic-engine";
import type { StravaRoute } from "@/lib/strava-routes";

// Assumed pace when the athlete has no Strava ride history to derive a real
// average speed from (brand-new account, or Strava never connected) — a
// plausible "typical road ride" pace, not a personalized figure; the UI
// flags this explicitly so the athlete knows to double-check the estimate.
const FALLBACK_AVG_SPEED_KMH = 25;

// Leaflet reads `window`/`document` at module scope, which breaks Next's
// server render pass — `ssr: false` is what actually prevents that, not
// just this file's own top-level `"use client"` (every client component
// still renders once on the server for the initial HTML unless its import
// is wrapped like this).
const RouteMapPreview = dynamic(
  () => import("@/components/route-map-preview").then((mod) => mod.RouteMapPreview),
  {
    ssr: false,
    loading: () => <Skeleton className="mt-3 h-48 w-full rounded-sm" />,
  }
);

function formatHoursMinutes(hours: number): string {
  const totalMinutes = Math.round(Math.max(0, hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")} h ${String(m).padStart(2, "0")} min`;
}

const POCKET_FOOD_TYPES: PocketFoodItemType[] = ["banana", "energy_bar", "rice_cake", "dates", "gummies"];
const GEL_DOSE_TYPES: PocketFoodItemType[] = ["gel_small", "gel_standard", "gel_high"];
const ALL_POCKET_FOOD_TYPES: PocketFoodItemType[] = [...POCKET_FOOD_TYPES, ...GEL_DOSE_TYPES];
const MAX_POCKET_FOOD_QTY = 6;
const MAX_CUSTOM_CARBS_G = 500;

const FUELING_MODE_OPTIONS: { value: FuelingMode; label: string }[] = [
  { value: "optimal", label: "Óptimo" },
  { value: "inventory", label: "Mi Inventario" },
  { value: "hybrid", label: "Híbrido" },
];

const FUELING_MODE_DESCRIPTIONS: Record<FuelingMode, string> = {
  optimal:
    "Estrategia de alta eficiencia digestiva recomendada para rendimiento: formulada únicamente con bidón de hidratación y geles de rápida absorción.",
  inventory:
    "Selecciona los productos disponibles en tu inventario personal — el bidón casero ajustará su concentración para cubrir el déficit.",
  hybrid:
    "Fija tus alimentos imprescindibles — te sugerimos geles o bidón para cubrir la brecha restante.",
};
// Offline fallback for "en medio de un puerto sin cobertura" — the last
// successfully calculated strategy, so the athlete still has *something*
// actionable instead of a blank/broken screen with no signal.
const LAST_FUELING_STRATEGY_KEY = "last_fueling_strategy";

/** Plain, no-emoji name for the pocket-food matrix — `pocketFoodLabels` keeps
 * its friendly emoji-prefixed copy for the clipboard/GPX exports, this derives
 * the clean-label variant from the same source at render time. */
function pocketFoodName(type: PocketFoodItemType): string {
  return stripEmoji(pocketFoodLabels[type]);
}

const eyebrow = "text-[10px] font-mono uppercase tracking-widest text-zinc-500";
const statLabel = "text-[10px] sm:text-xs font-mono tracking-wider text-neutral-500 uppercase truncate";
const statValue = "font-mono text-xl font-semibold text-neutral-900 tabular-nums sm:text-2xl";
// Shared with every other field/button across the app (`lib/ui-classes.ts`) —
// aliased to these file-local names since they're already used at every
// input/select/date call site below.
const inputClass = fieldClass;
const selectableInputClass = selectableFieldClass;
// Shared sizing/typography/shape for every 3-column segmented control in
// this file (Salida's Hoy/Mañana/Elegir fecha, the Ruta/Calculadora/GPX mode
// toggle, Estrategia nutricional's Óptimo/Mi Inventario/Híbrido) — rectangular
// buttons (PNS editorial style), not a pill/track, so each call site only
// adds its own active/inactive color ternary via `cn()`, not the shape/
// sizing rules — a narrow-viewport fix to one can't silently drift from the
// other two. A real `border` (color supplied per call site's own ternary —
// see each one's own comment) is back on the base class: this app's
// briefly-tried "zero-border" pass removed it in favor of pure background-
// fill differentiation, reversed on a later, explicit request for the
// inactive/secondary state to read as a clearly bordered, shadow-free
// control again — `shadow-none` stays explicit here for the same reason,
// even though no shadow utility was ever actually applied. Sentence case,
// not uppercase/mono — these are real UI actions ("Ruta Strava", "Hoy",
// "Óptimo"), not technical data labels (see `eyebrow` for that convention).
// `min-w-0` is what lets a CSS grid column actually shrink below its
// content's natural width — a grid item defaults to `min-width: auto`,
// which would otherwise force the column (and the whole row) wider than its
// share of the grid instead of ever truncating.
const segmentedButtonClass =
  "flex h-9 w-full min-w-0 cursor-pointer items-center justify-center rounded-sm border px-1 text-center text-xs font-medium shadow-none transition-colors duration-150 sm:px-3 sm:text-sm";
// Applied to the label text itself, not the button — `overflow-hidden`/
// `text-ellipsis` on a `flex items-center justify-center` button clips
// symmetrically from *both* sides of the centered content (verified live:
// "Mi Inventario" rendered as the nonsensical "i Inventario" at 320px), since
// the flex box centers the overflow before ever clipping it. Tailwind's
// `truncate` utility on a `block w-full` child instead gives the label its
// own left-aligned single-line box to truncate against, so an overflow
// always reads as "Mi Inventari…" — a real ellipsis at the end, never a
// garbled double-sided clip — while non-overflowing labels stay visually
// centered exactly as before (there's no slack for `text-center` to act on
// once the label is genuinely truncated).
const segmentedButtonLabelClass = "block w-full truncate";
// "Salida" quick-select: a day pill (Hoy/Mañana) plus a plain hour `<select>`
// replaces the old `datetime-local` input — that native control's per-browser
// chrome (and iOS Safari's multi-segment month/day/year/hour/minute/AM-PM
// rendering in particular) was more precision than a rider picking "tomorrow
// morning" actually needs, and needed its own overflow-defense classes to
// avoid forcing the field wider than its grid column on a narrow phone. Hour
// options cover the range a rider would plausibly start a ride at.
const DEPARTURE_HOUR_OPTIONS = [
  "05:00", "06:00", "07:00", "08:00", "09:00", "10:00",
  "11:00", "12:00", "13:00", "14:00", "15:00", "16:00",
  "17:00", "18:00", "19:00", "20:00",
];

const INTENSITY_OPTIONS: IntensityLevel[] = [
  "recovery",
  "endurance",
  "tempo",
  "threshold",
  "vo2max",
];

// Calculadora's own "Tipo de Entreno" selector — a structured session's
// *average* watts routinely understates its real metabolic cost (an
// interval set spends real time well above that average), so naming the
// session type lets the server derive glycogen burn from a proper named
// intensity band (`getRelativeIntensityFromLevel`) instead of the
// watts-derived one — see `POST /api/fueling/plan`'s quick-mode branch.
// Optional: a steady-state ride with no name still calculates fine from
// watts alone, same as before this selector existed.
type StructuredWorkoutType = "z2" | "z3" | "z4z5" | "competition";
const STRUCTURED_WORKOUT_OPTIONS: { value: StructuredWorkoutType; label: string; intensity: IntensityLevel }[] = [
  { value: "z2", label: "Fondo (Z2)", intensity: "endurance" },
  { value: "z3", label: "Tempo (Z3)", intensity: "tempo" },
  { value: "z4z5", label: "Series / Intervalos (Z4-Z5)", intensity: "vo2max" },
  { value: "competition", label: "Competición", intensity: "threshold" },
];

type PlanResult = {
  durationHours: number;
  carbsGPerHour: number;
  sodiumMgPerHour: number;
  fluidLossMlPerHour: number;
  recipe: {
    maltodextrinG: number;
    fructoseG: number;
    sodiumMg: number;
    waterMl: number;
    totalCarbsG: number;
  };
  totalRideCarbsG: number;
  pocketFood: Partial<Record<PocketFoodItemType, number>> & { customCarbsG?: number };
  pocketFoodCarbsG: number;
  fuelingMode: FuelingMode;
  hybridGelSuggestion: number | null;
  weather: {
    temperatureC: number;
    temperatureMaxC: number | null;
    humidityPct: number;
    windSpeedKmh: number;
    source: "dynamic" | "planning_default" | "seasonal_average";
    multiPointSample: boolean;
    lapseRateAdjustmentC: number;
  };
  gutTraining: {
    isGutLimited: boolean;
    gutCapGPerHour: number;
    uncappedGPerHour: number;
  };
  bottlePlan: {
    bottleSizeMl: number;
    fuelBottles: {
      count: number;
      maltodextrinGPerBottle: number;
      fructoseGPerBottle: number;
      sodiumMgPerBottle: number;
      concentrationPct: number;
    };
    waterBottles: { count: number };
  };
  reloadStrategy: {
    startingBottleCount: number;
    ziplocBagsCount: number;
    ziplocDose: { maltodextrinG: number; fructoseG: number; sodiumMg: number };
    reloadAtKm: number | null;
    reloadAtHours: number;
    isImpractical: boolean;
  } | null;
  nutritionMilestones: {
    label: string;
    atKm: number | null;
    atHours: number;
  }[];
  timingTimeline: {
    hydrationIntervalMinutes: number;
    entries: {
      type: "solid" | "gel" | "caffeine";
      label: string;
      atFractionOfRide: number;
      atMinutes: number;
      atKm: number | null;
    }[];
  };
  netCarbDeficit: {
    estimatedBurnG: number;
    plannedIntakeG: number;
    netDeficitG: number;
  };
  carbLoading: {
    minCarbsG: number;
    maxCarbsG: number;
    guidelines: string[];
  } | null;
};

type DepartureDayMode = "today" | "tomorrow" | "custom";

const DEPARTURE_DAY_MODE_OPTIONS: { value: DepartureDayMode; label: string }[] = [
  { value: "today", label: "Hoy" },
  { value: "tomorrow", label: "Mañana" },
  { value: "custom", label: "Elegir fecha" },
];

/** `YYYY-MM-DD` for today — the `<input type="date">`'s `min` (no planning
 * into the past) and the initial value when switching into "Elegir fecha". */
function todayIsoDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Combines a day mode (today/tomorrow/a specific `YYYY-MM-DD`) and an
 * "HH:mm" hour selection into the local datetime string the calculation
 * request expects. Planning a ride weeks or months out (an event, a trip)
 * is exactly what "Elegir fecha" is for — unlike the two quick pills, it
 * isn't bounded to the next day. */
function buildDepartureLocal(dayMode: DepartureDayMode, customDate: string, hour: string): string {
  const date =
    dayMode === "custom" && customDate ? new Date(`${customDate}T00:00:00`) : new Date();
  if (dayMode === "tomorrow") date.setDate(date.getDate() + 1);
  const [h, m] = hour.split(":").map(Number);
  date.setHours(h, m, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function DeparturePicker({
  dayMode,
  onDayModeChange,
  customDate,
  onCustomDateChange,
  hour,
  onHourChange,
}: {
  dayMode: DepartureDayMode;
  onDayModeChange: (mode: DepartureDayMode) => void;
  customDate: string;
  onCustomDateChange: (date: string) => void;
  hour: string;
  onHourChange: (hour: string) => void;
}) {
  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-2">
      <span className={eyebrow}>Fecha y hora de salida</span>
      <div className="grid grid-cols-3 gap-2">
        {DEPARTURE_DAY_MODE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onDayModeChange(opt.value)}
            className={cn(
              segmentedButtonClass,
              dayMode === opt.value
                ? "border-transparent bg-terracotta text-white"
                : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400"
            )}
          >
            <span className={segmentedButtonLabelClass}>{opt.label}</span>
          </button>
        ))}
      </div>
      {dayMode === "custom" && (
        <input
          type="date"
          aria-label="Fecha de salida"
          min={todayIsoDate()}
          value={customDate}
          onChange={(e) => onCustomDateChange(e.target.value)}
          className={fieldClass}
        />
      )}
      <div className="relative">
        <select
          aria-label="Hora de salida"
          className={selectableFieldClass}
          value={hour}
          onChange={(e) => onHourChange(e.target.value)}
        >
          {DEPARTURE_HOUR_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <ChevronDown className={selectChevronClass} />
      </div>
    </div>
  );
}

function PocketFoodStepperRow({
  type,
  qty,
  onChange,
  disabled = false,
}: {
  type: PocketFoodItemType;
  qty: number;
  onChange: (qty: number) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        // One consistent list-row treatment at every breakpoint — a thin
        // `border-zinc-100` divider, `last:border-b-0` so the final item
        // doesn't carry a trailing rule. Replaces an earlier "full border
        // box at md:" variant (this row sat in a plain `border-b`-only list
        // on mobile, but gained a `md:border` full box once the grid became
        // 2 columns) — that asymmetry read as two different components at
        // different widths; a uniform list row is simpler and matches every
        // other list treatment in this app. `py-2.5` is strictly symmetric
        // (Tailwind's `py-*` always sets top and bottom equally) — the
        // original imbalance bug traced back to *switching* padding values
        // across breakpoints (`py-2.5` mobile / `md:py-1.5` desktop, paired
        // with a border-b-only-vs-full-border switch too), not to `2.5`
        // itself; a single flat `py-2.5` at every width (down from an
        // intermediate `py-3.5`, per a later "reduce and equalize" request)
        // is just as symmetric and reads as a tighter, less congested list.
        "flex items-center justify-between gap-2 border-b border-zinc-100 py-2.5 last:border-b-0",
        disabled && "opacity-50"
      )}
    >
      <span className="text-sm text-neutral-900">
        {pocketFoodName(type)}
        <span className="ml-1.5 font-mono text-xs text-neutral-500">
          {POCKET_FOOD_CARBS_G[type]}g HC
        </span>
      </span>
      {/* Compact, transparent, delineated stepper — a hairline
          `border-zinc-200` is what defines this control now (the prior
          `bg-zinc-100` solid fill was dropped in favor of a clean outline on
          a transparent background), reduced to `h-7`/`min-w-[80px]` and
          tighter `px-2 py-0.5` so it reads as a small compact widget rather
          than a full-size button. `rounded-sm` — a later "radio de bordes
          pequeño global" pass reversed this control's earlier `rounded-full`
          capsule geometry (itself a deliberate exception to every other
          selector's `rounded-lg`) back to the same flat, technical
          `rounded-sm` every other selector in the app now shares, so the
          stepper no longer reads as a categorically different control type. */}
      <div className="flex h-7 min-w-20 items-center justify-between rounded-sm border border-zinc-200 bg-transparent px-2 py-0.5">
        <button
          type="button"
          onClick={() => onChange(qty - 1)}
          disabled={disabled}
          className="flex size-5 cursor-pointer items-center justify-center text-sm leading-none font-normal text-zinc-600 transition-colors hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Quitar ${pocketFoodLabels[type]}`}
        >
          −
        </button>
        <span className="min-w-4 px-1 text-center font-sans text-xs font-medium text-zinc-800 tabular-nums">
          {qty}
        </span>
        <button
          type="button"
          onClick={() => onChange(qty + 1)}
          disabled={disabled}
          className="flex size-5 cursor-pointer items-center justify-center text-sm leading-none font-normal text-zinc-600 transition-colors hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Añadir ${pocketFoodLabels[type]}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function FuelingPlanner({
  routes,
  avgSpeedKmh,
  isProfileComplete,
}: {
  routes: StravaRoute[];
  avgSpeedKmh: number | null;
  isProfileComplete: boolean;
}) {
  const [mode, setMode] = useState<"route" | "quick" | "gpx">(routes.length > 0 ? "route" : "quick");
  const [selectedRouteId, setSelectedRouteId] = useState(routes[0]?.id ?? "");
  const [gpxUploadOpen, setGpxUploadOpen] = useState(false);
  const [intensity, setIntensity] = useState<IntensityLevel>("endurance");
  // No pre-filled defaults — the athlete must explicitly enter a real
  // duration/watts pair rather than silently calculating against whatever
  // placeholder happened to be in the field.
  const [quickHoursInput, setQuickHoursInput] = useState("");
  const [quickMinutesInput, setQuickMinutesInput] = useState("");
  const [quickAverageWattsInput, setQuickAverageWattsInput] = useState("");
  const [structuredWorkoutType, setStructuredWorkoutType] = useState<StructuredWorkoutType | "">("");
  const [departureDayMode, setDepartureDayMode] = useState<DepartureDayMode>("tomorrow");
  const [departureCustomDate, setDepartureCustomDate] = useState(todayIsoDate);
  const [departureHour, setDepartureHour] = useState("08:00");
  const departureLocal = useMemo(
    () => buildDepartureLocal(departureDayMode, departureCustomDate, departureHour),
    [departureDayMode, departureCustomDate, departureHour]
  );
  const [isTargetEvent, setIsTargetEvent] = useState(false);
  const [pocketFood, setPocketFood] = useState<Partial<Record<PocketFoodItemType, number>>>({});
  const [customCarbsG, setCustomCarbsG] = useState(0);
  const [fuelingMode, setFuelingMode] = useState<FuelingMode>("inventory");
  const [result, setResult] = useState<PlanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [exportCopied, setExportCopied] = useState(false);
  const [downloadingGpx, setDownloadingGpx] = useState(false);
  const [isOfflineCache, setIsOfflineCache] = useState(false);
  const [parsedGpx, setParsedGpx] = useState<ParsedGpxRoute | null>(null);
  const [gpxDurationHours, setGpxDurationHours] = useState(2);
  const [gpxError, setGpxError] = useState<string | null>(null);
  const [isDraggingGpx, setIsDraggingGpx] = useState(false);
  const [refreshingRoutes, setRefreshingRoutes] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Bypasses `getStravaRoutes()`'s 24h cache (see `lib/dashboard-data.ts`) on
  // demand — an athlete who just starred a new route on Strava shouldn't
  // have to wait up to a day for it to show up here.
  async function handleRefreshRoutes() {
    setRefreshingRoutes(true);
    try {
      await refreshStravaRoutes();
      router.refresh();
    } finally {
      setRefreshingRoutes(false);
    }
  }

  // Derived from the 3 raw text inputs above — `0` (not `NaN`) for a blank
  // field, so `quickValid` below cleanly reads "not entered yet" rather than
  // a broken calculation. Horas + Minutos combine into one decimal-hours
  // figure, same unit `handleCalculate`'s request body always expected.
  const quickHoursNum = Number(quickHoursInput) || 0;
  const quickMinutesNum = Number(quickMinutesInput) || 0;
  const quickDurationHours = quickHoursNum + quickMinutesNum / 60;
  const quickAverageWatts = Number(quickAverageWattsInput) || 0;
  const quickValid = quickDurationHours > 0 && quickAverageWatts > 0;

  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === selectedRouteId) ?? null,
    [routes, selectedRouteId]
  );
  // Decoded once per route change, not on every render — a long ride's
  // polyline can be a few hundred points.
  const selectedRoutePoints = useMemo(
    () => (selectedRoute?.summaryPolyline ? decodePolyline(selectedRoute.summaryPolyline) : null),
    [selectedRoute]
  );

  // "Conversión Dinámica a Medidas Caseras" — recomputed from the last
  // calculated result whenever it changes; cheap pure arithmetic, no memo
  // needed.
  const recipeMeasures = result
    ? calculateHouseholdMeasures({
        saltG: getTableSaltGrams(result.recipe.sodiumMg),
        maltodextrinG: result.recipe.maltodextrinG,
        fructoseG: result.recipe.fructoseG,
      })
    : null;
  const fuelBottleMeasures = result
    ? calculateHouseholdMeasures({
        saltG: getTableSaltGrams(result.bottlePlan.fuelBottles.sodiumMgPerBottle),
        maltodextrinG: result.bottlePlan.fuelBottles.maltodextrinGPerBottle,
        fructoseG: result.bottlePlan.fuelBottles.fructoseGPerBottle,
      })
    : null;
  const ziplocMeasures = result?.reloadStrategy
    ? calculateHouseholdMeasures({
        saltG: getTableSaltGrams(result.reloadStrategy.ziplocDose.sodiumMg),
        maltodextrinG: result.reloadStrategy.ziplocDose.maltodextrinG,
        fructoseG: result.reloadStrategy.ziplocDose.fructoseG,
      })
    : null;

  // Accordion header preview for "Comida de bolsillo" — in Óptimo mode the
  // selection is server-computed (only known once `result` comes back), so
  // that takes priority over the athlete's own local (disabled) steppers.
  const effectivePocketFood: PocketFoodSelection =
    fuelingMode === "optimal" ? (result?.pocketFood ?? {}) : { ...pocketFood, customCarbsG };
  const pocketFoodItemCount =
    Object.entries(effectivePocketFood).reduce(
      (sum, [key, qty]) => (key === "customCarbsG" ? sum : sum + (qty ?? 0)),
      0
    ) + (effectivePocketFood.customCarbsG && effectivePocketFood.customCarbsG > 0 ? 1 : 0);
  const pocketFoodCarbsPreview = getPocketFoodTotalCarbsG(effectivePocketFood);

  // "Modo Cobertura Limitada" — if the athlete opens the app with no
  // connection at all (mid-climb, no signal), load the last strategy that
  // did calculate successfully rather than showing an empty planner.
  useEffect(() => {
    function loadCachedStrategyIfOffline() {
      if (typeof navigator === "undefined" || navigator.onLine) return;
      try {
        const cached = localStorage.getItem(LAST_FUELING_STRATEGY_KEY);
        if (!cached) return;
        setResult(JSON.parse(cached));
        setIsOfflineCache(true);
      } catch {
        // Corrupt/unavailable cache — just leave the planner empty, same as
        // never having calculated a strategy before.
      }
    }

    loadCachedStrategyIfOffline();
    window.addEventListener("offline", loadCachedStrategyIfOffline);
    return () => window.removeEventListener("offline", loadCachedStrategyIfOffline);
  }, []);

  // A freshly calculated strategy renders below the fold on most phones —
  // without this, "Calcular estrategia" appears to do nothing until the
  // athlete notices they need to scroll down themselves.
  useEffect(() => {
    if (result) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  function setPocketFoodQty(type: PocketFoodItemType, qty: number) {
    setPocketFood((prev) => ({ ...prev, [type]: Math.max(0, Math.min(MAX_POCKET_FOOD_QTY, qty)) }));
  }

  async function handleGpxFile(file: File) {
    setGpxError(null);
    try {
      const text = await file.text();
      const parsed = parseGpxFile(text, file.name);
      if (!parsed) {
        setParsedGpx(null);
        setGpxError("No se pudo leer el archivo — comprueba que sea un .gpx válido.");
        return;
      }
      setParsedGpx(parsed);
      const speed = avgSpeedKmh && avgSpeedKmh > 0 ? avgSpeedKmh : FALLBACK_AVG_SPEED_KMH;
      setGpxDurationHours(Math.round((parsed.distanceKm / speed) * 100) / 100);
      // A successful upload makes the GPX the active route source — the
      // Strava selector resets/clears rather than sitting alongside it, so
      // there's only ever one route "in play" at a time.
      setMode("gpx");
      setSelectedRouteId("");
      setGpxUploadOpen(false);
    } catch {
      setParsedGpx(null);
      setGpxError("No se pudo leer el archivo — comprueba que sea un .gpx válido.");
    }
  }

  async function handleCalculate() {
    setLoading(true);
    setError(null);
    try {
      const departureIso = new Date(departureLocal).toISOString();
      const pocketFoodPayload = { ...pocketFood, customCarbsG };
      const body =
        mode === "route" && selectedRoute
          ? {
              mode: "route",
              departureIso,
              distanceKm: selectedRoute.distanceKm,
              elevationGainM: selectedRoute.elevationGainM,
              startLat: selectedRoute.startLat,
              startLng: selectedRoute.startLng,
              endLat: selectedRoute.endLat,
              endLng: selectedRoute.endLng,
              routeId: selectedRoute.id,
              intensity,
              isTargetEvent,
              pocketFood: pocketFoodPayload,
              fuelingMode,
            }
          : mode === "gpx" && parsedGpx
            ? {
                mode: "route",
                departureIso,
                distanceKm: parsedGpx.distanceKm,
                elevationGainM: parsedGpx.elevationGainM,
                startLat: parsedGpx.startLat,
                startLng: parsedGpx.startLng,
                endLat: parsedGpx.endLat,
                endLng: parsedGpx.endLng,
                durationHoursOverride: gpxDurationHours,
                peakLat: parsedGpx.peakLat,
                peakLng: parsedGpx.peakLng,
                peakDistanceFraction: parsedGpx.peakDistanceFraction,
                intensity,
                isTargetEvent,
                pocketFood: pocketFoodPayload,
                fuelingMode,
              }
            : {
                mode: "quick",
                departureIso,
                durationHours: quickDurationHours,
                averageWatts: quickAverageWatts,
                // Only sent when the athlete actually named a session type —
                // a plain steady-state ride still derives intensity from
                // real watts server-side, unchanged.
                structuredIntensity: structuredWorkoutType
                  ? STRUCTURED_WORKOUT_OPTIONS.find((opt) => opt.value === structuredWorkoutType)?.intensity
                  : undefined,
                isTargetEvent,
                pocketFood: pocketFoodPayload,
                fuelingMode,
              };

      const res = await fetch("/api/fueling/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(
          data.error === "no_profile"
            ? "Configura tu perfil fisiológico antes de planificar una ruta."
            : "No se pudo calcular la estrategia de fueling."
        );
        setResult(null);
        return;
      }
      setResult(data);
      setIsOfflineCache(false);
      try {
        localStorage.setItem(LAST_FUELING_STRATEGY_KEY, JSON.stringify(data));
      } catch {
        // Private browsing / quota exceeded — the offline fallback simply
        // won't have anything to load next time, not worth failing over.
      }
    } catch {
      setError("No se pudo calcular la estrategia de fueling.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyRecipe() {
    if (!result) return;
    const text = formatRecipeForSharing({
      durationHours: result.durationHours,
      carbsGPerHour: result.carbsGPerHour,
      sodiumMgPerHour: result.sodiumMgPerHour,
      recipe: result.recipe,
      bottlePlan: result.bottlePlan,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("No se pudo copiar la receta al portapapeles.");
    }
  }

  async function handleExportGarmin() {
    if (!result) return;
    const text = formatGarminExportText({
      carbsGPerHour: result.carbsGPerHour,
      sodiumMgPerHour: result.sodiumMgPerHour,
      milestones: result.nutritionMilestones,
      reloadStrategy: result.reloadStrategy,
    });
    try {
      await navigator.clipboard.writeText(text);
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    } catch {
      setError("No se pudo copiar la ficha de nutrición al portapapeles.");
    }
  }

  async function handleDownloadGpx() {
    if (!result || !selectedRoute?.summaryPolyline) return;
    setDownloadingGpx(true);
    setError(null);
    try {
      const res = await fetch("/api/fueling/gpx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routeName: selectedRoute.name,
          summaryPolyline: selectedRoute.summaryPolyline,
        }),
      });
      if (!res.ok) throw new Error("gpx_failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedRoute.name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}.gpx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("No se pudo generar el archivo GPX.");
    } finally {
      setDownloadingGpx(false);
    }
  }

  return (
    <Card className={flatMobileCardClass}>
      <CardHeader>
        {/* `text-xl font-semibold text-zinc-900` overrides `CardTitle`'s own
            shared default (`text-sm font-bold uppercase tracking-wide`) —
            this one card's title is elevated to read like a page-level `<h1>`
            now that it houses the numbered 01/02/03 step structure below,
            matching `/perfil`'s own heavier title treatment. `mb-3` on
            mobile specifically (down from an earlier `mb-6`, part of the
            "Jerarquía de Espaciado Editorial" ultracompact pass) is still
            needed since `flatMobileCardClass` zeroes `--card-spacing` there
            and would otherwise leave the title flush against Paso 01 below
            it — `sm:` and up keeps `mb-0`, relying on the real gap
            `--card-spacing` itself already provides, so the margin cancels
            there to avoid doubling up. */}
        <CardTitle className="mb-3 text-xl font-semibold tracking-normal text-zinc-900 normal-case sm:mb-0">
          Planificador de nutrición
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* PASO 01 · Selección y origen de ruta — the mode toggle plus
            whichever source-specific fields that mode needs (Strava route
            select + map, manual duration/watts, or a GPX upload + map). Full
            white "tarjeta madre" (`bg-white`, zero border, zero shadow,
            `rounded-sm`) matching `/perfil`'s own numbered-card convention —
            see the `01 ·`/`02 ·`/`03 ·` eyebrow labels throughout this
            component. The map itself still bleeds edge-to-edge: the
            label/select/dropzone portion keeps its own `p-4 sm:p-6` padding,
            but `RouteMapPreview` is a direct sibling with none of its own,
            so it touches this card's own left/right/bottom boundary —
            `overflow-hidden` on the outer card clips the map's rectangular
            Leaflet container to match `rounded-sm`; `RouteMapPreview`'s own
            default `mt-3`/`rounded-sm` are overridden via its `className`
            prop specifically for this reason. */}
        <div className="overflow-hidden rounded-sm bg-white shadow-none">
          <div className="p-4 sm:p-6">
            <span className="font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase">
              01 · Selección y origen de ruta
            </span>

            {/* Simplified from 3 tabs to 2 — "Ruta / GPX" absorbs the old
                standalone "Subir GPX" tab as a nested secondary action
                inside the Strava-route tab instead of a third top-level
                mode, since both are really the same underlying concept ("a
                route with real geometry") differing only in *where* that
                geometry comes from. `mode` itself still has 3 internal
                values (route/quick/gpx) — everything downstream (Paso 02's
                conditionals, the map render, `handleCalculate`'s request
                body) is untouched; only this toggle and Paso 01's own
                internals changed. */}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode(parsedGpx ? "gpx" : "route")}
                className={cn(
                  segmentedButtonClass,
                  mode === "route" || mode === "gpx"
                    ? "border-transparent bg-terracotta text-white"
                    : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400"
                )}
              >
                <span className={segmentedButtonLabelClass}>Ruta / GPX</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("quick")}
                className={cn(
                  segmentedButtonClass,
                  mode === "quick"
                    ? "border-transparent bg-terracotta text-white"
                    : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400"
                )}
              >
                <span className={segmentedButtonLabelClass}>Calculadora</span>
              </button>
            </div>

            {(mode === "route" || mode === "gpx") && (
              <div className="mt-4">
                {mode === "gpx" && parsedGpx ? (
                  // A GPX has been uploaded and is the active route source —
                  // the Strava selector is hidden entirely (not just cleared)
                  // while it's active, so there's only ever one visible
                  // "current route" at a time.
                  <div className="flex items-center justify-between gap-3 rounded-sm bg-[#F8F7F5] px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900">{parsedGpx.name}</p>
                      <p className="font-mono text-xs text-zinc-500">
                        {parsedGpx.distanceKm}km · {parsedGpx.elevationGainM}m D+
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setParsedGpx(null);
                        setGpxError(null);
                        setMode("route");
                        setSelectedRouteId(routes[0]?.id ?? "");
                      }}
                      className="shrink-0 cursor-pointer text-[11px] font-semibold tracking-widest text-zinc-500 uppercase transition-colors duration-150 hover:text-zinc-900"
                    >
                      Quitar GPX
                    </button>
                  </div>
                ) : (
                  <>
                    {routes.length > 0 ? (
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <label htmlFor="route" className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase">
                            Ruta
                          </label>
                          <button
                            type="button"
                            onClick={handleRefreshRoutes}
                            disabled={refreshingRoutes}
                            title="Recargar rutas desde Strava"
                            className="flex cursor-pointer items-center gap-1 text-[10px] font-mono tracking-widest text-zinc-500 uppercase transition-colors duration-150 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <RefreshCw className={cn("size-3", refreshingRoutes && "animate-spin")} />
                            {refreshingRoutes ? "Sincronizando…" : "Recargar"}
                          </button>
                        </div>
                        {/* The select's own background/native arrow render
                            unconditionally — a refresh never swaps this control for
                            a generic loading block. While `refreshingRoutes` is
                            true, it's simply disabled with one muted placeholder
                            option plus a micro-spinner overlaid to its own left of
                            the chevron, so the control's shape never jumps. A
                            porcelain `bg-[#F8F7F5]` fill (not this app's usual
                            white `selectableFieldClass`) marks this one select as a
                            sub-block nested *inside* the now-white card — zero
                            border either way, matching this app's 100%-frameless
                            convention. */}
                        <div className="relative mt-1.5">
                          <select
                            id="route"
                            className={cn(
                              "w-full cursor-pointer appearance-none rounded-sm border-0 bg-[#F8F7F5] px-4 py-2 pr-9 text-sm font-sans text-zinc-900 transition-colors duration-150 hover:bg-[#F1EEE7] focus:outline-none focus:ring-1 focus:ring-terracotta",
                              refreshingRoutes && "text-zinc-400"
                            )}
                            value={refreshingRoutes ? "__syncing" : selectedRouteId}
                            onChange={(e) => setSelectedRouteId(e.target.value)}
                            disabled={refreshingRoutes}
                          >
                            {refreshingRoutes ? (
                              <option value="__syncing" className="font-mono text-xs text-neutral-400">
                                Sincronizando rutas de Strava...
                              </option>
                            ) : (
                              routes.map((route) => (
                                <option key={route.id} value={route.id}>
                                  {route.name} · {route.distanceKm}km · {route.elevationGainM}m D+
                                </option>
                              ))
                            )}
                          </select>
                          {refreshingRoutes ? (
                            <span
                              className="pointer-events-none absolute top-1/2 right-9 size-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700"
                              aria-hidden="true"
                            />
                          ) : (
                            <ChevronDown className={selectChevronClass} />
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-start gap-2 border border-dashed border-neutral-300 px-4 py-3">
                        <p className="text-sm text-neutral-500">
                          Sin rutas en Strava — usa la calculadora rápida o sube un GPX.
                        </p>
                        <button
                          type="button"
                          onClick={handleRefreshRoutes}
                          disabled={refreshingRoutes}
                          className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold tracking-widest text-neutral-600 uppercase transition-colors duration-150 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <RefreshCw className={cn("size-3.5", refreshingRoutes && "animate-spin")} />
                          {refreshingRoutes ? "Sincronizando…" : "Buscar rutas de nuevo"}
                        </button>
                      </div>
                    )}

                    {/* Compact secondary action — GPX upload is nested here
                        rather than a third top-level tab, since uploading a
                        file is just an alternate way of arriving at the same
                        "route with real geometry" this whole card is about. */}
                    <button
                      type="button"
                      onClick={() => setGpxUploadOpen((v) => !v)}
                      className="mt-2 flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase transition-colors duration-150 hover:text-zinc-900"
                    >
                      <Upload className="size-3.5" />
                      {gpxUploadOpen ? "Cancelar" : "+ Subir GPX"}
                    </button>

                    {gpxUploadOpen && (
                      <div className="mt-2">
                        <div
                          onDragOver={(e) => {
                            e.preventDefault();
                            setIsDraggingGpx(true);
                          }}
                          onDragLeave={() => setIsDraggingGpx(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setIsDraggingGpx(false);
                            const file = e.dataTransfer.files?.[0];
                            if (file) handleGpxFile(file);
                          }}
                          className={cn(
                            "flex flex-col items-center justify-center gap-2 border-2 border-dashed px-4 py-8 text-center transition-colors duration-150",
                            isDraggingGpx ? "border-neutral-900 bg-neutral-50" : "border-neutral-300"
                          )}
                        >
                          <Upload className="size-5 text-neutral-400" />
                          <p className="text-sm text-neutral-600">
                            Arrastra tu archivo .gpx aquí, o{" "}
                            <label
                              htmlFor="gpx-upload"
                              className="cursor-pointer font-semibold text-neutral-900 underline underline-offset-2"
                            >
                              selecciona un archivo
                            </label>
                          </p>
                          <input
                            id="gpx-upload"
                            type="file"
                            accept=".gpx"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleGpxFile(file);
                            }}
                          />
                        </div>
                        {gpxError && <p className="mt-2 text-sm text-status-warning">{gpxError}</p>}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {mode === "quick" && (
              <div className="mt-4 flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-2">
                    <label htmlFor="duration-hours" className={eyebrow}>
                      Duración — Horas
                    </label>
                    <input
                      id="duration-hours"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      placeholder="0"
                      className={inputClass}
                      value={quickHoursInput}
                      onChange={(e) => setQuickHoursInput(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="duration-minutes" className={eyebrow}>
                      Duración — Minutos
                    </label>
                    <input
                      id="duration-minutes"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={59}
                      step={5}
                      placeholder="0"
                      className={inputClass}
                      value={quickMinutesInput}
                      onChange={(e) => setQuickMinutesInput(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="watts" className={eyebrow}>
                      Vatios objetivo
                    </label>
                    <input
                      id="watts"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      placeholder="Sin definir"
                      className={inputClass}
                      value={quickAverageWattsInput}
                      onChange={(e) => setQuickAverageWattsInput(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="structured-workout" className={cn(eyebrow, "flex items-center")}>
                    Intensidad objetivo / Tipo de entreno
                    <InfoTooltip
                      label="Contexto sobre entrenamientos estructurados"
                      note="En series o intervalos los vatios medios globales no reflejan la intensidad real de los esfuerzos duros. Indicar el tipo de entreno corrige el cálculo de quemado de glucógeno para que se base en la intensidad real, no solo en el promedio."
                    />
                  </label>
                  <div className="relative">
                    <select
                      id="structured-workout"
                      className={selectableInputClass}
                      value={structuredWorkoutType}
                      onChange={(e) => setStructuredWorkoutType(e.target.value as StructuredWorkoutType | "")}
                    >
                      <option value="">Ritmo constante (usar solo vatios)</option>
                      {STRUCTURED_WORKOUT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className={selectChevronClass} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {mode === "route" && routes.length > 0 && (
            <RouteMapPreview
              points={selectedRoutePoints}
              distanceKm={selectedRoute?.distanceKm ?? null}
              elevationGainM={selectedRoute?.elevationGainM ?? null}
              className="mt-0 rounded-none"
            />
          )}
          {mode === "gpx" && (
            <RouteMapPreview
              points={parsedGpx?.points ?? null}
              distanceKm={parsedGpx?.distanceKm ?? null}
              elevationGainM={parsedGpx?.elevationGainM ?? null}
              className="mt-0 rounded-none"
            />
          )}
        </div>

        {/* PASO 02 · Condiciones de la salida — Intensidad Objetivo (Sub-
            sección A, skipped in Calculadora mode since real watts already
            *is* the intensity input there) and Fecha y Hora de Salida (Sub-
            sección B, every mode). One flat white "tarjeta madre," no nested
            sub-cards — `gap-3` alone separates the sub-sections ("Jerarquía
            de Espaciado Editorial": related controls sitting side by side
            get the tighter `space-y-3` scale, not the looser `gap-5` this
            used to carry). The `mt-2` right under the eyebrow (down from
            `mt-4`) is that same pass's "título numerado → primer campo"
            micro-spacing rule. */}
        <div className="rounded-sm bg-white p-4 sm:p-6 shadow-none">
          <span className="font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase">
            02 · Condiciones de la salida
          </span>

          {mode === "route" && (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label htmlFor="intensity" className={eyebrow}>
                  Intensidad objetivo
                </label>
                <div className="relative">
                  <select
                    id="intensity"
                    className={selectableInputClass}
                    value={intensity}
                    onChange={(e) => setIntensity(e.target.value as IntensityLevel)}
                  >
                    {INTENSITY_OPTIONS.map((level) => (
                      <option key={level} value={level}>
                        {intensityLabels[level]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className={selectChevronClass} />
                </div>
              </div>
              <DeparturePicker
                dayMode={departureDayMode}
                onDayModeChange={setDepartureDayMode}
                customDate={departureCustomDate}
                onCustomDateChange={setDepartureCustomDate}
                hour={departureHour}
                onHourChange={setDepartureHour}
              />
            </div>
          )}

          {mode === "quick" && (
            <div className="mt-2 grid grid-cols-1 gap-3">
              <DeparturePicker
                dayMode={departureDayMode}
                onDayModeChange={setDepartureDayMode}
                customDate={departureCustomDate}
                onCustomDateChange={setDepartureCustomDate}
                hour={departureHour}
                onHourChange={setDepartureHour}
              />
            </div>
          )}

          {mode === "gpx" && !parsedGpx && (
            <p className="mt-2 text-xs text-neutral-500">
              Sube un archivo GPX en el Paso 01 para configurar la intensidad y la fecha de
              salida.
            </p>
          )}

          {mode === "gpx" && parsedGpx && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <label htmlFor="intensity-gpx" className={eyebrow}>
                    Intensidad objetivo
                  </label>
                  <div className="relative">
                    <select
                      id="intensity-gpx"
                      className={selectableInputClass}
                      value={intensity}
                      onChange={(e) => setIntensity(e.target.value as IntensityLevel)}
                    >
                      {INTENSITY_OPTIONS.map((level) => (
                        <option key={level} value={level}>
                          {intensityLabels[level]}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className={selectChevronClass} />
                  </div>
                </div>
                <DeparturePicker
                  dayMode={departureDayMode}
                  onDayModeChange={setDepartureDayMode}
                  customDate={departureCustomDate}
                  onCustomDateChange={setDepartureCustomDate}
                  hour={departureHour}
                  onHourChange={setDepartureHour}
                />
                <div className="flex flex-col gap-2">
                  <label htmlFor="gpx-duration" className={eyebrow}>
                    <Pencil className="mr-1 inline size-3" />
                    Tiempo estimado (editar)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="gpx-duration"
                      type="number"
                      inputMode="decimal"
                      min={0.25}
                      step={0.25}
                      className={inputClass}
                      value={gpxDurationHours}
                      onChange={(e) => setGpxDurationHours(Math.max(0.25, Number(e.target.value) || 0))}
                    />
                    <span className="font-mono text-xs whitespace-nowrap text-neutral-500">
                      {formatHoursMinutes(gpxDurationHours)}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-neutral-500">
                {avgSpeedKmh
                  ? `Estimado a tu ritmo medio real de Strava (${Math.round(avgSpeedKmh)}km/h) — edítalo si lo necesitas.`
                  : `Sin historial de Strava suficiente — estimación genérica a ${FALLBACK_AVG_SPEED_KMH}km/h, ajusta el tiempo manualmente.`}
              </p>
            </div>
          )}
        </div>

        {/* PASO 03 · Estrategia y comida en bolsillo — Óptimo/Mi Inventario/
            Híbrido plus its own subtle explanatory legend, with the
            objetivo/cubierto/déficit breakdown and the "Comida en bolsillo"
            accordion integrated directly into this same card (no separate
            nested white box — they're porcelain `bg-[#F8F7F5]` sub-blocks
            living straight inside this already-white "tarjeta madre" now,
            same flat-hierarchy convention as PASO 02 above). */}
        <div className="rounded-sm bg-white p-4 sm:p-6 shadow-none">
          {/* Sub-bloque A: Selector de Estrategia — its own explicit margins
              (not a shared flex `gap-*`) so the title→buttons→description
              rhythm matches the "Separación Estructurada" spec exactly:
              title `mb-3`, buttons `mb-2.5`, description `mb-6` — that last,
              more generous gap is what visually separates this whole
              sub-block from Sub-bloque B (the inventory) below it, fixing a
              reported "elementos amontonados" complaint where the mode
              selector, its legend, and the inventory header used to read as
              one undifferentiated cluster. */}
          <span className="mb-3 block font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase">
            03 · Estrategia y comida en bolsillo
          </span>

          <div className="mb-2.5 grid grid-cols-3 gap-2">
            {FUELING_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFuelingMode(opt.value)}
                className={cn(
                  segmentedButtonClass,
                  fuelingMode === opt.value
                    ? "border-transparent bg-terracotta text-white"
                    : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400"
                )}
              >
                <span className={segmentedButtonLabelClass}>{opt.label}</span>
              </button>
            ))}
          </div>
          <p className="mb-6 text-xs font-mono text-zinc-500">
            {FUELING_MODE_DESCRIPTIONS[fuelingMode]}
          </p>

          {/* "Cabecera de Inventario & Métricas" + "Aviso de Estado" now live
              *inside* the same `<details>` as the food list, directly below
              its `<summary>` header row — previously the objetivo/cubierto/
              déficit breakdown floated as its own heavy box *above* this
              whole accordion (a separate 3-column colored grid + progress
              bar), disconnected from "Comida en bolsillo"'s own header/
              counter one step below it. Consolidating both into one
              continuous block — mode selector → inventory header+counter →
              status banner → food list — makes the relationship between the
              chosen Estrategia and the inventory immediately legible instead
              of reading as two loosely-adjacent sections. `key={fuelingMode}`
              forces a full remount whenever the athlete switches Estrategia
              nutricional — that's what makes `open` actually re-apply as a
              fresh initial value each time, instead of React's own
              prop-diffing silently skipping the DOM write because the
              previous render already had the same `open` value. Óptimo mode
              is the one case with nothing for the athlete to configure here
              (it's server-computed), so it's the only one that starts
              collapsed; Mi Inventario/Híbrido both start open, since those
              are exactly the two modes where this list is the athlete's own
              input, not just a preview. Once mounted, the athlete can freely
              collapse or reopen it without this forcing it back — only an
              actual mode switch does that. */}
          <details key={fuelingMode} open={fuelingMode !== "optimal"} className="group mt-6">
            <summary className="flex list-none cursor-pointer items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
              <span className="font-mono text-xs font-bold tracking-wider text-neutral-900 uppercase">
                Comida en bolsillo
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-[11px] whitespace-nowrap text-neutral-500">
                  {pocketFoodItemCount} items seleccionados · {pocketFoodCarbsPreview}g HC
                </span>
                <ChevronDown className="size-4 shrink-0 text-neutral-400 transition-transform duration-150 group-open:rotate-180" />
              </span>
            </summary>
            <div className="pt-3">
              {/* Aviso de Estado / Desglose Integrado — a discreet, single-
                  tone porcelain banner (no colored labels, no progress bar)
                  replacing the old heavy floating box, directly under the
                  inventory header it now describes. `mb-4` (up from an
                  earlier `mb-2`) is a deliberately plain margin here, not a
                  flex `gap-*` on the parent (removed) — the "Separación
                  Estructurada" pass asked for an explicit ≥16px gap before
                  the first food row specifically, not whatever a shared
                  flex gap happened to add on top of it. */}
              {/* Structured white card (bg-white rounded-xl p-4 shadow-none)
                  per an explicit later request — a deliberate, scoped
                  exception to both this app's usual `rounded-sm` radius
                  scale and its "porcelain sub-block nested inside a white
                  card" convention (this block sits inside Paso 03's own
                  already-white card). A hairline border is added on top of
                  the literal spec (which named `shadow-none`, not "no
                  border") — without one, a white block with zero shadow
                  floating inside an equally-white parent would be visually
                  indistinguishable from it, defeating the "estructurada"
                  half of the request. */}
              {result ? (
                (() => {
                  const restanteG = Math.max(0, result.totalRideCarbsG - result.pocketFoodCarbsG);
                  return (
                    <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 text-xs font-mono text-zinc-600 shadow-none">
                      OBJETIVO {result.totalRideCarbsG}g HC · CUBIERTO {result.pocketFoodCarbsG}g HC ·
                      RESTANTE {restanteG}g HC
                    </div>
                  );
                })()
              ) : (
                <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 text-xs font-mono text-zinc-600 shadow-none">
                  Calcula tu estrategia para ver el desglose objetivo / cubierto / restante.
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                {fuelingMode === "optimal" && (
                  <p className="text-xs text-neutral-500">
                    Automático — solo geles y bidón en modo Óptimo, sin alimentos sólidos.
                  </p>
                )}
                {/* `gap-0`/`md:gap-y-0` — each `PocketFoodStepperRow` (and the
                    "Personalizado" row) already draws its own `border-b
                    border-zinc-100 py-2.5` divider, so a grid `gap-3` on top
                    of that was double-spacing every row: a real gutter *and*
                    the row's own padding both adding vertical distance. Only
                    `md:gap-x-4` survives, purely to keep the 2-column
                    desktop layout's side-by-side items from touching
                    horizontally — vertical rhythm between rows is entirely
                    the rows' own border+padding now, at every breakpoint. */}
                <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-x-4 md:gap-y-0">
                  {(fuelingMode === "optimal" ? GEL_DOSE_TYPES : ALL_POCKET_FOOD_TYPES).map((type) => (
                    <PocketFoodStepperRow
                      key={type}
                      type={type}
                      qty={
                        fuelingMode === "optimal"
                          ? (result?.pocketFood[type] ?? 0)
                          : (pocketFood[type] ?? 0)
                      }
                      onChange={(qty) => setPocketFoodQty(type, qty)}
                      disabled={fuelingMode === "optimal"}
                    />
                  ))}
                  {fuelingMode !== "optimal" && (
                    <div className="flex items-center justify-between gap-2 border-b border-zinc-100 py-2.5 last:border-b-0">
                      <label htmlFor="custom-carbs" className="text-sm text-neutral-900">
                        Personalizado
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          id="custom-carbs"
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={MAX_CUSTOM_CARBS_G}
                          value={customCarbsG || ""}
                          onChange={(e) => setCustomCarbsG(Math.max(0, Number(e.target.value) || 0))}
                          placeholder="0"
                          className="w-16 rounded-sm border border-neutral-300 bg-white px-2 py-1 text-right font-mono text-sm text-neutral-900 shadow-sm outline-none hover:border-neutral-400 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                        />
                        <span className="font-mono text-xs text-neutral-500">g HC</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </details>
        </div>

        {/* Final CTA — sits after all 3 numbered steps, not inside any of
            them, matching `/perfil`'s own "single full-width action button
            after the numbered cards" convention. The "Ruta objetivo /
            Competición" checkbox sits strictly *above* the button now
            (previously beside it in the same row) — it's an input that
            changes what the button's own click computes, so it reads more
            naturally as "one more thing to configure before you press
            calculate" than as a peer alongside the action itself. */}
        <div className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={isTargetEvent}
              onChange={(e) => setIsTargetEvent(e.target.checked)}
              className="size-3.5 cursor-pointer accent-terracotta"
            />
            Ruta objetivo / Competición
          </label>
          {isTargetEvent && (
            <p className="text-[11px] text-neutral-500">
              Ajusta la pauta al máximo límite de absorción intestinal (hasta 120g/h) y
              aplica un ratio Fructosa:Maltodextrina de 1:0.8 optimizado para alta
              intensidad.
            </p>
          )}
          <button
            type="button"
            onClick={handleCalculate}
            disabled={
              loading ||
              !isProfileComplete ||
              (mode === "route" && !selectedRoute) ||
              (mode === "gpx" && !parsedGpx) ||
              (mode === "quick" && !quickValid)
            }
            className={cn(
              "w-full py-3.5 text-sm",
              isProfileComplete
                ? primaryButtonClass
                : "inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-sm bg-neutral-200 px-4 font-mono text-xs font-semibold tracking-wider text-neutral-400 uppercase"
            )}
          >
            {isProfileComplete ? (
              <>
                <Zap className="size-4 shrink-0" />
                {loading ? "Calculando…" : "Calcular estrategia nutricional"}
              </>
            ) : (
              <>
                <Lock className="size-4 shrink-0" />
                Calcular estrategia (requiere perfil completo)
              </>
            )}
          </button>
          {isProfileComplete && mode === "quick" && !quickValid && (
            <p className="text-[11px] text-neutral-500">
              Introduce una duración y unos vatios objetivo válidos para poder calcular.
            </p>
          )}
          {!isProfileComplete && <ProfileRequiredBanner />}
        </div>

        {error && <p className="text-sm text-status-warning">{error}</p>}

        {result && (
          <div ref={resultRef} className="flex scroll-mt-20 flex-col gap-4 border-t border-neutral-200 pt-4">
            {isOfflineCache && (
              <div className="flex items-center gap-1.5 border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700">
                <Zap className="size-3.5 shrink-0" />
                Estrategia guardada en caché (Modo Offline)
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={eyebrow}>Estrategia de bolsillo &amp; receta casera</span>
            </div>

            <div className="mb-2 flex flex-col gap-3 rounded-sm bg-[#343334] p-5 text-white shadow-none">
              <div>
                <span className="font-mono text-[10px] tracking-widest text-neutral-400 uppercase">
                  Dosis casera por bidón
                </span>
                <p className="mt-1.5 font-mono text-xl font-bold text-[#FD5A08]">
                  {result.bottlePlan.fuelBottles.count > 0
                    ? `${result.bottlePlan.fuelBottles.maltodextrinGPerBottle}g Malto + ${result.bottlePlan.fuelBottles.fructoseGPerBottle}g Fructosa + ${getTableSaltGrams(result.bottlePlan.fuelBottles.sodiumMgPerBottle)}g Sal`
                    : "Cobertura completa vía comida de bolsillo"}
                </p>
              </div>
              <div className="flex flex-col gap-1.5 border-t border-white/10 pt-3 text-xs text-neutral-300">
                <span className="flex items-center gap-1.5">
                  <Droplet className="size-3.5 shrink-0 text-neutral-400" />
                  1 trago cada {result.timingTimeline.hydrationIntervalMinutes} min ({result.carbsGPerHour} g/h HC · {result.sodiumMgPerHour} mg/h Sodio)
                </span>
                <span className="flex items-center gap-1.5">
                  <TrendingDown className="size-3.5 shrink-0 text-neutral-400" />
                  Déficit neto:{" "}
                  {result.netCarbDeficit.netDeficitG > 0
                    ? `-${result.netCarbDeficit.netDeficitG}`
                    : `+${Math.abs(result.netCarbDeficit.netDeficitG)}`}{" "}
                  g HC
                </span>
              </div>
            </div>

            <WeatherImpactCard
              temperatureC={result.weather.temperatureC}
              temperatureMaxC={result.weather.temperatureMaxC}
              humidityPct={result.weather.humidityPct}
              windSpeedKmh={result.weather.windSpeedKmh}
              source={result.weather.source}
              multiPointSample={result.weather.multiPointSample}
              lapseRateAdjustmentC={result.weather.lapseRateAdjustmentC}
              fluidLossMlPerHour={result.fluidLossMlPerHour}
              sodiumMgPerHour={result.sodiumMgPerHour}
            />

            <div className="my-4 grid w-full grid-cols-3 gap-1 text-center sm:gap-4 sm:text-left">
              <div className="flex min-w-0 flex-col items-center gap-1 sm:items-start">
                <span className={statLabel}>Duración</span>
                <span className={statValue}>
                  {result.durationHours}
                  <span className="ml-1 text-sm font-normal text-neutral-500">h</span>
                </span>
              </div>
              <div className="flex min-w-0 flex-col items-center gap-1 sm:items-start">
                <span className="flex min-w-0 items-center justify-center sm:justify-start">
                  <span className={statLabel}>
                    <span className="sm:hidden">Carbos</span>
                    <span className="hidden sm:inline">Carbohidratos</span>
                  </span>
                  <FuelingContextTooltips carbsGPerHour={result.carbsGPerHour} />
                </span>
                <span className={statValue}>
                  {result.carbsGPerHour}
                  <span className="ml-1 text-sm font-normal text-neutral-500">g/h</span>
                </span>
              </div>
              <div className="flex min-w-0 flex-col items-center gap-1 sm:items-start">
                <span className={statLabel}>Sodio</span>
                <span className={statValue}>
                  {result.sodiumMgPerHour}
                  <span className="ml-1 text-sm font-normal text-neutral-500">mg/h</span>
                </span>
              </div>
            </div>

            {result.gutTraining.isGutLimited && (
              <p className="border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
                Tu intestino está limitado a {result.gutTraining.gutCapGPerHour} g/h (esta ruta
                pediría {result.gutTraining.uncappedGPerHour} g/h). Activa el protocolo de Gut
                Training para subir de nivel gradualmente.
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 rounded-sm bg-[#F8F7F5] px-3 py-3 sm:grid-cols-3 sm:gap-4">
              <div className="flex flex-col gap-1">
                <span className={eyebrow}>Gasto estimado de HC</span>
                <span className="font-mono text-sm font-semibold text-neutral-900 tabular-nums">
                  {result.netCarbDeficit.estimatedBurnG} g
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className={eyebrow}>Ingesta planificada</span>
                <span className="font-mono text-sm font-semibold text-neutral-900 tabular-nums">
                  {result.netCarbDeficit.plannedIntakeG} g
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className={eyebrow}>Déficit neto al finalizar</span>
                <span
                  className={cn(
                    "flex items-center gap-1.5 font-mono text-sm font-semibold tabular-nums",
                    result.netCarbDeficit.netDeficitG > 0 ? "text-status-warning" : "text-status-good"
                  )}
                >
                  <TrendingDown className="size-3.5 shrink-0" />
                  {result.netCarbDeficit.netDeficitG > 0
                    ? `-${result.netCarbDeficit.netDeficitG}`
                    : `+${Math.abs(result.netCarbDeficit.netDeficitG)}`}{" "}
                  g
                </span>
              </div>
            </div>

            <details className="group rounded-sm bg-[#F8F7F5]">
              <summary className="flex list-none cursor-pointer flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-1.5">
                  <ChevronDown className="size-3.5 shrink-0 text-neutral-400 transition-transform duration-150 group-open:rotate-180" />
                  <span className={eyebrow}>
                    Receta de laboratorio casero · {result.durationHours} h
                  </span>
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyRecipe();
                  }}
                  className={cn(secondaryButtonClass, "w-fit shrink-0 px-2.5 py-1.5 text-[10px]")}
                >
                  {copied ? (
                    "✓ Receta copiada"
                  ) : (
                    <>
                      <Copy className="size-3" />
                      Copiar receta
                    </>
                  )}
                </button>
              </summary>
              <div className="border-t border-neutral-200 p-3">
              {result.pocketFoodCarbsG > 0 && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-neutral-500">
                  <Utensils className="mt-0.5 size-3 shrink-0" />
                  Comida de bolsillo cubre {result.pocketFoodCarbsG}g de {result.totalRideCarbsG}g HC —
                  el resto ({result.recipe.totalCarbsG}g) va en el bidón.
                </p>
              )}
              {result.fuelingMode === "hybrid" && (result.hybridGelSuggestion ?? 0) > 0 && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-neutral-500">
                  <FlaskConical className="mt-0.5 size-3 shrink-0" />
                  Alternativa: {result.hybridGelSuggestion} gel{result.hybridGelSuggestion === 1 ? "" : "es"}{" "}
                  estándar (30g c/u) cubrirían la brecha en vez del bidón — o deja que el bidón la
                  absorba, como ya hace la receta de abajo.
                </p>
              )}
              <div className="mt-2 flex flex-col gap-1.5 text-sm text-neutral-700">
                <div className="flex items-center justify-between">
                  <span>Maltodextrina</span>
                  <span className="font-mono font-medium text-neutral-900 tabular-nums">
                    {result.recipe.maltodextrinG} g{" "}
                    <span className="text-xs font-normal text-neutral-500">
                      (~{recipeMeasures!.maltodextrinScoops} cazos)*
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Fructosa</span>
                  <span className="font-mono font-medium text-neutral-900 tabular-nums">
                    {result.recipe.fructoseG} g{" "}
                    <span className="text-xs font-normal text-neutral-500">
                      (~{recipeMeasures!.fructoseScoops} cazos)*
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Sal común</span>
                  <span className="font-mono font-medium text-neutral-900 tabular-nums">
                    {getTableSaltGrams(result.recipe.sodiumMg)} g{" "}
                    <span className="text-xs font-normal text-neutral-500">
                      (~{recipeMeasures!.saltTeaspoons} cdta. café)*
                    </span>
                  </span>
                </div>
                <p className="text-xs text-neutral-500">
                  Aporta {result.recipe.sodiumMg}mg de sodio puro — la sal común solo es ~39.3%
                  sodio, así que se pesa en sal, no en sodio.
                </p>
                <div className="flex items-center justify-between">
                  <span>Agua</span>
                  <span className="font-mono font-medium text-neutral-900 tabular-nums">
                    {result.recipe.waterMl} ml
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-neutral-400">
                  *Equivalencias de referencia: 1 cazo = 30 g de polvo | 1 cdta. de café = 5 g de
                  sal.
                </p>
              </div>

              <div className="mt-3 border-t border-neutral-200 pt-3">
                <span className={eyebrow}>
                  Arquitectura de bidones ({result.bottlePlan.bottleSizeMl}ml · ≤8% concentración)
                </span>
                <div className="mt-2 flex flex-col gap-1.5 text-sm text-neutral-700">
                  {result.bottlePlan.fuelBottles.count > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="flex items-center gap-1.5">
                        <FlaskConical className="size-3.5 shrink-0 text-neutral-500" />
                        {result.bottlePlan.fuelBottles.count > 1 ? "Bidones" : "Bidón"} Fuel
                        Concentrado × {result.bottlePlan.fuelBottles.count}
                      </span>
                      <span className="font-mono text-xs text-neutral-500">
                        {result.bottlePlan.fuelBottles.maltodextrinGPerBottle}g malto (~
                        {fuelBottleMeasures!.maltodextrinScoops} cazos) ·{" "}
                        {result.bottlePlan.fuelBottles.fructoseGPerBottle}g fruct (~
                        {fuelBottleMeasures!.fructoseScoops} cazos) ·{" "}
                        {getTableSaltGrams(result.bottlePlan.fuelBottles.sodiumMgPerBottle)}g sal
                        común (~{fuelBottleMeasures!.saltTeaspoons} cdta.) / bidón
                      </span>
                    </div>
                  )}
                  {result.bottlePlan.waterBottles.count > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="flex items-center gap-1.5">
                        <Droplet className="size-3.5 shrink-0 text-neutral-500" />
                        {result.bottlePlan.waterBottles.count > 1 ? "Bidones" : "Bidón"} Agua /
                        Electrolitos × {result.bottlePlan.waterBottles.count}
                      </span>
                      <span className="text-xs text-neutral-500">a demanda</span>
                    </div>
                  )}
                </div>
              </div>

              {result.bottlePlan.fuelBottles.concentrationPct > HYPERTONIC_THRESHOLD_PCT && (
                <div className="mt-3 flex items-start gap-2 border border-status-warning/40 bg-status-warning/10 px-3 py-2.5 text-sm text-status-warning">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-semibold">
                      Solución hipertónica (concentración &gt; {HYPERTONIC_THRESHOLD_PCT}%)
                    </p>
                    <p className="mt-0.5 text-xs">
                      Esta mezcla ({result.bottlePlan.fuelBottles.concentrationPct}%) es
                      demasiado densa para la capacidad de tus bidones y puede ralentizar el
                      vaciado gástrico. Añade agua o traslada parte de los HC a comida de
                      bolsillo.
                    </p>
                  </div>
                </div>
              )}
              </div>
            </details>

            <details className="group rounded-sm bg-[#F8F7F5]">
              <summary className="flex list-none cursor-pointer items-center gap-1.5 p-3 [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-3.5 shrink-0 text-neutral-400 transition-transform duration-150 group-open:rotate-180" />
                <span className={eyebrow}>Cronograma dinámico de ingesta</span>
              </summary>
              <div className="border-t border-neutral-200 p-3">
                <p className="flex items-center gap-1.5 text-sm text-neutral-700">
                  <Droplet className="size-3.5 shrink-0 text-neutral-500" />
                  Bebe un trago cada{" "}
                  <span className="font-mono font-semibold text-neutral-900">
                    {result.timingTimeline.hydrationIntervalMinutes} min
                  </span>
                </p>
                {result.timingTimeline.entries.length > 0 && (
                  <ol className="mt-2 flex flex-col gap-1.5 text-sm text-neutral-700">
                    {result.timingTimeline.entries.map((entry, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        {entry.type === "solid" && (
                          <Utensils className="size-3.5 shrink-0 text-neutral-500" />
                        )}
                        {entry.type === "gel" && (
                          <Zap className="size-3.5 shrink-0 text-neutral-500" />
                        )}
                        {entry.type === "caffeine" && (
                          <FlaskConical className="size-3.5 shrink-0 text-neutral-500" />
                        )}
                        <span className="font-mono text-xs text-neutral-500">
                          {entry.atKm != null ? `Km ${entry.atKm}` : `Min ${entry.atMinutes}`}
                        </span>
                        {stripEmoji(entry.label)}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </details>

            {result.reloadStrategy && (
              <details className="group rounded-sm border border-status-warning/40 bg-status-warning/10">
                <summary className="flex list-none cursor-pointer items-center justify-between gap-2 p-3 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-status-warning uppercase">
                      <Fuel className="size-3.5 shrink-0" />
                      Estrategia de recarga en ruta
                    </span>
                    <span className="text-sm font-semibold text-neutral-900">
                      {result.reloadStrategy.startingBottleCount} bidón
                      {result.reloadStrategy.startingBottleCount > 1 ? "es" : ""} en bici +{" "}
                      {result.reloadStrategy.ziplocBagsCount} dosis de recarga en maillot
                    </span>
                  </span>
                  <ChevronDown className="size-4 shrink-0 text-status-warning transition-transform duration-150 group-open:rotate-180" />
                </summary>
                <div className="border-t border-status-warning/30 p-3 pt-2">
                  <ol className="flex flex-col gap-1 text-sm text-neutral-700">
                    <li>
                      1. Inicio de ruta: {result.reloadStrategy.startingBottleCount} bidón
                      {result.reloadStrategy.startingBottleCount > 1 ? "es" : ""} preparado
                      {result.reloadStrategy.startingBottleCount > 1 ? "s" : ""} en el cuadro.
                    </li>
                    <li>
                      2. En el maillot: lleva {result.reloadStrategy.ziplocBagsCount} bolsita
                      {result.reloadStrategy.ziplocBagsCount > 1 ? "s" : ""} Ziploc con{" "}
                      {result.reloadStrategy.ziplocDose.maltodextrinG}g malto (~
                      {ziplocMeasures!.maltodextrinScoops} cazos) +{" "}
                      {result.reloadStrategy.ziplocDose.fructoseG}g fructosa (~
                      {ziplocMeasures!.fructoseScoops} cazos) +{" "}
                      {getTableSaltGrams(result.reloadStrategy.ziplocDose.sodiumMg)}g sal común (~
                      {ziplocMeasures!.saltTeaspoons} cdta.) (dosis pre-medida por bidón).
                    </li>
                    <li className="flex items-center gap-1.5 font-medium text-neutral-900">
                      <MapPin className="size-3.5 shrink-0" />
                      Parada de recarga recomendada:{" "}
                      {result.reloadStrategy.reloadAtKm != null
                        ? `Km ${result.reloadStrategy.reloadAtKm}`
                        : `Hora ${result.reloadStrategy.reloadAtHours}`}
                    </li>
                  </ol>
                  {result.reloadStrategy.isImpractical && (
                    <p className="mt-2 flex items-start gap-1.5 border-t border-status-warning/30 pt-2 text-xs text-status-warning">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                      {result.reloadStrategy.ziplocBagsCount} recargas en ruta no es un plan
                      realista — con tus bidones de {result.bottlePlan.bottleSizeMl}ml, esta
                      estrategia necesita más carbohidratos disueltos de los que puedes llevar
                      cómodamente. Prueba con bidones de mayor capacidad o traslada más carga a
                      comida sólida/geles (modo Híbrido u Óptimo).
                    </p>
                  )}
                </div>
              </details>
            )}

            {result.carbLoading && (
              <details className="rounded-sm bg-[#F8F7F5] px-3 py-2.5">
                <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold tracking-widest text-neutral-700 uppercase">
                  <CalendarDays className="size-3.5 shrink-0" />
                  Estrategia de carga día −1 · {result.carbLoading.minCarbsG}-
                  {result.carbLoading.maxCarbsG}g HC
                </summary>
                <div className="mt-2 flex flex-col gap-1.5 text-sm text-neutral-600">
                  {result.carbLoading.guidelines.map((guideline) => (
                    <p key={guideline}>• {guideline}</p>
                  ))}
                </div>
              </details>
            )}

            <div className="flex flex-col gap-2">
              {mode === "route" && selectedRoute?.summaryPolyline ? (
                <button
                  type="button"
                  onClick={handleDownloadGpx}
                  disabled={downloadingGpx}
                  className={cn(secondaryButtonClass, "w-fit")}
                >
                  <Download className="size-3.5" />
                  {downloadingGpx ? "Generando…" : "Descargar GPX de la ruta"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleExportGarmin}
                  className={cn(secondaryButtonClass, "w-fit")}
                >
                  {exportCopied ? (
                    "✓ Ficha copiada"
                  ) : (
                    <>
                      <Send className="size-3.5" />
                      Exportar a Garmin / Wahoo / Strava
                    </>
                  )}
                </button>
              )}
              <p className="flex items-start gap-1.5 text-xs text-neutral-500">
                <AlarmClock className="mt-0.5 size-3 shrink-0" />
                Configura en tu GPS las Alertas Nativas de Comer/Beber con temporizador
                repetitivo de 15 o 20 min — el GPX de la ruta es solo para navegación.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

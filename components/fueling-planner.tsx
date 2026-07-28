"use client";

import {
  AlarmClock,
  BatteryCharging,
  CalendarDays,
  Copy,
  Download,
  Droplet,
  FlaskConical,
  Fuel,
  MapPin,
  Pencil,
  Send,
  TriangleAlert,
  Upload,
  Utensils,
  Zap,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { stripEmoji } from "@/lib/gpx-export";
import { parseGpxFile, type ParsedGpxRoute } from "@/lib/gpx-import";
import { decodePolyline } from "@/lib/polyline";
import { WeatherImpactCard } from "@/components/weather-impact-card";
import { FuelingContextTooltips } from "@/components/fueling-context-tooltip";
import {
  badgeClass,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
  selectableFieldClass,
} from "@/lib/ui-classes";
import {
  calculateHouseholdMeasures,
  formatGarminExportText,
  formatRecipeForSharing,
  getTableSaltGrams,
  HYPERTONIC_THRESHOLD_PCT,
  intensityLabels,
  pocketFoodCarbsG as POCKET_FOOD_CARBS_G,
  pocketFoodLabels,
  type FuelingMode,
  type IntensityLevel,
  type PocketFoodItemType,
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
    loading: () => <Skeleton className="mt-3 h-48 w-full rounded-lg" />,
  }
);

function formatHoursMinutes(hours: number): string {
  const totalMinutes = Math.round(Math.max(0, hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")} h ${String(m).padStart(2, "0")} min`;
}

const POCKET_FOOD_TYPES: PocketFoodItemType[] = ["banana", "energy_bar", "rice_cake", "dates"];
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
    "Selecciona los productos disponibles en tu inventario personal — el bidón DIY ajustará su concentración para cubrir el déficit.",
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

const eyebrow = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
const statLabel = "text-[10px] sm:text-xs font-mono tracking-wider text-neutral-500 uppercase truncate";
const statValue = "font-mono text-xl font-semibold text-neutral-900 tabular-nums sm:text-2xl";
// Shared with every other field/button across the app (`lib/ui-classes.ts`) —
// aliased to these file-local names since they're already used at every
// input/select/date call site below.
const inputClass = fieldClass;
const selectableInputClass = selectableFieldClass;
// `datetime-local` gets its own class list rather than sharing
// `selectableFieldClass` — iOS Safari renders this control as several
// internal segments (month/day/year/hour/minute/AM-PM) with their own
// intrinsic minimum width, which can force the field wider than its grid
// column and overflow the card's right edge on a narrow phone.
// `min-w-0`/`max-w-full`/`box-border`/`truncate` on both the input and its
// wrapper (see the three call sites below) are what actually stop that —
// `w-full` alone doesn't help, since a flex/grid item's default
// `min-width: auto` still lets its content force the item wider anyway.
const dateInputClass = cn(
  "w-full max-w-full box-border appearance-none truncate rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-xs font-sans text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 sm:text-sm",
  "cursor-pointer",
  // `datetime-local` renders its own calendar-picker icon that Tailwind can
  // only reach via the `::-webkit-calendar-picker-indicator` pseudo-element —
  // dimmed by default, full opacity on hover, so it still reads as clickable
  // without competing visually with the rest of the field.
  "[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 hover:[&::-webkit-calendar-picker-indicator]:opacity-100"
);

const INTENSITY_OPTIONS: IntensityLevel[] = [
  "recovery",
  "endurance",
  "tempo",
  "threshold",
  "vo2max",
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
  moneySaved: number;
  weather: {
    temperatureC: number;
    temperatureMaxC: number | null;
    humidityPct: number;
    windSpeedKmh: number;
    source: "dynamic" | "planning_default";
    multiPointSample: boolean;
    lapseRateAdjustmentC: number;
    thermalImpactNote: string | null;
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
  glycogenBattery: {
    glycogenStoresG: number;
    noFuel: {
      bonkOccurs: boolean;
      bonkAtHours: number | null;
      bonkAtKm: number | null;
      remainingBatteryPct: number;
    };
    withRecipe: {
      bonkOccurs: boolean;
      remainingBatteryPct: number;
    };
  };
  carbLoading: {
    minCarbsG: number;
    maxCarbsG: number;
    guidelines: string[];
  } | null;
};

/** Local datetime-local input value for "tomorrow at 08:00" — the planner's
 * default departure, before the user picks their own. */
function defaultDepartureLocal(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`;
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
        "flex items-center justify-between gap-2 border border-neutral-200 px-3 py-1.5",
        disabled && "opacity-50"
      )}
    >
      <span className="text-sm text-neutral-900">
        {pocketFoodName(type)}
        <span className="ml-1.5 font-mono text-xs text-neutral-500">
          {POCKET_FOOD_CARBS_G[type]}g HC
        </span>
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(qty - 1)}
          disabled={disabled}
          className="flex size-6 cursor-pointer items-center justify-center rounded-sm bg-neutral-100 text-sm text-neutral-600 transition-colors duration-150 hover:bg-neutral-200 hover:text-neutral-900 disabled:cursor-not-allowed disabled:hover:bg-neutral-100 disabled:hover:text-neutral-600"
          aria-label={`Quitar ${pocketFoodLabels[type]}`}
        >
          −
        </button>
        <span className="w-5 text-center font-mono text-sm font-semibold tabular-nums text-neutral-900">
          {qty}
        </span>
        <button
          type="button"
          onClick={() => onChange(qty + 1)}
          disabled={disabled}
          className="flex size-6 cursor-pointer items-center justify-center rounded-sm bg-neutral-100 text-sm text-neutral-600 transition-colors duration-150 hover:bg-neutral-200 hover:text-neutral-900 disabled:cursor-not-allowed disabled:hover:bg-neutral-100 disabled:hover:text-neutral-600"
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
}: {
  routes: StravaRoute[];
  avgSpeedKmh: number | null;
}) {
  const [mode, setMode] = useState<"route" | "quick" | "gpx">(routes.length > 0 ? "route" : "quick");
  const [selectedRouteId, setSelectedRouteId] = useState(routes[0]?.id ?? "");
  const [intensity, setIntensity] = useState<IntensityLevel>("endurance");
  const [quickDurationHours, setQuickDurationHours] = useState(2);
  const [quickAverageWatts, setQuickAverageWatts] = useState(180);
  const [departureLocal, setDepartureLocal] = useState(defaultDepartureLocal);
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
  const resultRef = useRef<HTMLDivElement>(null);

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
          distanceKm: selectedRoute.distanceKm,
          milestones: result.nutritionMilestones,
          reloadStrategy: result.reloadStrategy,
        }),
      });
      if (!res.ok) throw new Error("gpx_failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedRoute.name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}-nutricion.gpx`;
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
    <Card>
      <CardHeader>
        <CardTitle>Planificador de fueling</CardTitle>
        <CardDescription className={eyebrow}>
          Estrategia de bolsillo y receta DIY para tu próxima salida
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-neutral-100 p-1 text-[11px] font-mono">
          <button
            type="button"
            onClick={() => setMode("route")}
            className={cn(
              "cursor-pointer rounded-md px-2 py-2 font-semibold tracking-wide uppercase transition-colors duration-150",
              mode === "route"
                ? "bg-terracotta text-white shadow-sm"
                : "text-neutral-500 hover:text-neutral-900"
            )}
          >
            Ruta Strava
          </button>
          <button
            type="button"
            onClick={() => setMode("quick")}
            className={cn(
              "cursor-pointer rounded-md px-2 py-2 font-semibold tracking-wide uppercase transition-colors duration-150",
              mode === "quick"
                ? "bg-terracotta text-white shadow-sm"
                : "text-neutral-500 hover:text-neutral-900"
            )}
          >
            Calculadora
          </button>
          <button
            type="button"
            onClick={() => setMode("gpx")}
            className={cn(
              "cursor-pointer rounded-md px-2 py-2 font-semibold tracking-wide uppercase transition-colors duration-150",
              mode === "gpx"
                ? "bg-terracotta text-white shadow-sm"
                : "text-neutral-500 hover:text-neutral-900"
            )}
          >
            Subir GPX
          </button>
        </div>

        {mode === "route" ? (
          routes.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor="route" className={eyebrow}>
                  Ruta
                </label>
                <select
                  id="route"
                  className={selectableInputClass}
                  value={selectedRouteId}
                  onChange={(e) => setSelectedRouteId(e.target.value)}
                >
                  {routes.map((route) => (
                    <option key={route.id} value={route.id}>
                      {route.name} · {route.distanceKm}km · {route.elevationGainM}m D+
                    </option>
                  ))}
                </select>
                <RouteMapPreview
                  points={selectedRoutePoints}
                  distanceKm={selectedRoute?.distanceKm ?? null}
                  elevationGainM={selectedRoute?.elevationGainM ?? null}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="intensity" className={eyebrow}>
                  Intensidad objetivo
                </label>
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
              </div>
              <div className="flex w-full min-w-0 max-w-full flex-col gap-1.5 overflow-hidden">
                <label htmlFor="departure-route" className={eyebrow}>
                  Salida
                </label>
                <input
                  id="departure-route"
                  type="datetime-local"
                  className={dateInputClass}
                  value={departureLocal}
                  onChange={(e) => setDepartureLocal(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-neutral-500">
              No se encontraron rutas guardadas en Strava — usa la calculadora rápida.
            </p>
          )
        ) : mode === "quick" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="duration" className={eyebrow}>
                Duración (h)
              </label>
              <input
                id="duration"
                type="number"
                inputMode="decimal"
                min={0.5}
                step={0.5}
                className={inputClass}
                value={quickDurationHours}
                onChange={(e) => setQuickDurationHours(Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="watts" className={eyebrow}>
                Vatios objetivo
              </label>
              <input
                id="watts"
                type="number"
                inputMode="numeric"
                min={1}
                className={inputClass}
                value={quickAverageWatts}
                onChange={(e) => setQuickAverageWatts(Number(e.target.value))}
              />
            </div>
            <div className="flex w-full min-w-0 max-w-full flex-col gap-1.5 overflow-hidden">
              <label htmlFor="departure-quick" className={eyebrow}>
                Salida
              </label>
              <input
                id="departure-quick"
                type="datetime-local"
                className={dateInputClass}
                value={departureLocal}
                onChange={(e) => setDepartureLocal(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        {mode === "gpx" && (
          <div className="flex flex-col gap-4">
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
              {parsedGpx && (
                <p className="mt-1 font-mono text-xs text-neutral-500">
                  {parsedGpx.name} · {parsedGpx.distanceKm}km · {parsedGpx.elevationGainM}m D+
                </p>
              )}
            </div>

            <RouteMapPreview
              points={parsedGpx?.points ?? null}
              distanceKm={parsedGpx?.distanceKm ?? null}
              elevationGainM={parsedGpx?.elevationGainM ?? null}
            />

            {gpxError && <p className="text-sm text-status-warning">{gpxError}</p>}

            {parsedGpx && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="intensity-gpx" className={eyebrow}>
                      Intensidad objetivo
                    </label>
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
                  </div>
                  <div className="flex w-full min-w-0 max-w-full flex-col gap-1.5 overflow-hidden">
                    <label htmlFor="departure-gpx" className={eyebrow}>
                      Salida
                    </label>
                    <input
                      id="departure-gpx"
                      type="datetime-local"
                      className={dateInputClass}
                      value={departureLocal}
                      onChange={(e) => setDepartureLocal(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
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
              </>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className={eyebrow}>Modo de fueling</span>
          <div className="flex flex-wrap gap-1.5">
            {FUELING_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFuelingMode(opt.value)}
                className={cn(
                  "cursor-pointer rounded-sm border px-3 py-1.5 text-[11px] font-semibold tracking-widest uppercase transition-colors duration-150",
                  fuelingMode === opt.value
                    ? "border-terracotta bg-terracotta text-white"
                    : "border-neutral-300 text-neutral-600 hover:border-terracotta hover:text-terracotta"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-neutral-500">{FUELING_MODE_DESCRIPTIONS[fuelingMode]}</p>
        </div>

        <div className="flex flex-col gap-2 border border-neutral-200 bg-surface px-3 py-3">
          {result ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className={badgeClass}>OBJETIVO {result.totalRideCarbsG}g HC</span>
                <span className={cn(badgeClass, "border-sage/30 bg-sage/10 text-sage")}>
                  CUBIERTO {result.pocketFoodCarbsG}g HC
                </span>
                <span className={cn(badgeClass, "border-terracotta/30 bg-terracotta/10 text-terracotta")}>
                  RESTANTE {Math.max(0, result.totalRideCarbsG - result.pocketFoodCarbsG)}g HC
                </span>
              </div>
              <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-sand">
                <div
                  className="h-full bg-sage transition-all duration-300"
                  style={{
                    width:
                      result.totalRideCarbsG > 0
                        ? `${Math.min(100, (result.pocketFoodCarbsG / result.totalRideCarbsG) * 100)}%`
                        : "0%",
                  }}
                />
              </div>
            </>
          ) : (
            <span className="font-mono text-xs text-neutral-500">
              Calcula tu estrategia para ver el desglose objetivo / cubierto / restante.
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={eyebrow}>Comida de bolsillo que llevarás encima</span>
          {fuelingMode === "optimal" && (
            <p className="text-xs text-neutral-500">
              Automático — solo geles y bidón en modo Óptimo, sin alimentos sólidos.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
              <div className="flex items-center justify-between gap-2 border border-neutral-200 px-3 py-1.5">
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
                    className="w-16 border border-neutral-300 bg-background px-2 py-1 text-right font-mono text-sm text-neutral-900 outline-none focus:border-neutral-900"
                  />
                  <span className="font-mono text-xs text-neutral-500">g HC</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={handleCalculate}
            disabled={
              loading ||
              (mode === "route" && !selectedRoute) ||
              (mode === "gpx" && !parsedGpx)
            }
            className={cn(primaryButtonClass, "w-full sm:w-fit")}
          >
            {loading ? "Calculando…" : "Calcular estrategia"}
          </button>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={isTargetEvent}
              onChange={(e) => setIsTargetEvent(e.target.checked)}
              className="size-3.5 cursor-pointer accent-terracotta"
            />
            Ruta objetivo / Competición
          </label>
        </div>

        {error && <p className="text-sm text-status-warning">{error}</p>}

        {result && (
          <div ref={resultRef} className="flex flex-col gap-4 border-t border-neutral-200 pt-4">
            {isOfflineCache && (
              <div className="flex items-center gap-1.5 border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700">
                <Zap className="size-3.5 shrink-0" />
                Estrategia guardada en caché (Modo Offline)
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={eyebrow}>Estrategia de bolsillo &amp; receta DIY</span>
            </div>

            <WeatherImpactCard
              temperatureC={result.weather.temperatureC}
              temperatureMaxC={result.weather.temperatureMaxC}
              humidityPct={result.weather.humidityPct}
              windSpeedKmh={result.weather.windSpeedKmh}
              source={result.weather.source}
              multiPointSample={result.weather.multiPointSample}
              lapseRateAdjustmentC={result.weather.lapseRateAdjustmentC}
              thermalImpactNote={result.weather.thermalImpactNote}
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

            <div className="grid grid-cols-1 gap-3 border border-neutral-200 px-3 py-3 sm:grid-cols-2 sm:gap-4">
              <div className="flex flex-col gap-1">
                <span className={eyebrow}>Sin nutrir</span>
                {result.glycogenBattery.noFuel.bonkOccurs ? (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-status-critical">
                    <TriangleAlert className="size-3.5 shrink-0" />
                    Pájara
                    {result.glycogenBattery.noFuel.bonkAtKm != null
                      ? ` en el km ${result.glycogenBattery.noFuel.bonkAtKm}`
                      : ""}
                    {result.glycogenBattery.noFuel.bonkAtHours != null
                      ? ` (a las ${result.glycogenBattery.noFuel.bonkAtHours}h)`
                      : ""}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">
                    <BatteryCharging className="size-3.5 shrink-0" />
                    Sin pájara — {result.glycogenBattery.noFuel.remainingBatteryPct}% al llegar
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className={eyebrow}>Con receta DIY</span>
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-medium",
                    result.glycogenBattery.withRecipe.bonkOccurs
                      ? "text-status-critical"
                      : "text-status-good"
                  )}
                >
                  <BatteryCharging className="size-3.5 shrink-0" />
                  Batería final: {result.glycogenBattery.withRecipe.remainingBatteryPct}%
                </span>
              </div>
            </div>

            <Separator className="bg-neutral-200" />

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={eyebrow}>
                  Receta de laboratorio casero (DIY) · {result.durationHours} h
                </span>
                <button
                  type="button"
                  onClick={handleCopyRecipe}
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
              </div>
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

            <div className="border border-neutral-200 px-3 py-3">
              <span className={eyebrow}>Cronograma dinámico de ingesta</span>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-neutral-700">
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

            {result.reloadStrategy && (
              <div className="border border-status-warning/40 bg-status-warning/10 px-3 py-2.5">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-status-warning uppercase">
                  <Fuel className="size-3.5 shrink-0" />
                  Estrategia de recarga en ruta
                </span>
                <p className="mt-1.5 text-sm font-semibold text-neutral-900">
                  {result.reloadStrategy.startingBottleCount} bidón
                  {result.reloadStrategy.startingBottleCount > 1 ? "es" : ""} en bici +{" "}
                  {result.reloadStrategy.ziplocBagsCount} dosis de recarga en maillot
                </p>
                <ol className="mt-1.5 flex flex-col gap-1 text-sm text-neutral-700">
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
            )}

            <div className="flex items-center gap-2 border border-status-good/40 bg-status-good/10 px-3 py-2 text-sm text-status-good">
              <span className="font-medium">Ahorras {result.moneySaved.toFixed(2)} €</span>
              <span className="text-neutral-600">frente a geles comerciales equivalentes.</span>
            </div>

            {result.carbLoading && (
              <details className="border border-neutral-200 px-3 py-2.5">
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
                  {downloadingGpx ? "Generando…" : "Descargar GPX con avisos de nutrición"}
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
                Alertas nativas: en tu Garmin/Wahoo, configura Ajustes → Alertas → Comer/Beber
                cada 15 min, además de los avisos por GPS de este archivo.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { ChevronDown, Sun, Utensils, Zap } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { SyncForm } from "@/components/sync-button";
import {
  getBiphasicRecoveryTarget,
  getMacroRecoveryTarget,
  getRecoveryDebt,
  type IntensityLevel,
} from "@/lib/metabolic-engine";
import { cn } from "@/lib/utils";
import { primaryButtonClass } from "@/lib/ui-classes";

// Leaflet reads `window`/`document` at module scope — same `ssr: false`
// requirement as `components/fueling-planner.tsx`'s own dynamic import of
// this component, never a static one.
const RouteMapPreview = dynamic(
  () => import("@/components/route-map-preview").then((mod) => mod.RouteMapPreview),
  { ssr: false, loading: () => <Skeleton className="h-36 w-full rounded-lg md:col-span-5 md:h-52" /> }
);

// How many of the athlete's most recent synced rides the in-card "Cambiar
// salida" switcher offers — the sole way to pick which ride this analysis
// audits (the standalone "Actividad" selector + "Analizar" button above the
// card were removed once this switcher existed, to stop showing the same
// choice twice), capped at 5 so the dropdown itself stays short and scannable.
const ACTIVITY_SWITCHER_LIMIT = 5;

const eyebrow = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
const statLabel = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
const statValue = "font-mono text-xl font-semibold text-neutral-900 tabular-nums sm:text-2xl";

// A rider self-reporting effort after the fact thinks in "easy/moderate/
// hard," not the 5 finely graded levels the pre-ride planner's own target-
// power selector uses — so this RPE picker gets its own short copy even
// though it reuses the same underlying `IntensityLevel`/%FTP mapping.
const RPE_OPTIONS: { value: IntensityLevel; label: string }[] = [
  { value: "endurance", label: "Suave" },
  { value: "tempo", label: "Moderado" },
  { value: "threshold", label: "Duro" },
];

// One-tap presets for "¿Qué consumiste realmente?" — a rider reconstructing
// a ride from memory thinks in items eaten ("un gel, un bidón"), not raw
// grams, so these add fixed, illustrative real-world doses on top of
// whatever's already typed rather than replacing it. Same "not a real
// nutrition database" convention as the pre-ride planner's own pocket-food
// catalog (`lib/metabolic-engine.ts`'s `pocketFoodCarbsG`).
const CONSUMPTION_PRESETS: {
  label: string;
  carbsG: number;
  fluidL: number;
  sodiumMg: number;
}[] = [
  { label: "+1 Gel (+25g HC)", carbsG: 25, fluidL: 0, sodiumMg: 0 },
  { label: "+1 Bidón (+30g HC / +400mg Na / +0.5L)", carbsG: 30, fluidL: 0.5, sodiumMg: 400 },
  { label: "+1 Barrita (+35g HC)", carbsG: 35, fluidL: 0, sodiumMg: 0 },
];

type ActivityOption = {
  id: string;
  name: string;
  activity_date: string;
};

type Telemetry = {
  energyKcal: number;
  energySource: "kilojoules" | "calories" | "estimated";
  powerWatts: number | null;
  normalizedPowerWatts: number | null;
  powerSource: "device" | "estimated" | "none";
  heartrateAvg: number | null;
};

type AnalysisResult = {
  activity: {
    name: string;
    activityDate: string;
    distanceKm: number;
    elevationGainM: number;
    durationHours: number;
    points: [number, number][] | null;
    temperatureAvgC: number | null;
  };
  carbsBurnedG: number;
  fluidLossMl: number;
  sodiumLossMg: number;
  source: "zones" | "heartrate" | "average_watts" | "stored" | "rpe";
  telemetry: Telemetry;
  weightKg: number;
  recoveryTarget: {
    carbsG: number;
    proteinG: number;
    fatLimitG: number;
    fluidMl: number;
    sodiumMg: number;
  };
  loggedNew: boolean;
};

function formatHoursMinutes(hours: number): string {
  const totalMinutes = Math.round(Math.max(0, hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function capitalize(word: string): string {
  return word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

// "Martes 28 de Julio · Inicio a las 17:30h" — built from separate
// `Intl`/`toLocaleDateString` calls rather than one combined format string,
// since `es-ES`'s own long-date output ("martes, 28 de julio") lowercases
// every word and this app's convention capitalizes the weekday/month for a
// cleaner, more legible stamp (but not "de", which stays lowercase).
function formatActivityDateTime(iso: string): string {
  const date = new Date(iso);
  const weekday = capitalize(date.toLocaleDateString("es-ES", { weekday: "long" }));
  const month = capitalize(date.toLocaleDateString("es-ES", { month: "long" }));
  const time = date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${weekday} ${date.getDate()} de ${month} · Inicio a las ${time}h`;
}

// "Balance Neto de Recuperación" — a Gastado/Ingerido/Deuda neta row for one
// metric (carbs, fluid, or sodium), replacing the previous plain-text
// equation ("GASTADO 210g − INGERIDO 0g = DEUDA NETA 210g") with a scannable
// 3-cell grid; the debt figure is the one visually emphasized (terracotta,
// this app's one accent color) since it's the number that actually drives
// the recovery target below it.
function BalanceNetoRow({
  label,
  spent,
  consumed,
  debt,
}: {
  label: string;
  spent: string;
  consumed: string;
  debt: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface px-3 py-2">
      <div className="col-span-3 -mb-1 text-[10px] font-semibold tracking-wider text-neutral-500 uppercase">
        {label}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] font-semibold tracking-wider text-neutral-500 uppercase">
          Gastado
        </span>
        <span className="font-mono text-sm font-semibold text-neutral-900 tabular-nums">
          {spent}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] font-semibold tracking-wider text-neutral-500 uppercase">
          Ingerido
        </span>
        <span className="font-mono text-sm font-semibold text-neutral-900 tabular-nums">
          {consumed}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] font-semibold tracking-wider text-neutral-500 uppercase">
          Deuda neta
        </span>
        <span className="font-mono text-sm font-bold text-terracotta tabular-nums">{debt}</span>
      </div>
    </div>
  );
}

const sourceLabels: Record<AnalysisResult["source"], string> = {
  zones: "calculado a partir de tus zonas de potencia reales",
  heartrate: "sin potenciómetro — calculado a partir de tu frecuencia cardíaca",
  average_watts: "calculado a partir de tus vatios medios",
  stored: "calculado en el momento de la sincronización",
  rpe: "sin potenciómetro ni pulsómetro — calculado a partir de tu esfuerzo percibido",
};

export function PostRideAnalysis({ activities }: { activities: ActivityOption[] }) {
  const [selectedId, setSelectedId] = useState(activities[0]?.id ?? "");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True when the server found no power/heart-rate data of any kind (not
  // even a Strava-estimated wattage) and needs a self-reported effort level
  // to compute anything at all — renders the RPE picker instead of a dead-end
  // error message. `lastRpeLabel` is display-only (which button the athlete
  // actually pressed), since the real calculation already happened server-side.
  const [needsRpe, setNeedsRpe] = useState(false);
  const [lastRpeLabel, setLastRpeLabel] = useState<string | null>(null);
  // What the athlete says they actually consumed during the ride itself —
  // starts at 0 (assume nothing) and nets against the burn/loss figures via
  // `getRecoveryDebt` below, recomputed live with every keystroke.
  const [carbsConsumedG, setCarbsConsumedG] = useState(0);
  const [fluidConsumedL, setFluidConsumedL] = useState(0);
  const [sodiumConsumedMg, setSodiumConsumedMg] = useState(0);
  const [savingConsumption, setSavingConsumption] = useState(false);
  const [consumptionSaved, setConsumptionSaved] = useState(false);
  const [consumptionError, setConsumptionError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // A freshly computed "Deuda de Glucógeno" renders below the fold on most
  // phones — without this, a fresh analysis appears to do nothing until the
  // athlete notices they need to scroll down themselves. Skipped on the very
  // first auto-load below (`result` still `null` at that point anyway), so
  // opening this tab never yanks the viewport before the athlete has
  // scrolled to it themselves.
  useEffect(() => {
    if (result) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  // Auto-loads the athlete's most recent synced ride the moment this
  // component mounts — "Cambiar salida" (inside the telemetry card below) is
  // now the *only* way to pick a different ride, so the very first analysis
  // has to kick off on its own rather than waiting on a manual "Analizar"
  // click that no longer exists.
  useEffect(() => {
    if (selectedId) {
      handleAnalyze();
    }
    // Deliberately runs once on mount only — `handleSwitchActivity` already
    // re-triggers analysis for every subsequent selection change; depending
    // on `selectedId` here would double-fire it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `activityIdOverride` exists for the telemetry card's own "Cambiar
  // salida" switcher (see below): switching activities there both updates
  // `selectedId` and immediately re-runs the analysis, but `setSelectedId`
  // doesn't take effect until the next render — passing the id straight
  // through avoids a stale-closure request against the *previous* selection.
  async function handleAnalyze(rpeLevel?: IntensityLevel, rpeLabel?: string, activityIdOverride?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/post-ride/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityId: activityIdOverride ?? selectedId,
          ...(rpeLevel ? { rpeLevel } : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error === "needs_rpe") {
          setNeedsRpe(true);
          setResult(null);
          return;
        }
        setNeedsRpe(false);
        setError(
          data.error === "no_data"
            ? "No hay datos suficientes para analizar esta ruta — configura tu FTP en el perfil."
            : "No se pudo analizar la ruta."
        );
        setResult(null);
        return;
      }
      setNeedsRpe(false);
      setLastRpeLabel(rpeLabel ?? null);
      setResult(data);
      setCarbsConsumedG(0);
      setFluidConsumedL(0);
      setSodiumConsumedMg(0);
      setConsumptionSaved(false);
      setConsumptionError(null);
    } catch {
      setNeedsRpe(false);
      setError("No se pudo analizar la ruta.");
    } finally {
      setLoading(false);
    }
  }

  // The telemetry card's "Cambiar salida" quick switcher — the only control
  // for picking which ride gets analyzed. Updates `selectedId` and
  // immediately re-runs the analysis in place; there's no separate
  // "Analizar" button to click anymore.
  function handleSwitchActivity(activityId: string) {
    setSelectedId(activityId);
    setNeedsRpe(false);
    setError(null);
    handleAnalyze(undefined, undefined, activityId);
  }

  // Adds a preset's fixed doses on top of whatever the athlete already typed
  // — never replaces it, since they might be logging several items across
  // multiple taps (a gel and a bottle, say).
  function applyConsumptionPreset(preset: (typeof CONSUMPTION_PRESETS)[number]) {
    setCarbsConsumedG((g) => g + preset.carbsG);
    setFluidConsumedL((l) => Math.round((l + preset.fluidL) * 10) / 10);
    setSodiumConsumedMg((mg) => mg + preset.sodiumMg);
    setConsumptionSaved(false);
  }

  async function handleSaveConsumption() {
    setSavingConsumption(true);
    setConsumptionError(null);
    try {
      const res = await fetch("/api/post-ride/consumption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityId: selectedId,
          carbsConsumedG,
          fluidConsumedMl: fluidConsumedL * 1000,
          sodiumConsumedMg,
        }),
      });
      if (!res.ok) {
        setConsumptionError("No se pudo guardar el consumo real.");
        return;
      }
      setConsumptionSaved(true);
    } catch {
      setConsumptionError("No se pudo guardar el consumo real.");
    } finally {
      setSavingConsumption(false);
    }
  }

  const recoveryDebt = useMemo(() => {
    if (!result) return null;
    return getRecoveryDebt({
      carbsBurnedG: result.carbsBurnedG,
      carbsConsumedG,
      fluidLossMl: result.fluidLossMl,
      fluidConsumedMl: fluidConsumedL * 1000,
      sodiumLossMg: result.sodiumLossMg,
      sodiumConsumedMg,
    });
  }, [result, carbsConsumedG, fluidConsumedL, sodiumConsumedMg]);

  const recoveryTarget = useMemo(() => {
    if (!result || !recoveryDebt) return null;
    return getMacroRecoveryTarget({ weightKg: result.weightKg, recoveryDebt });
  }, [result, recoveryDebt]);

  const biphasicRecoveryTarget = useMemo(() => {
    if (!recoveryTarget || !recoveryDebt) return null;
    return getBiphasicRecoveryTarget({
      carbsDebtG: recoveryDebt.carbsDebtG,
      proteinG: recoveryTarget.proteinG,
    });
  }, [recoveryTarget, recoveryDebt]);

  if (activities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Análisis post-ruta</CardTitle>
          <CardDescription className={eyebrow}>
            Sin actividades registradas todavía
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="max-w-sm text-sm text-neutral-500">
            En cuanto sincronices tu última salida desde Strava, aparecerá aquí lista para
            calcular su deuda de glucógeno y objetivo de recuperación.
          </p>
          <SyncForm />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Análisis post-ruta</CardTitle>
        <CardDescription className={eyebrow}>
          Deuda de glucógeno y objetivo de recuperación por macros
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {loading && !result && (
          <p className="text-sm text-neutral-500">Analizando tu última salida…</p>
        )}

        {error && <p className="text-sm text-status-warning">{error}</p>}

        {needsRpe && (
          <div className="flex flex-col gap-2 border border-neutral-200 bg-surface px-4 py-3">
            <p className="text-sm text-neutral-700">
              Esta ruta no tiene datos de potenciómetro ni pulsómetro — ¿cómo sentiste el
              esfuerzo?
            </p>
            <div className="flex flex-wrap gap-1.5">
              {RPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={loading}
                  onClick={() => handleAnalyze(opt.value, opt.label)}
                  className="cursor-pointer rounded-sm border border-neutral-300 px-3 py-1.5 text-[11px] font-semibold tracking-widest text-neutral-600 uppercase transition-colors duration-150 hover:border-terracotta hover:text-terracotta disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {result && (
          <div ref={resultRef} className="flex flex-col gap-4 border-t border-neutral-200 pt-4">
            <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-surface px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200/60 bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-emerald-700 uppercase">
                  <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                  Ruta sincronizada desde Strava
                </span>

                {/* "Cambiar salida" — a quick way to re-audit a different one
                    of the athlete's last few synced rides without scrolling
                    back up to the "Actividad" selector above. Native
                    `<select>` (this codebase has no custom dropdown
                    primitive), with a persistent "Cambiar salida" label so
                    it reads as an action rather than just echoing back
                    whichever ride is currently selected. */}
                <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] font-bold tracking-wider text-neutral-500 uppercase">
                  Cambiar salida
                  <span className="relative flex items-center">
                    <select
                      aria-label="Cambiar salida"
                      value={selectedId}
                      disabled={loading}
                      onChange={(e) => handleSwitchActivity(e.target.value)}
                      className="cursor-pointer appearance-none rounded-md border border-neutral-300 bg-white py-1 pr-5 pl-2 text-neutral-700 normal-case hover:border-neutral-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {activities.slice(0, ACTIVITY_SWITCHER_LIMIT).map((activity) => (
                        <option key={activity.id} value={activity.id}>
                          {activity.name} ·{" "}
                          {new Date(activity.activity_date).toLocaleDateString("es-ES", {
                            day: "numeric",
                            month: "short",
                          })}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1.5 size-3 text-neutral-400" />
                  </span>
                </label>
              </div>

              <div>
                <span className="text-sm font-medium text-neutral-900">{result.activity.name}</span>
                <p className="font-mono text-xs text-neutral-500">
                  {formatActivityDateTime(result.activity.activityDate)}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 border-t border-neutral-200 pt-3 md:grid-cols-12 md:items-center md:gap-6">
                {/* Compact square-ish preview on mobile (`h-36`, unchanged
                    — stacked above the stats); a contained side column on
                    desktop (`h-52`, capped well below the full-bleed 16:9
                    version this went through first — that one pushed every
                    stat below the fold on tall screens) rather than the
                    stats flowing beneath it. */}
                <RouteMapPreview
                  points={result.activity.points}
                  distanceKm={result.activity.distanceKm}
                  elevationGainM={result.activity.elevationGainM}
                  className="mt-0 h-36 w-full md:col-span-5 md:h-52"
                  emptyMessage="Sin datos de trazado GPS para esta actividad."
                />

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:col-span-7 md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <span className={statLabel}>Distancia</span>
                    <span className="font-mono text-sm font-semibold text-neutral-900 tabular-nums">
                      {result.activity.distanceKm} km
                    </span>
                    <span className="font-mono text-[10px] text-neutral-500">
                      {result.activity.elevationGainM}m D+
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={statLabel}>Tiempo en movimiento</span>
                    <span className="font-mono text-sm font-semibold text-neutral-900 tabular-nums">
                      {formatHoursMinutes(result.activity.durationHours)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={statLabel}>Potencia</span>
                    {result.telemetry.powerSource === "none" ? (
                      <>
                        <span className="font-mono text-sm font-semibold text-neutral-400 tabular-nums">
                          N/A
                        </span>
                        <span className="font-mono text-[10px] text-neutral-500">
                          {lastRpeLabel ? `RPE: ${lastRpeLabel}` : "Sin sensor"}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-sm font-semibold text-neutral-900 tabular-nums">
                          {result.telemetry.powerWatts} W
                        </span>
                        <span className="font-mono text-[10px] text-neutral-500">
                          {result.telemetry.powerSource === "estimated"
                            ? "Potencia est."
                            : result.telemetry.normalizedPowerWatts != null
                              ? `NP ${result.telemetry.normalizedPowerWatts}W`
                              : "Real"}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={statLabel}>Gasto energético</span>
                    <span className="font-mono text-sm font-semibold text-neutral-900 tabular-nums">
                      {result.telemetry.energyKcal} kcal
                    </span>
                    <span className="font-mono text-[10px] text-neutral-500">
                      {result.telemetry.energySource === "estimated" ? "Estimado" : "Strava"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={statLabel}>Frecuencia cardíaca</span>
                    <span
                      className={cn(
                        "font-mono text-sm font-semibold tabular-nums",
                        result.telemetry.heartrateAvg != null ? "text-neutral-900" : "text-neutral-400"
                      )}
                    >
                      {result.telemetry.heartrateAvg != null
                        ? `${result.telemetry.heartrateAvg} ppm (media)`
                        : "-- ppm"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1 border-t border-neutral-200 pt-2 font-mono text-[10px] text-neutral-400">
                <p>
                  Cálculo de deuda metabólica generado a partir de la telemetría real de tu
                  ciclocomputador.
                </p>
                {result.activity.temperatureAvgC != null && (
                  <p className="flex items-center gap-1">
                    <Sun className="size-3 shrink-0" />
                    Temperatura de ruta: {result.activity.temperatureAvgC}°C — vía Open-Meteo
                  </p>
                )}
                <p className="flex items-center gap-1">
                  <Zap className="size-3 shrink-0" />
                  Glucógeno: {sourceLabels[result.source]}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={eyebrow}>Deuda de glucógeno · &ldquo;{result.activity.name}&rdquo;</span>
              <span className="text-xs text-neutral-500">{sourceLabels[result.source]}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <div className="flex flex-col gap-1">
                <span className={statLabel}>Glucógeno quemado</span>
                <span className={statValue}>
                  {result.carbsBurnedG}
                  <span className="ml-1 text-sm font-normal text-neutral-500">g</span>
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className={statLabel}>Líquido perdido</span>
                <span className={statValue}>
                  {(result.fluidLossMl / 1000).toFixed(1)}
                  <span className="ml-1 text-sm font-normal text-neutral-500">L</span>
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className={statLabel}>Sodio perdido</span>
                <span className={statValue}>
                  {result.sodiumLossMg}
                  <span className="ml-1 text-sm font-normal text-neutral-500">mg</span>
                </span>
              </div>
            </div>

            <Separator className="bg-neutral-200" />

            <div>
              <span className={eyebrow}>¿Qué consumiste realmente durante la ruta?</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CONSUMPTION_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyConsumptionPreset(preset)}
                    className="cursor-pointer rounded-md border border-neutral-300 bg-white px-2.5 py-1 font-mono text-[11px] font-semibold text-neutral-600 transition-colors duration-150 hover:border-terracotta hover:text-terracotta"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-1.5">
                  <label htmlFor="carbs-consumed" className="text-sm text-neutral-900">
                    Carbohidratos
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="carbs-consumed"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={carbsConsumedG || ""}
                      onChange={(e) => {
                        setCarbsConsumedG(Math.max(0, Number(e.target.value) || 0));
                        setConsumptionSaved(false);
                      }}
                      placeholder="0"
                      className="w-16 rounded-md border border-neutral-300 bg-white px-2 py-1 text-right font-mono text-sm text-neutral-900 shadow-sm outline-none hover:border-neutral-400 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                    />
                    <span className="font-mono text-xs text-neutral-500">g</span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-1.5">
                  <label htmlFor="fluid-consumed" className="text-sm text-neutral-900">
                    Agua
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="fluid-consumed"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.1}
                      value={fluidConsumedL || ""}
                      onChange={(e) => {
                        setFluidConsumedL(Math.max(0, Number(e.target.value) || 0));
                        setConsumptionSaved(false);
                      }}
                      placeholder="0"
                      className="w-16 rounded-md border border-neutral-300 bg-white px-2 py-1 text-right font-mono text-sm text-neutral-900 shadow-sm outline-none hover:border-neutral-400 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                    />
                    <span className="font-mono text-xs text-neutral-500">L</span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-1.5">
                  <label htmlFor="sodium-consumed" className="text-sm text-neutral-900">
                    Sodio
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="sodium-consumed"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={sodiumConsumedMg || ""}
                      onChange={(e) => {
                        setSodiumConsumedMg(Math.max(0, Number(e.target.value) || 0));
                        setConsumptionSaved(false);
                      }}
                      placeholder="0"
                      className="w-16 rounded-md border border-neutral-300 bg-white px-2 py-1 text-right font-mono text-sm text-neutral-900 shadow-sm outline-none hover:border-neutral-400 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                    />
                    <span className="font-mono text-xs text-neutral-500">mg</span>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSaveConsumption}
                  disabled={savingConsumption}
                  className={cn(primaryButtonClass, "w-fit px-4 py-1.5 text-[11px] shadow-none")}
                >
                  {savingConsumption ? "Guardando…" : "Guardar consumo real"}
                </button>
                {consumptionSaved && (
                  <span className="text-xs text-status-good">✓ Guardado</span>
                )}
                {consumptionError && (
                  <span className="text-xs text-status-warning">{consumptionError}</span>
                )}
              </div>
            </div>

            {recoveryDebt && (
              <div className="border border-neutral-200 px-3 py-2.5">
                <span className={eyebrow}>Balance neto de recuperación</span>
                <div className="mt-2 flex flex-col gap-2">
                  <BalanceNetoRow
                    label="Carbohidratos"
                    spent={`${result.carbsBurnedG}g`}
                    consumed={`${carbsConsumedG}g`}
                    debt={`${recoveryDebt.carbsDebtG}g`}
                  />
                  <BalanceNetoRow
                    label="Líquido"
                    spent={`${recoveryDebt.fluidTargetMl}ml`}
                    consumed={`${Math.round(fluidConsumedL * 1000)}ml`}
                    debt={`${recoveryDebt.fluidDebtMl}ml`}
                  />
                  <BalanceNetoRow
                    label="Sodio"
                    spent={`${result.sodiumLossMg}mg`}
                    consumed={`${sodiumConsumedMg}mg`}
                    debt={`${recoveryDebt.sodiumDebtMg}mg`}
                  />
                </div>
              </div>
            )}

            {recoveryTarget && biphasicRecoveryTarget && (
              <div>
                <span className={eyebrow}>Objetivo de recuperación post-ruta</span>
                <span className="mt-1 block text-xs text-neutral-500">
                  Ventana bifásica — glucógeno se repone en dos fases fisiológicas distintas,
                  no en una sola comida
                </span>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="border border-neutral-200 px-3 py-2.5">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-neutral-600 uppercase">
                      <Zap className="size-3.5 shrink-0" />
                      Fase 1 · {biphasicRecoveryTarget.phase1.windowLabel}
                    </span>
                    <div className="mt-1 flex items-baseline gap-1 font-mono text-xl font-semibold text-neutral-900">
                      {biphasicRecoveryTarget.phase1.carbsG}
                      <span className="text-sm font-normal text-neutral-500">g HC</span>
                    </div>
                    <span className="text-xs text-neutral-500 italic">
                      Líquido/rápido (batido, fruta) — vía GLUT-4, no depende de insulina
                    </span>
                  </div>
                  <div className="border border-neutral-200 px-3 py-2.5">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-neutral-600 uppercase">
                      <Utensils className="size-3.5 shrink-0" />
                      Fase 2 · {biphasicRecoveryTarget.phase2.windowLabel}
                    </span>
                    <div className="mt-1 flex items-baseline gap-3">
                      <span className="flex items-baseline gap-1 font-mono text-xl font-semibold text-neutral-900">
                        {biphasicRecoveryTarget.phase2.carbsG}
                        <span className="text-sm font-normal text-neutral-500">g HC</span>
                      </span>
                      <span className="flex items-baseline gap-1 font-mono text-xl font-semibold text-neutral-900">
                        {biphasicRecoveryTarget.phase2.proteinG}
                        <span className="text-sm font-normal text-neutral-500">g prot</span>
                      </span>
                    </div>
                    <span className="text-xs text-neutral-500 italic">
                      Comida sólida principal — reparación muscular
                    </span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="border border-neutral-200 px-3 py-2.5">
                    <span className={statLabel}>Grasas límite</span>
                    <div className="mt-1 flex items-baseline gap-1 font-mono text-xl font-semibold text-neutral-900">
                      &lt;{recoveryTarget.fatLimitG}
                      <span className="text-sm font-normal text-neutral-500">g</span>
                    </div>
                    <span className="text-xs text-neutral-500 italic">
                      Vaciado gástrico rápido
                    </span>
                  </div>
                  <div className="border border-neutral-200 px-3 py-2.5">
                    <span className={statLabel}>Rehidratación</span>
                    <div className="mt-1 flex items-baseline gap-1 font-mono text-xl font-semibold text-neutral-900">
                      {(recoveryTarget.fluidMl / 1000).toFixed(1)}
                      <span className="text-sm font-normal text-neutral-500">L</span>
                    </div>
                    <span className="font-mono text-xs text-neutral-500">
                      {recoveryTarget.sodiumMg} mg sodio
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-neutral-500">
                  Objetivo nutricional recomendado para las primeras 2 a 4 horas post-entreno,
                  calculado sobre la deuda neta real.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { Bike, Lock, Sun, Utensils, Zap } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileRequiredBanner } from "@/components/profile-required-banner";
import { SyncForm } from "@/components/sync-button";
import {
  getBiphasicRecoveryTarget,
  getMacroRecoveryTarget,
  getRecoveryDebt,
  type IntensityLevel,
} from "@/lib/metabolic-engine";
import { cn } from "@/lib/utils";
import { flatMobileCardClass, primaryButtonClass } from "@/lib/ui-classes";

// Leaflet reads `window`/`document` at module scope — same `ssr: false`
// requirement as `components/fueling-planner.tsx`'s own dynamic import of
// this component, never a static one.
const RouteMapPreview = dynamic(
  () => import("@/components/route-map-preview").then((mod) => mod.RouteMapPreview),
  { ssr: false, loading: () => <Skeleton className="h-48 w-full rounded-none" /> }
);

const eyebrow = "text-[10px] font-mono uppercase tracking-widest text-zinc-500";
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
    location: string | null;
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

// "Martes 28 de Julio · Inicio a las 18:58h" — built from separate
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

export function PostRideAnalysis({
  activities,
  isProfileComplete,
}: {
  activities: ActivityOption[];
  isProfileComplete: boolean;
}) {
  const [selectedId] = useState(activities[0]?.id ?? "");
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

  // Deliberately no scroll-into-view here (or anywhere else in this
  // component) — an earlier version nudged the viewport to the fresh result
  // on every analysis, which made sense back when a manual "Analizar" click
  // triggered it, but now that the tab auto-loads on mount and "Cambiar
  // salida" re-analyzes in place, the same effect meant the page jumped
  // around on its own the moment the tab opened or the athlete picked a
  // different ride. The result renders in place; the athlete's scroll
  // position is never touched by data loading.

  // Auto-loads the athlete's most recent synced ride the moment this
  // component mounts — there's no manual "Analizar" trigger or activity
  // switcher in this UI anymore, so the very first (and only) analysis has
  // to kick off on its own.
  useEffect(() => {
    if (selectedId) {
      handleAnalyze();
    }
    // Deliberately runs once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAnalyze(rpeLevel?: IntensityLevel, rpeLabel?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/post-ride/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityId: selectedId,
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
      <Card className={flatMobileCardClass}>
        <CardHeader>
          <CardTitle>Análisis post-ruta</CardTitle>
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
    <Card className={flatMobileCardClass}>
      <CardHeader>
        <CardTitle>Análisis post-ruta</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* A proper skeleton loader — title/metadata, map, and a 2-column
            metric grid all rendered as pulsing gray blocks, mirroring the
            real card's exact structure/order below (a loading fallback
            must mirror the real eventual shape — this app's own
            established convention) — replacing the earlier "Analizando tu
            última salida…" status pill plus muted `--` stat placeholders,
            which read as a generic loading notice rather than a preview of
            the content about to appear. Five metric placeholders (not the
            four a minimal mockup might suggest) to match the real grid's
            actual item count (Distancia/Tiempo en Movimiento/Potencia
            Media/Gasto Energético/Frecuencia Cardíaca) exactly. */}
        {loading && !result && (
          <div className="flex flex-col gap-4 border-t border-neutral-200 pt-4">
            <div className="animate-pulse space-y-5 rounded-xl bg-white p-5 shadow-none">
              <div className="space-y-2">
                <div className="h-6 w-3/5 rounded-md bg-zinc-200" />
                <div className="h-3.5 w-2/5 rounded-md bg-zinc-100" />
              </div>

              <div className="h-48 w-full rounded-xl bg-zinc-200/80 sm:h-56" />

              <div className="grid grid-cols-2 gap-x-6 gap-y-5 pt-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-3 w-1/2 rounded bg-zinc-100" />
                    <div className="h-5 w-3/4 rounded bg-zinc-200" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-status-warning">{error}</p>}

        {needsRpe && (
          <div className="flex flex-col gap-2 rounded-xl bg-white px-4 py-3 shadow-none">
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
                  className="cursor-pointer rounded-sm border border-zinc-300/70 bg-white px-3 py-1.5 text-[11px] font-semibold tracking-widest text-zinc-700 uppercase shadow-none transition-colors duration-150 hover:border-terracotta hover:text-terracotta disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-4 border-t border-neutral-200 pt-4">
            {/* "Jerarquía Visual Strava" — title + quiet Bike-icon metadata
                line first, then the full-width map, then a clean 2-column
                Title Case metrics grid — superseding the previous "map
                first" ordering from the "Estilo Strava Mobile" pass above
                (see that section's own note under "Post-Ride Analysis").
                `RouteMapPreview` itself is unchanged/shared with Pre-Ruta
                (same tiles, route-line color, floating zoom/badge chrome).
                Deliberately no `font-mono` on the metric values (unlike
                every other numeric readout in this app) — the same one-off
                exception carried over from the prior pass, matching
                Strava's own plain-sans numeral display. */}
            <div className="overflow-hidden rounded-xl bg-white shadow-none">
              <div className="px-5 pt-5">
                <h3 className="mb-1 text-xl font-bold tracking-tight text-zinc-900">
                  {result.activity.name}
                </h3>
                <div className="mb-4 flex items-center gap-1.5 text-xs font-normal text-zinc-500">
                  <Bike className="size-3.5 shrink-0 text-zinc-500" />
                  <span>
                    {formatActivityDateTime(result.activity.activityDate)}
                    {result.activity.location ? ` · ${result.activity.location}` : ""}
                  </span>
                </div>
              </div>

              <RouteMapPreview
                points={result.activity.points}
                distanceKm={result.activity.distanceKm}
                elevationGainM={result.activity.elevationGainM}
                className="mt-0 rounded-none"
                emptyMessage="Sin datos de trazado GPS para esta actividad."
              />

              <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 pt-5 text-left">
                <div>
                  <p className="mb-0.5 text-xs font-medium text-zinc-500">Distancia</p>
                  <p className="text-lg font-bold text-zinc-900">
                    {result.activity.distanceKm.toFixed(2)} km
                  </p>
                </div>
                <div>
                  <p className="mb-0.5 text-xs font-medium text-zinc-500">Tiempo en Movimiento</p>
                  <p className="text-lg font-bold text-zinc-900">
                    {formatHoursMinutes(result.activity.durationHours)}
                  </p>
                </div>
                <div>
                  <p className="mb-0.5 text-xs font-medium text-zinc-500">Potencia Media</p>
                  {result.telemetry.powerSource === "none" ? (
                    <>
                      <p className="text-lg font-bold text-zinc-400">N/A</p>
                      <p className="text-[10px] text-zinc-400">
                        {lastRpeLabel ? `RPE: ${lastRpeLabel}` : "Sin sensor"}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-bold text-zinc-900">{result.telemetry.powerWatts} W</p>
                      {result.telemetry.powerSource === "estimated" && (
                        <p className="text-[10px] text-zinc-400">Potencia estimada</p>
                      )}
                    </>
                  )}
                </div>
                <div>
                  <p className="mb-0.5 text-xs font-medium text-zinc-500">Gasto Energético</p>
                  <p className="text-lg font-bold text-zinc-900">{result.telemetry.energyKcal} kcal</p>
                  {result.telemetry.energySource === "estimated" && (
                    <p className="text-[10px] text-zinc-400">Estimado</p>
                  )}
                </div>
                <div>
                  <p className="mb-0.5 text-xs font-medium text-zinc-500">Frecuencia Cardíaca</p>
                  <p
                    className={cn(
                      "text-lg font-bold",
                      result.telemetry.heartrateAvg != null ? "text-zinc-900" : "text-zinc-400"
                    )}
                  >
                    {result.telemetry.heartrateAvg != null ? `${result.telemetry.heartrateAvg} ppm` : "N/A"}
                  </p>
                </div>
              </div>

              {/* Data-provenance footnotes — not part of the requested
                  layout, kept so real temperature/glycogen-source data
                  already surfaced elsewhere in this app is never silently
                  dropped by a redesign that didn't ask for its removal. */}
              <div className="mt-5 flex flex-col gap-1 border-t border-neutral-200 px-5 py-3 font-mono text-[10px] text-neutral-400">
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
                    className="cursor-pointer rounded-md bg-zinc-100 px-2.5 py-1 font-mono text-[11px] font-semibold text-neutral-600 transition-colors duration-150 hover:bg-terracotta/10 hover:text-terracotta"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex items-center justify-between gap-2 rounded-lg bg-[#F8F7F5] px-3 py-1.5">
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
                <div className="flex items-center justify-between gap-2 rounded-lg bg-[#F8F7F5] px-3 py-1.5">
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
                <div className="flex items-center justify-between gap-2 rounded-lg bg-[#F8F7F5] px-3 py-1.5">
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
                  disabled={savingConsumption || !isProfileComplete}
                  className={cn(
                    "w-fit px-4 py-1.5 text-[11px]",
                    isProfileComplete
                      ? cn(primaryButtonClass, "shadow-none")
                      : "inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-neutral-200 font-mono font-semibold tracking-wider text-neutral-400 uppercase"
                  )}
                >
                  {isProfileComplete ? (
                    savingConsumption ? (
                      "Guardando…"
                    ) : (
                      "Guardar consumo real"
                    )
                  ) : (
                    <>
                      <Lock className="size-3.5 shrink-0" />
                      Guardar consumo (perfil incompleto)
                    </>
                  )}
                </button>
                {consumptionSaved && (
                  <span className="text-xs text-status-good">✓ Guardado</span>
                )}
                {consumptionError && (
                  <span className="text-xs text-status-warning">{consumptionError}</span>
                )}
              </div>
              {!isProfileComplete && <ProfileRequiredBanner />}
            </div>

            {recoveryDebt && (
              <div className="rounded-lg bg-[#F8F7F5] p-4 shadow-none">
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
                  <div className="rounded-lg bg-[#F8F7F5] p-4 shadow-none">
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
                  <div className="rounded-lg bg-[#F8F7F5] p-4 shadow-none">
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
                  <div className="rounded-lg bg-[#F8F7F5] p-4 shadow-none">
                    <span className={statLabel}>Grasas límite</span>
                    <div className="mt-1 flex items-baseline gap-1 font-mono text-xl font-semibold text-neutral-900">
                      &lt;{recoveryTarget.fatLimitG}
                      <span className="text-sm font-normal text-neutral-500">g</span>
                    </div>
                    <span className="text-xs text-neutral-500 italic">
                      Vaciado gástrico rápido
                    </span>
                  </div>
                  <div className="rounded-lg bg-[#F8F7F5] p-4 shadow-none">
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

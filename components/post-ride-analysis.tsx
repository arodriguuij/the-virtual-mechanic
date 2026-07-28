"use client";

import { Utensils, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SyncForm } from "@/components/sync-button";
import {
  getBiphasicRecoveryTarget,
  getMacroRecoveryTarget,
  getRecoveryDebt,
  type IntensityLevel,
} from "@/lib/metabolic-engine";
import { cn } from "@/lib/utils";
import { primaryButtonClass, selectableFieldClass } from "@/lib/ui-classes";

const eyebrow = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
const statLabel = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
const statValue = "font-mono text-xl font-semibold text-neutral-900 tabular-nums sm:text-2xl";
// Shared with every other select/date field across the app (`lib/ui-classes.ts`).
const selectableInputClass = selectableFieldClass;

// A rider self-reporting effort after the fact thinks in "easy/moderate/
// hard," not the 5 finely graded levels the pre-ride planner's own target-
// power selector uses — so this RPE picker gets its own short copy even
// though it reuses the same underlying `IntensityLevel`/%FTP mapping.
const RPE_OPTIONS: { value: IntensityLevel; label: string }[] = [
  { value: "endurance", label: "Suave" },
  { value: "tempo", label: "Moderado" },
  { value: "threshold", label: "Duro" },
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
  // phones — without this, "Analizar" appears to do nothing until the
  // athlete notices they need to scroll down themselves.
  useEffect(() => {
    if (result) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  async function handleAnalyze(rpeLevel?: IntensityLevel, rpeLabel?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/post-ride/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityId: selectedId, ...(rpeLevel ? { rpeLevel } : {}) }),
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
    if (!recoveryTarget) return null;
    return getBiphasicRecoveryTarget(recoveryTarget);
  }, [recoveryTarget]);

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
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="activity" className={eyebrow}>
              Actividad
            </label>
            <select
              id="activity"
              className={selectableInputClass}
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setResult(null);
                setError(null);
                setNeedsRpe(false);
              }}
            >
              {activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.name} ·{" "}
                  {new Date(activity.activity_date).toLocaleDateString("es-ES", {
                    day: "numeric",
                    month: "short",
                  })}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => handleAnalyze()}
            disabled={loading}
            className={cn(primaryButtonClass, "w-full sm:w-fit")}
          >
            {loading ? "Analizando…" : "Analizar"}
          </button>
        </div>

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
                <span className="font-mono text-[10px] text-neutral-500">
                  {new Date(result.activity.activityDate).toLocaleDateString("es-ES", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
              <span className="text-sm font-medium text-neutral-900">{result.activity.name}</span>

              <div className="grid grid-cols-2 gap-3 border-t border-neutral-200 pt-3 sm:grid-cols-4">
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

              <p className="border-t border-neutral-200 pt-2 font-mono text-[10px] text-neutral-400">
                Cálculo de deuda metabólica generado a partir de la telemetría real de tu
                ciclocomputador.
              </p>
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
                <div className="mt-1.5 flex flex-col gap-1 font-mono text-xs text-neutral-600 sm:text-sm">
                  <div>
                    GASTADO {result.carbsBurnedG}g − INGERIDO EN RUTA {carbsConsumedG}g ={" "}
                    <span className="font-semibold text-neutral-900">
                      DEUDA NETA A REPONER {recoveryDebt.carbsDebtG}g
                    </span>
                  </div>
                  <div>
                    PÉRDIDA AJUSTADA {recoveryDebt.fluidTargetMl}ml − INGERIDO EN RUTA{" "}
                    {Math.round(fluidConsumedL * 1000)}ml ={" "}
                    <span className="font-semibold text-neutral-900">
                      DEUDA NETA A REPONER {recoveryDebt.fluidDebtMl}ml
                    </span>
                  </div>
                  <div>
                    PERDIDO {result.sodiumLossMg}mg − INGERIDO EN RUTA {sodiumConsumedMg}mg ={" "}
                    <span className="font-semibold text-neutral-900">
                      DEUDA NETA A REPONER {recoveryDebt.sodiumDebtMg}mg
                    </span>
                  </div>
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

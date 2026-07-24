"use client";

import { Copy } from "lucide-react";
import { useMemo, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatRecipeForSharing, intensityLabels, type IntensityLevel } from "@/lib/metabolic-engine";
import type { StravaRoute } from "@/lib/strava-routes";

const eyebrow = "text-[10px] font-medium tracking-widest text-neutral-600 uppercase";
const statLabel = "text-[10px] font-medium tracking-widest text-neutral-600 uppercase";
const statValue = "text-xl font-semibold text-neutral-900 tabular-nums sm:text-2xl";
const inputClass =
  "border border-neutral-300 bg-background px-3 py-2.5 text-sm text-neutral-900 outline-none focus:border-neutral-900";

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
  moneySaved: number;
  weather: {
    temperatureC: number;
    humidityPct: number;
    source: "dynamic" | "planning_default";
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
    };
    waterBottles: { count: number };
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

export function FuelingPlanner({ routes }: { routes: StravaRoute[] }) {
  const [mode, setMode] = useState<"route" | "quick">(routes.length > 0 ? "route" : "quick");
  const [selectedRouteId, setSelectedRouteId] = useState(routes[0]?.id ?? "");
  const [intensity, setIntensity] = useState<IntensityLevel>("endurance");
  const [quickDurationHours, setQuickDurationHours] = useState(2);
  const [quickAverageWatts, setQuickAverageWatts] = useState(180);
  const [departureLocal, setDepartureLocal] = useState(defaultDepartureLocal);
  const [isTargetEvent, setIsTargetEvent] = useState(false);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === selectedRouteId) ?? null,
    [routes, selectedRouteId]
  );

  async function handleCalculate() {
    setLoading(true);
    setError(null);
    try {
      const departureIso = new Date(departureLocal).toISOString();
      const body =
        mode === "route" && selectedRoute
          ? {
              mode: "route",
              departureIso,
              distanceKm: selectedRoute.distanceKm,
              elevationGainM: selectedRoute.elevationGainM,
              startLat: selectedRoute.startLat,
              startLng: selectedRoute.startLng,
              intensity,
              isTargetEvent,
            }
          : {
              mode: "quick",
              departureIso,
              durationHours: quickDurationHours,
              averageWatts: quickAverageWatts,
              isTargetEvent,
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-medium text-neutral-900">Planificador de fueling</CardTitle>
        <CardDescription className={eyebrow}>
          Estrategia de bolsillo y receta DIY para tu próxima salida
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("route")}
            className={cn(
              "px-3 py-2 text-[11px] font-medium tracking-widest uppercase transition-colors",
              mode === "route"
                ? "border border-neutral-900 bg-neutral-900 text-background"
                : "border border-neutral-300 text-neutral-600 hover:border-neutral-900 hover:text-neutral-900"
            )}
          >
            Ruta guardada de Strava
          </button>
          <button
            type="button"
            onClick={() => setMode("quick")}
            className={cn(
              "px-3 py-2 text-[11px] font-medium tracking-widest uppercase transition-colors",
              mode === "quick"
                ? "border border-neutral-900 bg-neutral-900 text-background"
                : "border border-neutral-300 text-neutral-600 hover:border-neutral-900 hover:text-neutral-900"
            )}
          >
            Calculadora rápida
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
                  className={inputClass}
                  value={selectedRouteId}
                  onChange={(e) => setSelectedRouteId(e.target.value)}
                >
                  {routes.map((route) => (
                    <option key={route.id} value={route.id}>
                      {route.name} · {route.distanceKm}km · {route.elevationGainM}m D+
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="intensity" className={eyebrow}>
                  Intensidad objetivo
                </label>
                <select
                  id="intensity"
                  className={inputClass}
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
              <div className="flex flex-col gap-1.5">
                <label htmlFor="departure-route" className={eyebrow}>
                  Salida
                </label>
                <input
                  id="departure-route"
                  type="datetime-local"
                  className={inputClass}
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
        ) : (
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
            <div className="flex flex-col gap-1.5">
              <label htmlFor="departure-quick" className={eyebrow}>
                Salida
              </label>
              <input
                id="departure-quick"
                type="datetime-local"
                className={inputClass}
                value={departureLocal}
                onChange={(e) => setDepartureLocal(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={handleCalculate}
            disabled={loading || (mode === "route" && !selectedRoute)}
            className="inline-flex w-fit items-center justify-center border border-neutral-900 bg-neutral-900 px-4 py-2 text-[11px] font-medium tracking-widest text-background uppercase transition-colors hover:bg-neutral-700 disabled:opacity-50"
          >
            {loading ? "Calculando…" : "Calcular estrategia"}
          </button>
          <label className="flex items-center gap-2 text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={isTargetEvent}
              onChange={(e) => setIsTargetEvent(e.target.checked)}
              className="size-3.5 accent-neutral-900"
            />
            Ruta objetivo / Competición
          </label>
        </div>

        {error && <p className="text-sm text-status-warning">{error}</p>}

        {result && (
          <div className="flex flex-col gap-4 border-t border-neutral-200 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={eyebrow}>Estrategia de bolsillo &amp; receta DIY</span>
              <span className="text-xs text-neutral-500">
                {result.weather.temperatureC}°C · {result.weather.humidityPct}% humedad ·{" "}
                {result.weather.source === "dynamic"
                  ? "previsión real de Open-Meteo"
                  : "estimación genérica"}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <div className="flex flex-col gap-1">
                <span className={statLabel}>Duración estimada</span>
                <span className={statValue}>
                  {result.durationHours}
                  <span className="ml-1 text-sm font-normal text-neutral-500">h</span>
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className={statLabel}>Carbohidratos</span>
                <span className={statValue}>
                  {result.carbsGPerHour}
                  <span className="ml-1 text-sm font-normal text-neutral-500">g/h</span>
                </span>
              </div>
              <div className="flex flex-col gap-1">
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
                  <span className="text-sm font-medium text-status-critical">
                    ⚠️ Pájara
                    {result.glycogenBattery.noFuel.bonkAtKm != null
                      ? ` en el km ${result.glycogenBattery.noFuel.bonkAtKm}`
                      : ""}
                    {result.glycogenBattery.noFuel.bonkAtHours != null
                      ? ` (a las ${result.glycogenBattery.noFuel.bonkAtHours}h)`
                      : ""}
                  </span>
                ) : (
                  <span className="text-sm font-medium text-neutral-900">
                    🔋 Sin pájara — {result.glycogenBattery.noFuel.remainingBatteryPct}% al llegar
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className={eyebrow}>Con receta DIY</span>
                <span
                  className={cn(
                    "text-sm font-medium",
                    result.glycogenBattery.withRecipe.bonkOccurs
                      ? "text-status-critical"
                      : "text-status-good"
                  )}
                >
                  🔋 Batería final: {result.glycogenBattery.withRecipe.remainingBatteryPct}%
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
                  className="inline-flex shrink-0 items-center gap-1.5 border border-neutral-300 px-2.5 py-1.5 text-[10px] font-medium tracking-widest text-neutral-600 uppercase transition-colors hover:border-neutral-900 hover:text-neutral-900"
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
              <div className="mt-2 flex flex-col gap-1.5 text-sm text-neutral-700">
                <div className="flex items-center justify-between">
                  <span>Maltodextrina</span>
                  <span className="font-medium text-neutral-900 tabular-nums">
                    {result.recipe.maltodextrinG} g
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Fructosa</span>
                  <span className="font-medium text-neutral-900 tabular-nums">
                    {result.recipe.fructoseG} g
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Sodio (citrato/sal)</span>
                  <span className="font-medium text-neutral-900 tabular-nums">
                    {result.recipe.sodiumMg} mg
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Agua</span>
                  <span className="font-medium text-neutral-900 tabular-nums">
                    {result.recipe.waterMl} ml
                  </span>
                </div>
              </div>

              <div className="mt-3 border-t border-neutral-200 pt-3">
                <span className={eyebrow}>
                  Arquitectura de bidones ({result.bottlePlan.bottleSizeMl}ml · ≤8% concentración)
                </span>
                <div className="mt-2 flex flex-col gap-1.5 text-sm text-neutral-700">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span>
                      🧪 {result.bottlePlan.fuelBottles.count > 1 ? "Bidones" : "Bidón"} Fuel
                      Concentrado × {result.bottlePlan.fuelBottles.count}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {result.bottlePlan.fuelBottles.maltodextrinGPerBottle}g malto ·{" "}
                      {result.bottlePlan.fuelBottles.fructoseGPerBottle}g fruct ·{" "}
                      {result.bottlePlan.fuelBottles.sodiumMgPerBottle}mg Na / bidón
                    </span>
                  </div>
                  {result.bottlePlan.waterBottles.count > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span>
                        💧 {result.bottlePlan.waterBottles.count > 1 ? "Bidones" : "Bidón"} Agua /
                        Electrolitos × {result.bottlePlan.waterBottles.count}
                      </span>
                      <span className="text-xs text-neutral-500">a demanda</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 border border-status-good/40 bg-status-good/10 px-3 py-2 text-sm text-status-good">
              <span className="font-medium">Ahorras {result.moneySaved.toFixed(2)} €</span>
              <span className="text-neutral-600">frente a geles comerciales equivalentes.</span>
            </div>

            {result.carbLoading && (
              <details className="border border-neutral-200 px-3 py-2.5">
                <summary className="cursor-pointer text-[11px] font-medium tracking-widest text-neutral-700 uppercase">
                  📅 Estrategia de carga día −1 · {result.carbLoading.minCarbsG}-
                  {result.carbLoading.maxCarbsG}g HC
                </summary>
                <div className="mt-2 flex flex-col gap-1.5 text-sm text-neutral-600">
                  {result.carbLoading.guidelines.map((guideline) => (
                    <p key={guideline}>• {guideline}</p>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

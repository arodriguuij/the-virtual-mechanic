"use client";

import { useMemo, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { intensityLabels, type IntensityLevel } from "@/lib/metabolic-engine";
import type { StravaRoute } from "@/lib/strava-routes";

const eyebrow = "text-[10px] font-medium tracking-widest text-neutral-600 uppercase";
const statLabel = "text-[10px] font-medium tracking-widest text-neutral-600 uppercase";
const statValue = "text-2xl font-semibold text-neutral-900 tabular-nums";
const inputClass =
  "border border-neutral-300 bg-background px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900";

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
  const [result, setResult] = useState<PlanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            }
          : {
              mode: "quick",
              departureIso,
              durationHours: quickDurationHours,
              averageWatts: quickAverageWatts,
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-medium text-neutral-900">Planificador de fueling</CardTitle>
        <CardDescription className={eyebrow}>
          Estrategia de bolsillo y receta DIY para tu próxima salida
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("route")}
            className={cn(
              "px-3 py-1.5 text-[11px] font-medium tracking-widest uppercase transition-colors",
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
              "px-3 py-1.5 text-[11px] font-medium tracking-widest uppercase transition-colors",
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
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 flex flex-col gap-1.5">
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
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="duration" className={eyebrow}>
                Duración (h)
              </label>
              <input
                id="duration"
                type="number"
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

        <button
          type="button"
          onClick={handleCalculate}
          disabled={loading || (mode === "route" && !selectedRoute)}
          className="inline-flex w-fit items-center justify-center border border-neutral-900 bg-neutral-900 px-4 py-2 text-[11px] font-medium tracking-widest text-background uppercase transition-colors hover:bg-neutral-700 disabled:opacity-50"
        >
          {loading ? "Calculando…" : "Calcular estrategia"}
        </button>

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

            <div className="grid grid-cols-3 gap-4">
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

            <Separator className="bg-neutral-200" />

            <div>
              <span className={eyebrow}>
                Receta de laboratorio casero (DIY) · {result.durationHours} h
              </span>
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
            </div>

            <div className="flex items-center gap-2 border border-status-good/40 bg-status-good/10 px-3 py-2 text-sm text-status-good">
              <span className="font-medium">Ahorras {result.moneySaved.toFixed(2)} €</span>
              <span className="text-neutral-600">frente a geles comerciales equivalentes.</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

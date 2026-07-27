"use client";

import { useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const eyebrow = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
const statLabel = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
const statValue = "font-mono text-xl font-semibold text-neutral-900 tabular-nums sm:text-2xl";
const inputClass =
  "border border-neutral-300 bg-background px-3 py-2.5 text-sm text-neutral-900 outline-none focus:border-neutral-900";
const selectableInputClass = `${inputClass} cursor-pointer`;
const primaryButtonClass =
  "inline-flex w-full cursor-pointer items-center justify-center gap-2 border border-neutral-900 bg-neutral-900 px-6 py-3 text-xs font-bold tracking-widest text-background uppercase transition-colors duration-150 hover:bg-background hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-neutral-900 disabled:hover:text-background sm:w-fit";

type ActivityOption = {
  id: string;
  name: string;
  activity_date: string;
};

type AnalysisResult = {
  activity: {
    name: string;
    activityDate: string;
    distanceKm: number;
    durationHours: number;
  };
  carbsBurnedG: number;
  fluidLossMl: number;
  sodiumLossMg: number;
  source: "zones" | "average_watts" | "stored" | "no_data";
  recoveryTarget: {
    carbsG: number;
    proteinG: number;
    fatLimitG: number;
    fluidMl: number;
    sodiumMg: number;
  };
  loggedNew: boolean;
};

const sourceLabels: Record<AnalysisResult["source"], string> = {
  zones: "calculado a partir de tus zonas de potencia reales",
  average_watts: "calculado a partir de tus vatios medios",
  stored: "calculado en el momento de la sincronización",
  no_data: "sin datos suficientes",
};

export function PostRideAnalysis({ activities }: { activities: ActivityOption[] }) {
  const [selectedId, setSelectedId] = useState(activities[0]?.id ?? "");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/post-ride/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityId: selectedId }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(
          data.error === "no_data"
            ? "No hay datos suficientes para analizar esta ruta — configura tu FTP en el perfil."
            : "No se pudo analizar la ruta."
        );
        setResult(null);
        return;
      }
      setResult(data);
    } catch {
      setError("No se pudo analizar la ruta.");
    } finally {
      setLoading(false);
    }
  }

  if (activities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Análisis post-ruta</CardTitle>
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
              onChange={(e) => setSelectedId(e.target.value)}
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
            onClick={handleAnalyze}
            disabled={loading}
            className={primaryButtonClass}
          >
            {loading ? "Analizando…" : "Analizar"}
          </button>
        </div>

        {error && <p className="text-sm text-status-warning">{error}</p>}

        {result && (
          <div className="flex flex-col gap-4 border-t border-neutral-200 pt-4">
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
              <span className={eyebrow}>Objetivo de recuperación post-ruta</span>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="border border-neutral-200 px-3 py-2.5">
                  <span className={statLabel}>Carbohidratos</span>
                  <div className="mt-1 flex items-baseline gap-1 font-mono text-xl font-semibold text-neutral-900">
                    {result.recoveryTarget.carbsG}
                    <span className="text-sm font-normal text-neutral-500">g</span>
                  </div>
                  <span className="text-xs text-neutral-500 italic">
                    Reconstrucción de glucógeno
                  </span>
                </div>
                <div className="border border-neutral-200 px-3 py-2.5">
                  <span className={statLabel}>Proteína</span>
                  <div className="mt-1 flex items-baseline gap-1 font-mono text-xl font-semibold text-neutral-900">
                    {result.recoveryTarget.proteinG}
                    <span className="text-sm font-normal text-neutral-500">g</span>
                  </div>
                  <span className="text-xs text-neutral-500 italic">Reparación muscular</span>
                </div>
                <div className="border border-neutral-200 px-3 py-2.5">
                  <span className={statLabel}>Grasas límite</span>
                  <div className="mt-1 flex items-baseline gap-1 font-mono text-xl font-semibold text-neutral-900">
                    &lt;{result.recoveryTarget.fatLimitG}
                    <span className="text-sm font-normal text-neutral-500">g</span>
                  </div>
                  <span className="text-xs text-neutral-500 italic">
                    Vaciado gástrico rápido
                  </span>
                </div>
                <div className="border border-neutral-200 px-3 py-2.5">
                  <span className={statLabel}>Rehidratación</span>
                  <div className="mt-1 flex items-baseline gap-1 font-mono text-xl font-semibold text-neutral-900">
                    {(result.recoveryTarget.fluidMl / 1000).toFixed(1)}
                    <span className="text-sm font-normal text-neutral-500">L</span>
                  </div>
                  <span className="font-mono text-xs text-neutral-500">
                    {result.recoveryTarget.sodiumMg} mg sodio
                  </span>
                </div>
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                Objetivo nutricional recomendado para las primeras 2 a 4 horas post-entreno.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

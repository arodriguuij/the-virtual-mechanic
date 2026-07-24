"use client";

import { useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const eyebrow = "text-[10px] font-medium tracking-widest text-neutral-600 uppercase";
const statLabel = "text-[10px] font-medium tracking-widest text-neutral-600 uppercase";
const statValue = "text-2xl font-semibold text-neutral-900 tabular-nums";
const inputClass =
  "border border-neutral-300 bg-background px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900";

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
  recoveryTarget: { carbsG: number; proteinG: number };
  mealOptions: {
    label: string;
    description: string;
    approxCarbsG: number;
    approxProteinG: number;
  }[];
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
          <CardTitle className="font-medium text-neutral-900">Análisis post-ruta</CardTitle>
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
        <CardTitle className="font-medium text-neutral-900">Análisis post-ruta</CardTitle>
        <CardDescription className={eyebrow}>
          Deuda de glucógeno y plato de recuperación
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
              className={inputClass}
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
            className="inline-flex items-center justify-center border border-neutral-900 bg-neutral-900 px-4 py-2 text-[11px] font-medium tracking-widest text-background uppercase transition-colors hover:bg-neutral-700 disabled:opacity-50"
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

            <div className="grid grid-cols-3 gap-4">
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
              <span className={eyebrow}>
                Plato de recuperación objetivo · {result.recoveryTarget.carbsG}g HC ·{" "}
                {result.recoveryTarget.proteinG}g proteína
              </span>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {result.mealOptions.map((option) => (
                  <div
                    key={option.label}
                    className="flex flex-col gap-1 border border-neutral-200 px-3 py-2.5"
                  >
                    <span className="text-[10px] font-medium tracking-widest text-neutral-500 uppercase">
                      {option.label}
                    </span>
                    <span className="text-sm text-neutral-900">{option.description}</span>
                    <span className="text-xs text-neutral-500">
                      ≈ {option.approxCarbsG}g HC · {option.approxProteinG}g proteína
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

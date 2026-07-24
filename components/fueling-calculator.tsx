"use client";

import { useMemo, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  getCarbOxidationRateGPerHour,
  getFluidLossMlPerHour,
  getHomeLabRecipe,
  getMoneySavedVsGels,
  getRelativeIntensityFromLevel,
  getSodiumLossMgPerHour,
  intensityLabels,
  type IntensityLevel,
  type SweatRate,
} from "@/lib/metabolic-engine";

// Assumed "typical training day" climate for ride planning — the pre-ride
// calculator has no real forecast to sample from, unlike the post-ride
// figures in the Recovery card, which are derived from actual Open-Meteo
// data captured at sync time for that specific ride.
const PLANNING_TEMPERATURE_C = 22;
const PLANNING_HUMIDITY_PCT = 55;

const DURATION_OPTIONS_H = [1, 1.5, 2, 3, 4, 5];
const INTENSITY_OPTIONS: IntensityLevel[] = [
  "recovery",
  "endurance",
  "tempo",
  "threshold",
  "vo2max",
];

const eyebrow = "text-[10px] font-medium tracking-widest text-neutral-600 uppercase";
const selectClass =
  "border border-neutral-300 bg-background px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900";

export function FuelingCalculator({ sweatRate }: { sweatRate: SweatRate }) {
  const [durationHours, setDurationHours] = useState(2);
  const [intensity, setIntensity] = useState<IntensityLevel>("endurance");

  const plan = useMemo(() => {
    const relativeIntensity = getRelativeIntensityFromLevel(intensity);
    const carbsGPerHour = getCarbOxidationRateGPerHour(relativeIntensity);
    const fluidLossMlPerHour = getFluidLossMlPerHour(
      sweatRate,
      PLANNING_TEMPERATURE_C,
      PLANNING_HUMIDITY_PCT
    );
    const sodiumMgPerHour = getSodiumLossMgPerHour(fluidLossMlPerHour);
    const recipe = getHomeLabRecipe({
      carbsGPerHour,
      sodiumMgPerHour,
      fluidLossMlPerHour,
      durationHours,
    });
    return {
      carbsGPerHour,
      sodiumMgPerHour,
      recipe,
      moneySaved: getMoneySavedVsGels(recipe),
    };
  }, [durationHours, intensity, sweatRate]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-medium text-neutral-900">
          Calculadora de fueling pre-ruta
        </CardTitle>
        <CardDescription className={eyebrow}>
          Planifica tus bidones antes de salir
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="duration" className={eyebrow}>
              Duración
            </label>
            <select
              id="duration"
              className={selectClass}
              value={durationHours}
              onChange={(e) => setDurationHours(Number(e.target.value))}
            >
              {DURATION_OPTIONS_H.map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="intensity" className={eyebrow}>
              Intensidad
            </label>
            <select
              id="intensity"
              className={selectClass}
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
        </div>

        <Separator className="bg-neutral-200" />

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <span className={eyebrow}>Objetivo de carbohidratos</span>
            <span className="text-2xl font-semibold text-neutral-900 tabular-nums">
              {plan.carbsGPerHour}
              <span className="ml-1 text-sm font-normal text-neutral-500">g/h</span>
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className={eyebrow}>Objetivo de sodio</span>
            <span className="text-2xl font-semibold text-neutral-900 tabular-nums">
              {plan.sodiumMgPerHour}
              <span className="ml-1 text-sm font-normal text-neutral-500">mg/h</span>
            </span>
          </div>
        </div>

        <div className="border-t border-neutral-200 pt-4">
          <span className={eyebrow}>
            Receta de laboratorio casero · {durationHours} h
          </span>
          <div className="mt-2 flex flex-col gap-1.5 text-sm text-neutral-700">
            <div className="flex items-center justify-between">
              <span>Maltodextrina</span>
              <span className="font-medium text-neutral-900 tabular-nums">
                {plan.recipe.maltodextrinG} g
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Fructosa</span>
              <span className="font-medium text-neutral-900 tabular-nums">
                {plan.recipe.fructoseG} g
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Sodio (sal/electrolitos)</span>
              <span className="font-medium text-neutral-900 tabular-nums">
                {plan.recipe.sodiumMg} mg
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Agua</span>
              <span className="font-medium text-neutral-900 tabular-nums">
                {plan.recipe.waterMl} ml
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border border-status-good/40 bg-status-good/10 px-3 py-2 text-sm text-status-good">
          <span className="font-medium">Ahorras {plan.moneySaved.toFixed(2)} €</span>
          <span className="text-neutral-600">frente a geles comerciales para estas mismas rutas.</span>
        </div>
      </CardContent>
    </Card>
  );
}

import { Info, Mountain, Thermometer, Wind } from "lucide-react";

import { badgeClass } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";

const statLabel = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";

/**
 * "Badge de Clima e Impacto Térmico Dinámico" — the pre-ride planner's
 * weather readout: real Temp/Viento/Humedad figures from Open-Meteo (see
 * `POST /api/fueling/plan`'s `weather` object), plus a plain-language note
 * on how that temperature is actually altering the plan
 * (`getThermalImpactNote` in `lib/metabolic-engine.ts`) rather than leaving
 * the athlete to infer it from a raw °C figure.
 */
export function WeatherImpactCard({
  temperatureC,
  temperatureMaxC,
  humidityPct,
  windSpeedKmh,
  source,
  multiPointSample,
  lapseRateAdjustmentC,
  thermalImpactNote,
}: {
  temperatureC: number;
  temperatureMaxC: number | null;
  humidityPct: number;
  windSpeedKmh: number;
  source: "dynamic" | "planning_default";
  multiPointSample: boolean;
  lapseRateAdjustmentC: number;
  thermalImpactNote: string | null;
}) {
  return (
    <div className="flex flex-col gap-3 border border-neutral-200 bg-surface px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={statLabel}>Impacto térmico</span>
        <span className="text-xs text-neutral-500">
          {source === "dynamic"
            ? multiPointSample
              ? "previsión real de Open-Meteo · inicio/puerto/llegada"
              : "previsión real de Open-Meteo"
            : "estimación genérica"}
          {lapseRateAdjustmentC !== 0 && (
            <span className="inline-flex items-center gap-1">
              {" "}
              · <Mountain className="size-3" />
              {lapseRateAdjustmentC}°C por altitud
            </span>
          )}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1 text-[10px] font-semibold tracking-widest text-neutral-600 uppercase">
            <Thermometer className="size-3" />
            Temp.
          </span>
          <span className={cn(badgeClass, "w-fit text-sm font-semibold tabular-nums")}>
            {temperatureC}°C
            {temperatureMaxC != null && temperatureMaxC !== temperatureC && (
              <span className="ml-1 text-xs font-normal opacity-70">(máx {temperatureMaxC}°C)</span>
            )}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1 text-[10px] font-semibold tracking-widest text-neutral-600 uppercase">
            <Wind className="size-3" />
            Viento
          </span>
          <span className={cn(badgeClass, "w-fit text-sm font-semibold tabular-nums")}>
            {windSpeedKmh} km/h
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold tracking-widest text-neutral-600 uppercase">
            Humedad
          </span>
          <span className={cn(badgeClass, "w-fit text-sm font-semibold tabular-nums")}>
            {humidityPct}%
          </span>
        </div>
      </div>
      {thermalImpactNote && (
        <p className="flex items-start gap-1.5 text-xs text-neutral-600">
          <Info className="mt-0.5 size-3 shrink-0" />
          {thermalImpactNote}
        </p>
      )}
    </div>
  );
}

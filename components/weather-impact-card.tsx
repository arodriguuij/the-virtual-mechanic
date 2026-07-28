import { Droplet, Mountain, Thermometer, Wind } from "lucide-react";

const statLabel = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";

/**
 * "Badge de Clima e Impacto Térmico Dinámico" — the pre-ride planner's
 * weather readout: real Temp/Viento/Humedad figures from Open-Meteo (see
 * `POST /api/fueling/plan`'s `weather` object), plus the actual hourly
 * hydration/sodium targets those conditions translate to — a direct,
 * auditable consumption figure rather than an isolated percentage like
 * "+31% por estrés térmico" (which states an increase without stating an
 * increase *of what*, or what to actually do about it).
 */
export function WeatherImpactCard({
  temperatureC,
  temperatureMaxC,
  humidityPct,
  windSpeedKmh,
  source,
  multiPointSample,
  lapseRateAdjustmentC,
  fluidLossMlPerHour,
  sodiumMgPerHour,
}: {
  temperatureC: number;
  temperatureMaxC: number | null;
  humidityPct: number;
  windSpeedKmh: number;
  source: "dynamic" | "planning_default";
  multiPointSample: boolean;
  lapseRateAdjustmentC: number;
  fluidLossMlPerHour: number;
  sodiumMgPerHour: number;
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
      <div className="mt-2 grid w-full grid-cols-3 gap-1.5">
        <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-badge-border bg-badge px-2 py-1.5">
          <span className="flex items-center gap-1 text-[10px] font-mono tracking-wider text-neutral-500 uppercase truncate">
            <Thermometer className="size-3 shrink-0" />
            <span className="truncate">Temp.</span>
          </span>
          <span className="truncate text-xs font-bold font-mono text-neutral-900 tabular-nums sm:text-sm">
            {temperatureC}°C
          </span>
          {temperatureMaxC != null && temperatureMaxC !== temperatureC && (
            <span className="block text-[9px] font-mono font-normal text-neutral-400 truncate">
              máx {temperatureMaxC}°C
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-badge-border bg-badge px-2 py-1.5">
          <span className="flex items-center gap-1 text-[10px] font-mono tracking-wider text-neutral-500 uppercase truncate">
            <Wind className="size-3 shrink-0" />
            <span className="truncate">Viento</span>
          </span>
          <span className="truncate text-xs font-bold font-mono text-neutral-900 tabular-nums sm:text-sm">
            {windSpeedKmh} km/h
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-badge-border bg-badge px-2 py-1.5">
          <span className="text-[10px] font-mono tracking-wider text-neutral-500 uppercase truncate">
            Humedad
          </span>
          <span className="truncate text-xs font-bold font-mono text-neutral-900 tabular-nums sm:text-sm">
            {humidityPct}%
          </span>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-neutral-600">
        <Droplet className="size-3 shrink-0" />
        Hidratación objetivo: <span className="font-mono font-semibold text-neutral-900">{fluidLossMlPerHour} ml/h</span>
        {" · "}Sodio objetivo: <span className="font-mono font-semibold text-neutral-900">{sodiumMgPerHour} mg/h</span>
      </p>
    </div>
  );
}

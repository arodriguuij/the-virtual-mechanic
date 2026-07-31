import { Mountain, Thermometer, Wind } from "lucide-react";

const statLabel = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";

/**
 * "Badge de Clima e Impacto Térmico Dinámico" — the pre-ride planner's
 * weather readout: real Temp/Viento/Humedad figures from Open-Meteo (see
 * `POST /api/fueling/plan`'s `weather` object). The hourly hydration/sodium
 * targets those conditions translate to used to be repeated here too, as a
 * `Droplet`-icon caption below the 3 stat tiles — removed as pure
 * duplication once Card 03's own 2x2 grid (Duración/Carbohidratos/
 * Hidratación/Sodio, in `components/fueling-planner.tsx`) already shows
 * those exact same figures once, so `fluidLossMlPerHour`/`sodiumMgPerHour`
 * are no longer props this component needs at all.
 */
export function WeatherImpactCard({
  temperatureC,
  temperatureMaxC,
  humidityPct,
  windSpeedKmh,
  source,
  multiPointSample,
  lapseRateAdjustmentC,
}: {
  temperatureC: number;
  temperatureMaxC: number | null;
  humidityPct: number;
  windSpeedKmh: number;
  source: "dynamic" | "planning_default" | "seasonal_average";
  multiPointSample: boolean;
  lapseRateAdjustmentC: number;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-sm bg-surface px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={statLabel}>Impacto térmico</span>
        <span className="text-xs text-neutral-500">
          {source === "dynamic"
            ? // `multiPointSample` is true precisely when a real geographic
              // 3-point sample (start/summit/finish) succeeded — only
              // possible in route/GPX mode with a genuine elevation
              // profile ("hay puerto"). Entreno Manual (no coordinates at
              // all) or a flat route with no meaningful peak both fall
              // through to the same single-location forecast, averaged
              // across the ride's own departure-to-arrival window — "mitad
              // de ruta" describes that time-averaged midpoint reading in
              // plain language, not a second physical location actually
              // being sampled.
              multiPointSample
              ? "Previsión real Open-Meteo · inicio / punto más alto / llegada"
              : "Previsión real Open-Meteo · inicio / mitad de ruta / llegada"
            : source === "seasonal_average"
              ? "media histórica estacional"
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
      {source === "seasonal_average" && (
        <p className="text-[11px] text-neutral-500">
          Clima estimado mediante medias históricas estacionales — la fecha elegida está
          fuera del rango de previsión en vivo (14 días).
        </p>
      )}
    </div>
  );
}

import { Mountain, Thermometer, Wind } from "lucide-react";
import type { ReactNode } from "react";

const statLabel = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";

export type AltitudeWeather = {
  base: { temperatureC: number; humidityPct: number; windSpeedKmh: number };
  peak: {
    temperatureC: number;
    humidityPct: number;
    windSpeedKmh: number;
    elevationM: number | null;
  };
};

/** One Temp/Viento/Humedad stat tile — shared by the single-card layout
 * (no significant climb) and each half of the base-vs-cima comparison
 * (a real climb) below, so the two layouts render pixel-identical tiles. */
function WeatherStatTile({
  label,
  icon,
  value,
  caption,
}: {
  label: string;
  icon?: ReactNode;
  value: string;
  caption?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-badge-border bg-badge px-2 py-1.5">
      <span className="flex items-center gap-1 text-[10px] font-mono tracking-wider text-neutral-500 uppercase truncate">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="truncate text-xs font-bold font-mono text-neutral-900 tabular-nums sm:text-sm">
        {value}
      </span>
      {caption && (
        <span className="block text-[9px] font-mono font-normal text-neutral-400 truncate">
          {caption}
        </span>
      )}
    </div>
  );
}

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
 *
 * "Impacto Térmico Diferenciado por Altitud" — a single blended reading
 * (still what's shown by default) silently averages away a mountain route's
 * real base-vs-summit temperature swing. Whenever the server flags a
 * significant climb (`altitude` non-null — D+ ≥ 400m or a known summit ≥
 * 500m, see `POST /api/fueling/plan`), this renders two comparative tiles
 * instead of one: "Base / Llanos" (the route's start/finish-level
 * conditions) and "Cima del Puerto" (the actual summit's own reading, real
 * Open-Meteo data at the peak's coordinates when a 3-point sample succeeded,
 * or the same `-0.65°C/100m` lapse-rate estimate already used elsewhere in
 * this app otherwise — see `getLapseRateAdjustedTemperature`).
 */
export function WeatherImpactCard({
  temperatureC,
  temperatureMaxC,
  humidityPct,
  windSpeedKmh,
  source,
  multiPointSample,
  lapseRateAdjustmentC,
  altitude,
}: {
  temperatureC: number;
  temperatureMaxC: number | null;
  humidityPct: number;
  windSpeedKmh: number;
  source: "dynamic" | "planning_default" | "seasonal_average";
  multiPointSample: boolean;
  lapseRateAdjustmentC: number;
  altitude?: AltitudeWeather | null;
}) {
  const sourceLabel =
    source === "dynamic"
      ? // `multiPointSample` is true precisely when a real geographic
        // 3-point sample (start/summit/finish) succeeded — only possible
        // in route/GPX mode with a genuine elevation profile ("hay
        // puerto"). Entreno Manual (no coordinates at all) or a flat route
        // with no meaningful peak both fall through to the same
        // single-location forecast, averaged across the ride's own
        // departure-to-arrival window — "mitad de ruta" describes that
        // time-averaged midpoint reading in plain language, not a second
        // physical location actually being sampled.
        multiPointSample
        ? "Previsión real Open-Meteo · inicio / punto más alto / llegada"
        : "Previsión real Open-Meteo · inicio / mitad de ruta / llegada"
      : source === "seasonal_average"
        ? "media histórica estacional"
        : "estimación genérica";

  return (
    <div className="flex flex-col gap-3 rounded-sm bg-surface px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={statLabel}>Impacto térmico</span>
        <span className="text-xs text-neutral-500">
          {sourceLabel}
          {!altitude && lapseRateAdjustmentC !== 0 && (
            <span className="inline-flex items-center gap-1">
              {" "}
              · <Mountain className="size-3" />
              {lapseRateAdjustmentC}°C por altitud
            </span>
          )}
        </span>
      </div>

      {altitude ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">
              Base / Llanos
            </span>
            <div className="grid w-full grid-cols-3 gap-1.5">
              <WeatherStatTile
                label="Temp."
                icon={<Thermometer className="size-3 shrink-0" />}
                value={`${altitude.base.temperatureC}°C`}
              />
              <WeatherStatTile
                label="Viento"
                icon={<Wind className="size-3 shrink-0" />}
                value={`${altitude.base.windSpeedKmh} km/h`}
              />
              <WeatherStatTile label="Humedad" value={`${altitude.base.humidityPct}%`} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1 text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">
              <Mountain className="size-3 shrink-0" />
              Cima del puerto
              {altitude.peak.elevationM != null && ` (${altitude.peak.elevationM}m)`}
            </span>
            <div className="grid w-full grid-cols-3 gap-1.5">
              <WeatherStatTile
                label="Temp."
                icon={<Thermometer className="size-3 shrink-0" />}
                value={`${altitude.peak.temperatureC}°C`}
                caption={`${Math.round((altitude.peak.temperatureC - altitude.base.temperatureC) * 10) / 10}°C vs. base`}
              />
              <WeatherStatTile
                label="Viento"
                icon={<Wind className="size-3 shrink-0" />}
                value={`${altitude.peak.windSpeedKmh} km/h`}
              />
              <WeatherStatTile label="Humedad" value={`${altitude.peak.humidityPct}%`} />
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-2 grid w-full grid-cols-3 gap-1.5">
          <WeatherStatTile
            label="Temp."
            icon={<Thermometer className="size-3 shrink-0" />}
            value={`${temperatureC}°C`}
            caption={
              temperatureMaxC != null && temperatureMaxC !== temperatureC
                ? `máx ${temperatureMaxC}°C`
                : undefined
            }
          />
          <WeatherStatTile
            label="Viento"
            icon={<Wind className="size-3 shrink-0" />}
            value={`${windSpeedKmh} km/h`}
          />
          <WeatherStatTile label="Humedad" value={`${humidityPct}%`} />
        </div>
      )}

      {source === "seasonal_average" && (
        <p className="text-[11px] text-neutral-500">
          Clima estimado mediante medias históricas estacionales — la fecha elegida está
          fuera del rango de previsión en vivo (14 días).
        </p>
      )}
    </div>
  );
}

import { Mountain, Thermometer, TriangleAlert, Wind } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// "Ficha Técnica de Laboratorio" — this component's one call site is
// Card 03's own dark olive tile (`components/fueling-planner.tsx`), so
// every color here was restyled directly for that dark surface rather
// than gaining a light/dark variant prop for a light-surface call site
// that doesn't exist.
const statLabel = "text-[10px] font-semibold tracking-widest text-emerald-200/70 uppercase";

// "Clima Inteligente con Alerta por Rangos" — a flat gray tile treats 32°C
// exactly like 18°C, even though the athlete's real thermal stress at those
// two readings is nothing alike. Past these thresholds, the relevant tile
// switches to a warm/alert tint with an explicit label, instead of relying
// on the athlete to notice the raw number and judge it themselves.
const HEAT_ALERT_THRESHOLD_C = 30;
const WIND_ALERT_THRESHOLD_KMH = 20;
// "Alertas Cromáticas Reactivas" — humidity had no threshold of its own
// before; a Humedad tile stayed the neutral porcelain tint no matter how
// high the real reading was, unlike Temp./Viento which already switch to
// the amber alert treatment above their own thresholds.
const HUMIDITY_ALERT_THRESHOLD_PCT = 75;

export type AltitudeWeather = {
  base: {
    temperatureC: number;
    humidityPct: number;
    windSpeedKmh: number;
    elevationM: number | null;
  };
  peak: {
    temperatureC: number;
    humidityPct: number;
    windSpeedKmh: number;
    elevationM: number | null;
  };
};

/** One Temp/Viento/Humedad stat tile — shared by the single-card layout
 * (no significant climb) and each half of the base-vs-cima comparison
 * (a real climb) below, so the two layouts render pixel-identical tiles.
 * `alertLabel` (only ever passed for Temp/Viento, never Humedad) switches
 * the tile to a warm amber tint and renders as its own line below `caption`
 * — both can coexist (e.g. a "cima" tile showing "+6°C vs. valle" *and*
 * "Calor extremo" at once), rather than one replacing the other. */
function WeatherStatTile({
  label,
  icon,
  value,
  caption,
  alertLabel,
}: {
  label: string;
  icon?: ReactNode;
  value: string;
  caption?: string;
  alertLabel?: string;
}) {
  const alert = Boolean(alertLabel);
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-md border px-2 py-1.5",
        alert ? "border-amber-500/30 bg-amber-950/30" : "border-white/10 bg-black/30"
      )}
    >
      <span
        className={cn(
          "flex items-center gap-1 text-[10px] font-mono tracking-wider uppercase truncate",
          alert ? "text-amber-400" : "text-zinc-400"
        )}
      >
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          "truncate text-xs font-bold font-mono tabular-nums sm:text-sm",
          alert ? "text-amber-200" : "text-white"
        )}
      >
        {value}
      </span>
      {caption && (
        <span className="block text-[9px] font-mono font-normal text-zinc-500 truncate">
          {caption}
        </span>
      )}
      {alertLabel && (
        <span className="flex items-center gap-1 text-[9px] font-mono font-semibold text-amber-400 truncate">
          <TriangleAlert className="size-2.5 shrink-0" />
          {alertLabel}
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
 * real valley-vs-summit temperature swing, and can even miss it entirely on
 * a route that starts high, descends into a hot valley, then climbs — the
 * valley, not the start, is where the real thermal peak sits. Whenever the
 * server flags a significant climb (`altitude` non-null — the route's real
 * elevation range ≥ 400m, or a known summit ≥ 500m ASL, see
 * `POST /api/fueling/plan`), this renders two comparative tiles instead of
 * one: "Valle / Salida" (sampled at the route's own lowest point — which may
 * literally be the departure point on a pure-ascent route, or a genuine
 * valley dip further along it) and "Cima del Puerto" (the actual summit's
 * own reading). Both are real Open-Meteo data at each point's own
 * coordinates when the multi-point sample succeeded, or the same
 * `-0.65°C/100m` lapse-rate estimate already used elsewhere in this app
 * otherwise — see `getLapseRateAdjustedTemperature`.
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
        // multi-point sample (start/valle/cima/llegada) succeeded — only
        // possible in route/GPX mode with a genuine elevation profile ("hay
        // puerto"). Entreno Manual (no coordinates at all) or a flat route
        // with no meaningful peak/trough both fall through to the same
        // single-location forecast, averaged across the ride's own
        // departure-to-arrival window — "mitad de ruta" describes that
        // time-averaged midpoint reading in plain language, not a second
        // physical location actually being sampled.
        multiPointSample
        ? "Previsión real Open-Meteo · inicio / valle / cima / llegada"
        : "Previsión real Open-Meteo · inicio / mitad de ruta / llegada"
      : source === "seasonal_average"
        ? "media histórica estacional"
        : "estimación genérica";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/5 bg-black/20 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={statLabel}>Impacto térmico</span>
        <span className="text-xs text-zinc-400">
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
        <div className="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">
              Valle / Salida
              {altitude.base.elevationM != null && ` (${altitude.base.elevationM}m)`}
            </span>
            <div className="grid w-full grid-cols-3 gap-1.5">
              <WeatherStatTile
                label="Temp."
                icon={<Thermometer className="size-3 shrink-0" />}
                value={`${altitude.base.temperatureC}°C`}
                alertLabel={
                  altitude.base.temperatureC >= HEAT_ALERT_THRESHOLD_C ? "Calor extremo" : undefined
                }
              />
              <WeatherStatTile
                label="Viento"
                icon={<Wind className="size-3 shrink-0" />}
                value={`${altitude.base.windSpeedKmh} km/h`}
                alertLabel={
                  altitude.base.windSpeedKmh >= WIND_ALERT_THRESHOLD_KMH ? "Viento fuerte" : undefined
                }
              />
              <WeatherStatTile
                label="Humedad"
                value={`${altitude.base.humidityPct}%`}
                alertLabel={
                  altitude.base.humidityPct >= HUMIDITY_ALERT_THRESHOLD_PCT ? "Humedad alta" : undefined
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1 text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">
              <Mountain className="size-3 shrink-0" />
              Cima del puerto
              {altitude.peak.elevationM != null && ` (${altitude.peak.elevationM}m)`}
            </span>
            <div className="grid w-full grid-cols-3 gap-1.5">
              <WeatherStatTile
                label="Temp."
                icon={<Thermometer className="size-3 shrink-0" />}
                value={`${altitude.peak.temperatureC}°C`}
                caption={`${Math.round((altitude.peak.temperatureC - altitude.base.temperatureC) * 10) / 10}°C vs. valle`}
                alertLabel={
                  altitude.peak.temperatureC >= HEAT_ALERT_THRESHOLD_C ? "Calor extremo" : undefined
                }
              />
              <WeatherStatTile
                label="Viento"
                icon={<Wind className="size-3 shrink-0" />}
                value={`${altitude.peak.windSpeedKmh} km/h`}
                alertLabel={
                  altitude.peak.windSpeedKmh >= WIND_ALERT_THRESHOLD_KMH ? "Viento fuerte" : undefined
                }
              />
              <WeatherStatTile
                label="Humedad"
                value={`${altitude.peak.humidityPct}%`}
                alertLabel={
                  altitude.peak.humidityPct >= HUMIDITY_ALERT_THRESHOLD_PCT ? "Humedad alta" : undefined
                }
              />
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
            // Alerts off the worst-case reading (the max, when one exists),
            // not just the primary displayed value — a tile showing a mild
            // "24°C" with a "máx 32°C" caption is still real heat stress
            // somewhere on the ride, and shouldn't read as a cool one.
            alertLabel={
              (temperatureMaxC ?? temperatureC) >= HEAT_ALERT_THRESHOLD_C ? "Calor extremo" : undefined
            }
          />
          <WeatherStatTile
            label="Viento"
            icon={<Wind className="size-3 shrink-0" />}
            value={`${windSpeedKmh} km/h`}
            alertLabel={windSpeedKmh >= WIND_ALERT_THRESHOLD_KMH ? "Viento fuerte" : undefined}
          />
          <WeatherStatTile
            label="Humedad"
            value={`${humidityPct}%`}
            alertLabel={humidityPct >= HUMIDITY_ALERT_THRESHOLD_PCT ? "Humedad alta" : undefined}
          />
        </div>
      )}

      {source === "seasonal_average" && (
        <p className="text-[11px] text-zinc-400">
          Clima estimado mediante medias históricas estacionales — la fecha elegida está
          fuera del rango de previsión en vivo (14 días).
        </p>
      )}
    </div>
  );
}

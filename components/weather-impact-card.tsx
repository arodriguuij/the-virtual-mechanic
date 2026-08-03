"use client";

import { ArrowLeft, ArrowRight, Mountain, Thermometer, TriangleAlert, Wind } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

// "Unificación de Lienzo Claro" — this component's one call site is
// Card 03's own light `bg-white` card (`components/fueling-planner.tsx`),
// so every color here was restyled directly for that light surface rather
// than gaining a light/dark variant prop for a dark-surface call site that
// no longer exists (this card was briefly a dark olive tile — see that
// file's own design-system history).

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

// "Carrusel Híbrido PNS Style" — the flat two-column base-vs-cima
// comparison (or the single 3-tile row for a flat route) is now one
// horizontal swipeable strip of "weather point" cards instead — width of
// one card (280px min) + its own `gap-3` (12px), used by both the arrow
// buttons' own scroll-by amount and the progress bar's translate math.
const CAROUSEL_CARD_SCROLL_AMOUNT_PX = 292;

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

type WeatherPoint = {
  key: string;
  locationName: string;
  elevationM: number | null;
  temperatureC: number;
  temperatureCaption?: string;
  windSpeedKmh: number;
  humidityPct: number;
};

/** One Temp/Viento/Humedad mini stat, inside a single carousel card.
 * `alertLabel` switches the tile to a warm amber tint and renders as its
 * own line below `caption` — both can coexist (e.g. "+6°C vs. valle" *and*
 * "Calor extremo" at once), rather than one replacing the other. */
function CarouselStatTile({
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
        "min-w-0 rounded-lg border p-2",
        alert ? "border-amber-200/80 bg-amber-50/80" : "border-zinc-200/50 bg-white/80"
      )}
    >
      <span
        className={cn(
          "mb-0.5 flex items-center gap-1 truncate font-mono text-[9px] uppercase",
          alert ? "text-amber-700" : "text-zinc-400"
        )}
      >
        {icon}
        {label}
      </span>
      <span
        className={cn("block truncate font-sans text-sm font-bold", alert ? "text-amber-900" : "text-zinc-900")}
      >
        {value}
      </span>
      {caption && (
        <span className="block truncate text-[9px] font-mono font-normal text-zinc-500">{caption}</span>
      )}
      {alertLabel && (
        <span className="flex items-center gap-1 truncate text-[9px] font-mono font-semibold text-amber-700">
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
 * (still what's shown when there's no real climb) silently averages away a
 * mountain route's real valley-vs-summit temperature swing, and can even
 * miss it entirely on a route that starts high, descends into a hot
 * valley, then climbs — the valley, not the start, is where the real
 * thermal peak sits. Whenever the server flags a significant climb
 * (`altitude` non-null — the route's real elevation range ≥ 400m, or a
 * known summit ≥ 500m ASL, see `POST /api/fueling/plan`), `weatherPoints`
 * below carries 2 real points ("Valle / Salida" and "Cima del Puerto")
 * instead of 1 — both real Open-Meteo data at each point's own
 * coordinates when the multi-point sample succeeded, or the same
 * `-0.65°C/100m` lapse-rate estimate already used elsewhere in this app
 * otherwise — see `getLapseRateAdjustedTemperature`. Never a fabricated
 * third "Llegada" point: the server only ever returns base/peak readings
 * here, so the carousel only ever shows what's genuinely been sampled.
 *
 * "Carrusel Híbrido PNS Style" — these `weatherPoints` render as a
 * horizontal, touch-swipeable, snap-to-card strip (native `overflow-x-
 * auto`/`snap-x`, no carousel library) with a magnetic snap per card,
 * `←`/`→` buttons that scroll by exactly one card, and a thin progress
 * bar underneath that tracks *either* input in real time — both the
 * button-triggered `scrollBy` and a raw touch/trackpad drag fire the same
 * native `onScroll` event, so `handleOnScroll` is the one place that keeps
 * `scrollProgress` in sync regardless of which gesture drove it. A single
 * point (the common case — most rides have no real climb) renders as one
 * static, non-scrolling card: the arrows and progress bar are both hidden,
 * since there's nothing to page between.
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

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

  const weatherPoints: WeatherPoint[] = altitude
    ? [
        {
          key: "valley",
          locationName: "Valle / Salida",
          elevationM: altitude.base.elevationM,
          temperatureC: altitude.base.temperatureC,
          windSpeedKmh: altitude.base.windSpeedKmh,
          humidityPct: altitude.base.humidityPct,
        },
        {
          key: "peak",
          locationName: "Cima del Puerto",
          elevationM: altitude.peak.elevationM,
          temperatureC: altitude.peak.temperatureC,
          temperatureCaption: `${Math.round((altitude.peak.temperatureC - altitude.base.temperatureC) * 10) / 10}°C vs. valle`,
          windSpeedKmh: altitude.peak.windSpeedKmh,
          humidityPct: altitude.peak.humidityPct,
        },
      ]
    : [
        {
          key: "route",
          locationName: "Ruta",
          elevationM: null,
          temperatureC,
          temperatureCaption:
            temperatureMaxC != null && temperatureMaxC !== temperatureC ? `máx ${temperatureMaxC}°C` : undefined,
          windSpeedKmh,
          humidityPct,
        },
      ];

  const hasMultiplePoints = weatherPoints.length > 1;

  function handleArrowScroll(direction: "left" | "right") {
    scrollContainerRef.current?.scrollBy({
      left: direction === "left" ? -CAROUSEL_CARD_SCROLL_AMOUNT_PX : CAROUSEL_CARD_SCROLL_AMOUNT_PX,
      behavior: "smooth",
    });
  }

  function handleContainerScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setScrollProgress(maxScroll > 0 ? el.scrollLeft / maxScroll : 0);
  }

  return (
    // "Sin Contenedor Outer" — the old bordered `bg-zinc-50` card wrapping
    // this whole section is gone; it now sits as plain content directly in
    // Card 03's own flow (`components/fueling-planner.tsx`), not a
    // card-within-a-card. Only layout (`flex flex-col gap-3`) survives, no
    // background/border/padding of its own.
    <div className="flex flex-col gap-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-mono text-xs font-semibold tracking-wider text-zinc-900 uppercase">
            Impacto Térmico
          </h4>
          {/* The old fixed explainer ("Predicción meteorológica por tramos
              según la altimetría de la ruta (Open-Meteo)") and the real
              source-confidence line (live forecast vs. seasonal average
              vs. a generic planning estimate, plus the lapse-rate
              correction when one applies) used to render as two separate
              lines — merged into one concise, still-dynamic line, since
              `sourceLabel` already names the altimetry-based Open-Meteo
              forecast itself and this app never silently discards real
              computed data. */}
          <p className="truncate font-mono text-[11px] text-zinc-400">
            {sourceLabel}
            {!altitude && lapseRateAdjustmentC !== 0 && (
              <span className="inline-flex items-center gap-1">
                {" "}
                · <Mountain className="size-3" />
                {lapseRateAdjustmentC}°C por altitud
              </span>
            )}
          </p>
        </div>

        {/* Flechas de apoyo — hidden entirely on the common single-point
            case (nothing to page between), not just disabled. */}
        {hasMultiplePoints && (
          <div className="flex shrink-0 items-center gap-1 text-zinc-800">
            <button
              type="button"
              onClick={() => handleArrowScroll("left")}
              className="cursor-pointer rounded-full p-1.5 transition-colors hover:bg-zinc-100 active:scale-95"
              aria-label="Anterior"
            >
              <ArrowLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => handleArrowScroll("right")}
              className="cursor-pointer rounded-full p-1.5 transition-colors hover:bg-zinc-100 active:scale-95"
              aria-label="Siguiente"
            >
              <ArrowRight className="size-4" />
            </button>
          </div>
        )}
      </div>

      {/* Contenedor de tarjetas con swipe táctil nativo — real touch/
          trackpad/mouse-wheel scrolling, `snap-x snap-mandatory` +
          `snap-start` on each card for the magnetic anchor, `touch-pan-x`
          so a vertical page-scroll gesture starting on this strip isn't
          captured by it. `-mx-1 px-1` lets a `snap-start` card's own focus
          ring/shadow render uncropped at the strip's edges without
          widening the row past its parent. */}
      <div
        ref={scrollContainerRef}
        onScroll={handleContainerScroll}
        className="scrollbar-none -mx-1 flex touch-pan-x snap-x snap-mandatory gap-3 overflow-x-auto px-1 py-1"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {weatherPoints.map((point) => (
          <div
            key={point.key}
            className="min-w-70 max-w-75 shrink-0 snap-start rounded-xl border border-zinc-200/80 bg-[#F6F5F0] p-3.5 shadow-xs"
          >
            <span className="mb-2 flex items-center gap-1 truncate font-mono text-[10px] font-bold tracking-wider text-[#70685b] uppercase">
              {point.key === "peak" && <Mountain className="size-3 shrink-0" />}
              {point.locationName}
              {point.elevationM != null && ` (${point.elevationM}m)`}
            </span>
            <div className="grid grid-cols-3 gap-2">
              <CarouselStatTile
                label="Temp."
                icon={<Thermometer className="size-3 shrink-0" />}
                value={`${point.temperatureC}°C`}
                caption={point.temperatureCaption}
                // Alerts off the worst-case reading for the single-point
                // case (the max, when one exists) — a tile showing a mild
                // "24°C" with a "máx 32°C" caption is still real heat
                // stress somewhere on the ride, and shouldn't read as a
                // cool one.
                alertLabel={
                  (point.key === "route" ? (temperatureMaxC ?? point.temperatureC) : point.temperatureC) >=
                  HEAT_ALERT_THRESHOLD_C
                    ? "Calor extremo"
                    : undefined
                }
              />
              <CarouselStatTile
                label="Viento"
                icon={<Wind className="size-3 shrink-0" />}
                value={`${point.windSpeedKmh} km/h`}
                alertLabel={point.windSpeedKmh >= WIND_ALERT_THRESHOLD_KMH ? "Viento fuerte" : undefined}
              />
              <CarouselStatTile
                label="Humedad"
                value={`${point.humidityPct}%`}
                alertLabel={point.humidityPct >= HUMIDITY_ALERT_THRESHOLD_PCT ? "Humedad alta" : undefined}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Indicador de progreso PNS style — a thin `translateX` track
          synced from `scrollProgress`, which `handleContainerScroll`
          updates on every native `scroll` event regardless of whether it
          was a drag or a `handleArrowScroll` call. */}
      {hasMultiplePoints && (
        <div className="flex justify-center">
          <div className="relative h-0.5 w-24 overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full bg-[#70685b] transition-all duration-75"
              style={{
                width: `${100 / weatherPoints.length}%`,
                transform: `translateX(${scrollProgress * (weatherPoints.length - 1) * 100}%)`,
              }}
            />
          </div>
        </div>
      )}

      {source === "seasonal_average" && (
        <p className="text-[11px] text-zinc-500">
          Clima estimado mediante medias históricas estacionales — la fecha elegida está
          fuera del rango de previsión en vivo (14 días).
        </p>
      )}
    </div>
  );
}

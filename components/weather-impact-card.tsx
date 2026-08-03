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

// "Carrusel Híbrido PNS Style" — one horizontal swipeable strip of
// "weather point" cards — width of one card (280px min) + its own `gap-3`
// (12px), used by both the arrow buttons' own scroll-by amount, the
// progress bar's translate math, and `handleContainerScroll`'s own
// index-from-scroll-position estimate.
const CAROUSEL_CARD_SCROLL_AMOUNT_PX = 292;

const BRONZE = "#70685b";

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

/** One Temp/Viento/Humedad mini stat, inside a single carousel card (or the
 * compact-view summary row, which reuses this same tile). `alertLabel`
 * switches the tile to a warm amber tint and renders as its own line below
 * `caption` — both can coexist (e.g. "+6°C vs. valle" *and* "Calor extremo"
 * at once), rather than one replacing the other. */
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
 * "Perfil Altimétrico 2D" — a small SVG sparkline plotting each
 * `weatherPoint`'s real `elevationM` reading, nodes evenly spaced along the
 * x-axis (there's no real per-point distance-along-route figure in this
 * component's own data — only elevation and weather — so an index-based
 * layout is used rather than fabricating a km position for each stop).
 * The node matching `activeIndex` (the carousel's currently-focused card)
 * renders filled bronze with a white ring; every other node is a small
 * hollow bronze-outlined dot. A null `elevationM` (the single-point "Ruta"
 * case never reaches this component at all — see `hasMultiplePoints` below
 * — but a real route's own `base`/`peak` reading can each independently be
 * `null`) falls back to the profile's own min elevation, i.e. a flat
 * segment, rather than crashing the min/max scale.
 */
function AltitudeProfileSvg({ points, activeIndex }: { points: WeatherPoint[]; activeIndex: number }) {
  const width = 300;
  const height = 56;
  const padX = 14;
  const padY = 10;

  const elevations = points.map((p) => p.elevationM ?? 0);
  const minEl = Math.min(...elevations);
  const maxEl = Math.max(...elevations);
  const range = maxEl - minEl || 1;
  const stepX = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0;

  const coords = points.map((p, i) => {
    const x = padX + stepX * i;
    const normalized = ((p.elevationM ?? minEl) - minEl) / range;
    const y = height - padY - normalized * (height - padY * 2);
    return { x, y };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const areaPath =
    coords.length > 0
      ? `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${height} L ${coords[0].x.toFixed(1)} ${height} Z`
      : "";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full" role="img" aria-label="Perfil altimétrico de la ruta">
      {areaPath && <path d={areaPath} fill={BRONZE} fillOpacity={0.08} stroke="none" />}
      <path d={linePath} fill="none" stroke={BRONZE} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} />
      {coords.map((c, i) => (
        <circle
          key={points[i].key}
          cx={c.x}
          cy={c.y}
          r={i === activeIndex ? 4.5 : 3}
          fill={i === activeIndex ? BRONZE : "#ffffff"}
          stroke={BRONZE}
          strokeWidth={i === activeIndex ? 2 : 1.5}
          className="transition-all duration-150"
        />
      ))}
    </svg>
  );
}

/**
 * "Badge de Clima e Impacto Térmico Dinámico" — the pre-ride planner's
 * weather readout: real Temp/Viento/Humedad figures from Open-Meteo (see
 * `POST /api/fueling/plan`'s `weather` object).
 *
 * "Cronograma Térmico Altimétrico 2D & Carrusel PNS Style" — 2 levels of
 * depth. **Vista compacta** (default) shows only the 3-tile Temp/Viento/
 * Humedad summary, driven by the ride-wide average figures this component
 * already receives as props — no per-point averaging invented here, this
 * *is* the real overall figure the server already computed. **Vista
 * expandida** (toggled via the "Cronograma térmico por puertos" button,
 * only offered at all when there's more than one real sampled point — see
 * `hasMultiplePoints`) adds the 2D altimetry sparkline above and the
 * horizontal swipeable point-by-point carousel below it, both kept in sync
 * live off the same `activeScrollIndex`/`scrollProgress` state that drives
 * the progress bar — whichever of touch-drag or the `←`/`→` buttons moved
 * the strip, `handleContainerScroll` (the one native `onScroll` listener)
 * is what updates all three.
 *
 * Whenever the server flags a significant climb (`altitude` non-null — the
 * route's real elevation range ≥ 400m, or a known summit ≥ 500m ASL, see
 * `POST /api/fueling/plan`), `weatherPoints` below carries 2 real points
 * ("Valle / Salida" and "Cima del Puerto") instead of 1 — both real
 * Open-Meteo data at each point's own coordinates when the multi-point
 * sample succeeded, or the same `-0.65°C/100m` lapse-rate estimate already
 * used elsewhere in this app otherwise — see `getLapseRateAdjustedTemperature`.
 * Never a fabricated third "Llegada" point: the server only ever returns
 * base/peak readings here, so the carousel only ever shows what's genuinely
 * been sampled.
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
  const [activeScrollIndex, setActiveScrollIndex] = useState(0);
  // "Vista Compacta (Por defecto)" — the card opens collapsed, showing only
  // the always-visible 3-tile summary; the athlete opts into the heavier
  // altimetry/carousel detail rather than it always taking up vertical
  // space.
  const [showTimeline, setShowTimeline] = useState(false);

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
          temperatureCaption: `${Math.round((altitude.peak.temperatureC - altitude.base.temperatureC) * 10) / 10}°C vs. valle`,
          temperatureC: altitude.peak.temperatureC,
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

  // "Deshabilitación por Índice" — driven straight off `activeScrollIndex`
  // (which card is currently focused) rather than the scroll container's
  // own `scrollProgress` percentage. `scrollProgress` is a real-valued
  // fraction of `scrollWidth - clientWidth`, which can land a hair short of
  // `0`/`1` depending on how the browser rounds sub-pixel scroll offsets —
  // the `<= 0.01`/`>= 0.99` tolerance band worked around that, but an
  // index comparison has no rounding to work around in the first place.
  const isAtStart = activeScrollIndex === 0;
  const isAtEnd = activeScrollIndex >= weatherPoints.length - 1;

  // "Fix de Scroll Magnético por Tarjetas" — a raw `scrollBy(292px)` drifts
  // out of sync with each card's own real rendered width (it's a `min-w-70
  // max-w-75` box, not a fixed 292px one) after a couple of arrow presses,
  // landing mid-card instead of anchored to its `snap-start` edge. Scrolling
  // straight to the target index's own DOM child via `scrollIntoView`
  // anchors on that card's real boundary every time, however wide it
  // actually rendered — `inline: "start"` matches the strip's own
  // `snap-start` alignment, `block: "nearest"` keeps this a purely
  // horizontal scroll with no vertical page movement.
  function handleScrollToIndex(direction: "left" | "right") {
    const container = scrollContainerRef.current;
    if (!container) return;
    const newIndex =
      direction === "left" ? Math.max(0, activeScrollIndex - 1) : Math.min(weatherPoints.length - 1, activeScrollIndex + 1);
    const targetCard = container.children[newIndex] as HTMLElement | undefined;
    targetCard?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }

  // The one native `onScroll` handler both the button-triggered
  // `scrollBy` and a raw touch/trackpad drag fire — this is what keeps
  // `scrollProgress` (the progress bar) and `activeScrollIndex` (the
  // altimetry sparkline's highlighted node) in sync regardless of which
  // gesture drove the strip.
  function handleContainerScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const maxScroll = scrollWidth - clientWidth;
    setScrollProgress(maxScroll > 0 ? scrollLeft / maxScroll : 0);
    const currentIndex = Math.min(
      Math.round(scrollLeft / CAROUSEL_CARD_SCROLL_AMOUNT_PX),
      weatherPoints.length - 1
    );
    setActiveScrollIndex(Math.max(0, currentIndex));
  }

  return (
    // "Sin Contenedor Outer" — this whole section sits as plain content
    // directly in Card 03's own flow (`components/fueling-planner.tsx`),
    // not a card-within-a-card. Only layout survives, no background/
    // border/padding of its own.
    <div className="flex flex-col gap-3">
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

      {/* Vista Compacta — the same 3-tile Temp/Viento/Humedad readout as
          before, but now driven by the ride-wide average props directly
          (real data already computed server-side) rather than one card
          per sampled point — the per-point breakdown moved into the
          carousel below, behind the "Desplegar" toggle. */}
      <div className="grid grid-cols-3 gap-2">
        <CarouselStatTile
          label="Temp. promedio"
          icon={<Thermometer className="size-3 shrink-0" />}
          value={`${temperatureC}°C`}
          caption={temperatureMaxC != null && temperatureMaxC !== temperatureC ? `máx ${temperatureMaxC}°C` : undefined}
          alertLabel={(temperatureMaxC ?? temperatureC) >= HEAT_ALERT_THRESHOLD_C ? "Calor extremo" : undefined}
        />
        <CarouselStatTile
          label="Viento"
          icon={<Wind className="size-3 shrink-0" />}
          value={`${windSpeedKmh} km/h`}
          alertLabel={windSpeedKmh >= WIND_ALERT_THRESHOLD_KMH ? "Viento fuerte" : undefined}
        />
        <CarouselStatTile
          label="Humedad"
          value={`${humidityPct}%`}
          alertLabel={humidityPct >= HUMIDITY_ALERT_THRESHOLD_PCT ? "Humedad alta" : undefined}
        />
      </div>

      {/* Botón desplegable — only offered when there's a real second point
          to page to (a significant climb was actually sampled); a flat
          route's single "Ruta" reading has nothing further to expand
          into, so no button/altimetry/carousel renders at all in that
          case, matching this component's long-standing "nothing to page
          between" convention. */}
      {hasMultiplePoints && (
        <button
          type="button"
          onClick={() => setShowTimeline((v) => !v)}
          className="mt-1 flex w-full items-center justify-between rounded-xl border border-zinc-200/80 bg-[#F6F5F0] px-3 py-2 font-mono text-xs text-[#70685b] transition-colors hover:bg-zinc-100"
        >
          <span className="flex items-center gap-1.5 font-medium">
            📈 Cronograma térmico por puertos ({weatherPoints.length} hitos)
          </span>
          <span>{showTimeline ? "▲ Ocultar" : "▼ Desplegar"}</span>
        </button>
      )}

      {hasMultiplePoints && showTimeline && (
        <div className="flex flex-col gap-3">
          {/* Encabezado de Navegación PNS Style — a second, smaller header
              scoped to the expanded detail itself (distinct from the
              card's own always-visible title above), pairing the section
              name with the strip's own `←`/`→` controls. */}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h5 className="font-mono text-[10px] font-bold tracking-wider text-zinc-900 uppercase">
                Impacto Térmico
              </h5>
              <p className="truncate font-mono text-[10px] text-zinc-400">Previsión por altimetría</p>
            </div>
            <div className="flex shrink-0 items-center gap-1 text-zinc-800">
              <button
                type="button"
                onClick={() => handleScrollToIndex("left")}
                disabled={isAtStart}
                className="cursor-pointer rounded-full p-1.5 transition-colors hover:bg-zinc-100 active:scale-95 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-20 disabled:hover:bg-transparent disabled:active:scale-100"
                aria-label="Anterior puerto"
              >
                <ArrowLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => handleScrollToIndex("right")}
                disabled={isAtEnd}
                className="cursor-pointer rounded-full p-1.5 transition-colors hover:bg-zinc-100 active:scale-95 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-20 disabled:hover:bg-transparent disabled:active:scale-100"
                aria-label="Siguiente puerto"
              >
                <ArrowRight className="size-4" />
              </button>
            </div>
          </div>

          {/* Perfil Altimétrico 2D — the currently-focused carousel card's
              own node highlights live, synced off the same
              `activeScrollIndex` the carousel's `onScroll` handler already
              maintains. */}
          <AltitudeProfileSvg points={weatherPoints} activeIndex={activeScrollIndex} />

          {/* Contenedor de tarjetas con swipe táctil nativo — real touch/
              trackpad/mouse-wheel scrolling, `snap-x snap-mandatory` +
              `snap-start` on each card for the magnetic anchor, `touch-pan-x`
              so a vertical page-scroll gesture starting on this strip isn't
              captured by it. `-mx-1 px-1` lets a `snap-start` card's own focus
              ring/shadow render uncropped at the strip's edges without
              widening the row past its parent. Rendered in strict
              chronological/route order — the same order `weatherPoints`
              itself is already built in (Valle/Salida → Cima del Puerto). */}
          <div
            ref={scrollContainerRef}
            onScroll={handleContainerScroll}
            className="scrollbar-none -mx-1 flex touch-pan-x snap-x snap-mandatory gap-3 overflow-x-auto px-1 py-1"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {weatherPoints.map((point, index) => (
              <div
                key={point.key}
                className={cn(
                  "min-w-70 max-w-75 shrink-0 snap-start rounded-xl border p-3.5 shadow-xs transition-colors",
                  index === activeScrollIndex
                    ? "border-[#70685b]/40 bg-[#F6F5F0]"
                    : "border-zinc-200/80 bg-[#F6F5F0]"
                )}
              >
                <span className="mb-0.5 flex items-center gap-1 truncate font-mono text-[10px] font-bold tracking-wider text-[#70685b] uppercase">
                  {point.key === "peak" && <Mountain className="size-3 shrink-0" />}
                  {point.locationName}
                </span>
                {/* Línea 2 — real elevation only; this component receives
                    no per-point distance-along-route figure, so no km
                    value is shown here rather than inventing one. */}
                <span className="mb-2 block font-mono text-[10px] text-zinc-400">
                  {point.elevationM != null ? `${point.elevationM}m altitud` : "Altitud no disponible"}
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <CarouselStatTile
                    label="Temp."
                    icon={<Thermometer className="size-3 shrink-0" />}
                    value={`${point.temperatureC}°C`}
                    caption={point.temperatureCaption}
                    alertLabel={point.temperatureC >= HEAT_ALERT_THRESHOLD_C ? "Calor extremo" : undefined}
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
              updates on every native `scroll` event regardless of whether
              it was a drag or a `handleArrowScroll` call. */}
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

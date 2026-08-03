"use client";

import { ArrowLeft, ArrowRight, ChevronDown, Mountain, Thermometer, TriangleAlert, Wind } from "lucide-react";
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

/** Real per-hito weather sample from `POST /api/fueling/plan`'s
 * `weather.weatherPoints` — see `detectElevationMilestones`
 * (`lib/utils/elevation-parser.ts`) for how each hito was found and
 * `getPeakName` (`lib/overpass.ts`) for how a "peak" hito's `locationName`
 * was resolved. */
export type ServerWeatherPoint = {
  key: string;
  locationName: string;
  elevationM: number;
  distanceKm: number;
  distanceFraction: number;
  temperatureC: number;
  humidityPct: number;
  windSpeedKmh: number;
};

type WeatherPointType = "start" | "peak" | "valley" | "end" | "route";

type WeatherPoint = {
  key: string;
  type: WeatherPointType;
  locationName: string;
  elevationM: number | null;
  distanceFraction: number;
  distanceKm: number | null;
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
          "mb-0.5 flex items-center gap-1 truncate font-mono text-[9px]",
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
 * "Perfil Altimétrico 2D" — the route's real elevation curve (`profile`, a
 * `{distanceFraction, elevationM}[]` — Card 03's own thinned copy of the
 * server's/GPX's real altitude stream) with each `weatherPoint` marked at
 * its own true position along that curve, rather than nodes evenly spaced
 * by index. Falls back to a synthetic 2-point curve built from `points`
 * alone (evenly spaced, min/max scaled) whenever no real `profile` is
 * available — the pre-multi-hito behavior, still needed for a route whose
 * elevation stream never resolved (e.g. an older/degraded weather sample).
 * The node matching `activeIndex` (the carousel's currently-focused card)
 * renders filled bronze with a white ring; every other node is a small
 * hollow bronze-outlined dot. Clicking any node scrolls the carousel to
 * that same card via `onPointClick`.
 */
function AltitudeProfileSvg({
  points,
  profile,
  activeIndex,
  onPointClick,
}: {
  points: WeatherPoint[];
  profile: { distanceFraction: number; elevationM: number }[];
  activeIndex: number;
  onPointClick: (index: number) => void;
}) {
  const width = 300;
  const height = 56;
  const padX = 14;
  const padY = 10;

  const hasRealProfile = profile.length >= 2;
  // Without a real profile, fall back to the old "one sample per point,
  // evenly spaced" curve — every downstream min/max/x/y computation below
  // reads from this same `curvePoints` array either way.
  const curvePoints: { distanceFraction: number; elevationM: number }[] = hasRealProfile
    ? profile
    : points.map((p, i) => ({
        distanceFraction: points.length > 1 ? i / (points.length - 1) : 0,
        elevationM: p.elevationM ?? 0,
      }));

  const elevations = curvePoints.map((p) => p.elevationM);
  const minEl = Math.min(...elevations);
  const maxEl = Math.max(...elevations);
  const range = maxEl - minEl || 1;

  const toX = (fraction: number) => padX + Math.max(0, Math.min(1, fraction)) * (width - padX * 2);
  const toY = (elevationM: number) => height - padY - ((elevationM - minEl) / range) * (height - padY * 2);

  const curveCoords = curvePoints.map((p) => ({ x: toX(p.distanceFraction), y: toY(p.elevationM) }));
  const linePath = curveCoords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    curveCoords.length > 0
      ? `${linePath} L ${curveCoords[curveCoords.length - 1].x.toFixed(1)} ${height} L ${curveCoords[0].x.toFixed(1)} ${height} Z`
      : "";

  // Each weather-point marker sits at its own real distance-along-route
  // position, using the curve's own min/max scale so a marker always lands
  // exactly on the silhouette beneath it.
  const markerCoords = points.map((p) => ({
    x: toX(p.distanceFraction),
    y: toY(p.elevationM ?? minEl),
  }));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full" role="img" aria-label="Perfil altimétrico de la ruta">
      {areaPath && <path d={areaPath} fill={BRONZE} fillOpacity={0.08} stroke="none" />}
      <path d={linePath} fill="none" stroke={BRONZE} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} />
      {markerCoords.map((c, i) => (
        <circle
          key={points[i].key}
          cx={c.x}
          cy={c.y}
          r={i === activeIndex ? 4.5 : 3}
          fill={i === activeIndex ? BRONZE : "#ffffff"}
          stroke={BRONZE}
          strokeWidth={i === activeIndex ? 2 : 1.5}
          className="cursor-pointer transition-all duration-150"
          onClick={() => onPointClick(i)}
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
 * the progress bar — whichever of touch-drag, the `←`/`→` buttons, or a
 * direct click on the SVG's own nodes moved the strip,
 * `handleContainerScroll` (the one native `onScroll` listener) is what
 * keeps all three in sync.
 *
 * **`weatherPoints`** (from `POST /api/fueling/plan`'s own
 * `weather.weatherPoints`, see `ServerWeatherPoint`/`detectElevationMilestones`)
 * is the real, granular Salida/Valle/Cima/Llegada breakdown — a multi-pass
 * mountain route (2+ real cols) surfaces every one of them, each with its
 * own Overpass-resolved name for a "peak" hito, not just a single valley-
 * vs-summit pair. Falls back to the older 2-point `altitude` prop (still
 * sent whenever the route has a significant climb but no granular
 * milestones resolved) and, failing that, the single blended "Ruta"
 * reading — never a fabricated third point.
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
  weatherPoints: serverWeatherPoints = [],
  elevationProfile = [],
}: {
  temperatureC: number;
  temperatureMaxC: number | null;
  humidityPct: number;
  windSpeedKmh: number;
  source: "dynamic" | "planning_default" | "seasonal_average";
  multiPointSample: boolean;
  lapseRateAdjustmentC: number;
  altitude?: AltitudeWeather | null;
  weatherPoints?: ServerWeatherPoint[];
  elevationProfile?: { distanceFraction: number; elevationM: number }[];
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

  // "Rutas Multipuerto de Alta Montaña" — the real, granular hito list
  // always wins when the server resolved one (2+ real cols on the route),
  // falling back to the older 2-point valley/summit comparison, and finally
  // to the single blended reading — never all three at once.
  const weatherPoints: WeatherPoint[] =
    serverWeatherPoints.length > 0
      ? serverWeatherPoints.map((p) => ({
          key: p.key,
          type: p.key.startsWith("start")
            ? "start"
            : p.key.startsWith("peak")
              ? "peak"
              : p.key.startsWith("valley")
                ? "valley"
                : "end",
          locationName: p.locationName,
          elevationM: p.elevationM,
          distanceFraction: p.distanceFraction,
          distanceKm: p.distanceKm,
          temperatureC: p.temperatureC,
          windSpeedKmh: p.windSpeedKmh,
          humidityPct: p.humidityPct,
        }))
      : altitude
        ? [
            {
              key: "valley",
              type: "valley",
              locationName: "Valle / Salida",
              elevationM: altitude.base.elevationM,
              distanceFraction: 0,
              distanceKm: null,
              temperatureC: altitude.base.temperatureC,
              windSpeedKmh: altitude.base.windSpeedKmh,
              humidityPct: altitude.base.humidityPct,
            },
            {
              key: "peak",
              type: "peak",
              locationName: "Cima del Puerto",
              elevationM: altitude.peak.elevationM,
              distanceFraction: 1,
              distanceKm: null,
              temperatureCaption: `${Math.round((altitude.peak.temperatureC - altitude.base.temperatureC) * 10) / 10}°C vs. valle`,
              temperatureC: altitude.peak.temperatureC,
              windSpeedKmh: altitude.peak.windSpeedKmh,
              humidityPct: altitude.peak.humidityPct,
            },
          ]
        : [
            {
              key: "route",
              type: "route",
              locationName: "Ruta",
              elevationM: null,
              distanceFraction: 0,
              distanceKm: null,
              temperatureC,
              temperatureCaption:
                temperatureMaxC != null && temperatureMaxC !== temperatureC ? `máx ${temperatureMaxC}°C` : undefined,
              windSpeedKmh,
              humidityPct,
            },
          ];

  // "Condicionamiento de Impacto Térmico Global vs. Cronograma Unificado" —
  // a route with 2+ real sampled hitos gets the granular carousel/SVG
  // *instead of* the compact 3-tile average (a blended temperature is
  // actively misleading once the ride covers a real valley-to-summit
  // range), auto-expanded by default rather than behind an extra tap —
  // there's nothing else to show on this card once the average is hidden,
  // so collapsing it by default would just be an empty-looking card.
  const hasMultiplePoints = weatherPoints.length > 1;
  const minTemperatureC = hasMultiplePoints ? Math.round(Math.min(...weatherPoints.map((p) => p.temperatureC))) : null;
  const maxTemperatureC = hasMultiplePoints ? Math.round(Math.max(...weatherPoints.map((p) => p.temperatureC))) : null;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeScrollIndex, setActiveScrollIndex] = useState(0);
  // "Cronograma Unificado por Hitos" — starts expanded whenever there's a
  // real multi-hito schedule to show (see the comment above); a lone
  // "Ruta" reading has nothing to expand into and stays collapsed/moot,
  // same as before. Still toggleable — an athlete who's already read the
  // schedule can collapse it back down.
  const [showTimeline, setShowTimeline] = useState(hasMultiplePoints);

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
  function handleScrollToSpecificIndex(index: number) {
    const container = scrollContainerRef.current;
    if (!container) return;
    const clamped = Math.max(0, Math.min(weatherPoints.length - 1, index));
    const targetCard = container.children[clamped] as HTMLElement | undefined;
    targetCard?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }

  function handleScrollToIndex(direction: "left" | "right") {
    handleScrollToSpecificIndex(direction === "left" ? activeScrollIndex - 1 : activeScrollIndex + 1);
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
        <h4 className="font-mono text-xs font-semibold tracking-wider text-zinc-900">
          Impacto térmico
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

      {/* "Condicionamiento de Impacto Térmico Global vs. Cronograma
          Unificado" — a route with fewer than 2 real sampled hitos (a flat
          route, or Entreno Manual's single blended reading) shows only this
          static Temp/Viento/Humedad summary. 2+ hitos hide it entirely in
          favor of the unified schedule below instead — a single averaged
          temperature is actively misleading once the ride covers a real
          valley-to-summit range, and showing both at once just duplicates
          the same numbers in two places on a narrow phone. */}
      {!hasMultiplePoints ? (
        <div className="grid grid-cols-3 gap-2">
          <CarouselStatTile
            label="Temperatura promedio"
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
      ) : (
        // Contenedor Unificado del Cronograma por Hitos — one bordered
        // porcelain container holding both the toggle header (with the
        // route's real min/max temp range and hito count baked directly
        // into it, no separate summary tile needed) and, once expanded,
        // the altimetry SVG + carousel. Starts expanded (see the
        // `showTimeline` initializer above) — sobrio PNS style: no emoji,
        // no "Desplegar"/"Ocultar" text, a plain rotating chevron instead.
        <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-3.5 transition-all">
          <button
            type="button"
            onClick={() => setShowTimeline((v) => !v)}
            className="group flex w-full cursor-pointer items-center justify-between py-1 text-left"
            aria-expanded={showTimeline}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-xs font-bold tracking-tight text-zinc-900">
                Cronograma térmico por puertos
              </span>
              <span className="shrink-0 font-mono text-[11px] font-medium text-zinc-500">
                ({minTemperatureC}°C — {maxTemperatureC}°C · {weatherPoints.length} hitos)
              </span>
            </div>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-zinc-500 transition-transform duration-200 ease-out group-hover:text-zinc-900",
                showTimeline && "rotate-180"
              )}
            />
          </button>

          {showTimeline && (
            <div className="mt-3 flex flex-col gap-3 border-t border-zinc-200/60 pt-3">
              {/* Nav Header — the strip's own `←`/`→` controls, paired
                  with a short caption describing what the carousel below
                  shows (no repeated "Impacto Térmico" title here — the
                  toggle button above already carries it). */}
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[10px] font-medium tracking-wider text-zinc-500">
                  Previsión por altimetría y hora de paso
                </span>
                <div className="flex shrink-0 items-center gap-1 text-zinc-800">
                  <button
                    type="button"
                    onClick={() => handleScrollToIndex("left")}
                    disabled={isAtStart}
                    className="cursor-pointer rounded-full p-1.5 transition-colors hover:bg-zinc-100 active:scale-95 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-20 disabled:hover:bg-transparent disabled:active:scale-100"
                    aria-label="Anterior puerto"
                  >
                    <ArrowLeft className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleScrollToIndex("right")}
                    disabled={isAtEnd}
                    className="cursor-pointer rounded-full p-1.5 transition-colors hover:bg-zinc-100 active:scale-95 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-20 disabled:hover:bg-transparent disabled:active:scale-100"
                    aria-label="Siguiente puerto"
                  >
                    <ArrowRight className="size-3.5" />
                  </button>
                </div>
              </div>

              {/* Perfil Altimétrico 2D — the currently-focused carousel
                  card's own node highlights live, synced off the same
                  `activeScrollIndex` the carousel's `onScroll` handler
                  already maintains. Clicking any node jumps the carousel
                  straight to that card. */}
              <div className="rounded-xl border border-zinc-200/60 bg-white/70 p-2">
                <AltitudeProfileSvg
                  points={weatherPoints}
                  profile={elevationProfile}
                  activeIndex={activeScrollIndex}
                  onPointClick={handleScrollToSpecificIndex}
                />
              </div>

              {/* Contenedor de tarjetas con swipe táctil nativo — real
                  touch/trackpad/mouse-wheel scrolling, `snap-x
                  snap-mandatory` + `snap-start` on each card for the
                  magnetic anchor, `touch-pan-x` so a vertical page-scroll
                  gesture starting on this strip isn't captured by it.
                  `-mx-1 px-1` lets a `snap-start` card's own focus ring/
                  shadow render uncropped at the strip's edges without
                  widening the row past its parent. Rendered in strict
                  chronological/route order — the same order
                  `weatherPoints` itself is already built in (Salida →
                  Valle → Cima → ... → Llegada). */}
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
                      index === activeScrollIndex ? "border-[#70685b]/40 bg-white" : "border-zinc-200/80 bg-white"
                    )}
                  >
                    <span className="mb-0.5 flex items-center gap-1 truncate font-mono text-[10px] font-bold tracking-wider text-[#70685b] uppercase">
                      {point.type === "peak" && <Mountain className="size-3 shrink-0" />}
                      {point.locationName}
                    </span>
                    {/* Línea 2 — real elevation, plus the real distance-
                        along-route (Km X) whenever a granular server hito
                        supplied one (a 2-point altitude fallback never had
                        a real km figure to show). */}
                    <span className="mb-2 block font-mono text-[10px] text-zinc-400">
                      {point.distanceKm != null ? `Km ${point.distanceKm} · ` : ""}
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

              {/* Indicador de progreso PNS style — a thin `translateX`
                  track synced from `scrollProgress`, which
                  `handleContainerScroll` updates on every native `scroll`
                  event regardless of whether it was a drag or a
                  `handleArrowScroll` call. */}
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

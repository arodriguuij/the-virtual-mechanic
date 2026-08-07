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

// "Umbrales Climáticos Fisiológicos" — a finer-grained color scale on the
// carousel's own value text, layered on top of (not replacing) the
// coarser 2-tier `alertLabel` mechanism above (which still drives the
// tile's background tint and its own "Calor extremo"/"Viento fuerte"/
// "Humedad alta" badge line). These color the *number itself*, so an
// athlete scanning the strip reads temperature/wind intensity at a glance
// from color alone, not just from whichever tile happens to cross the
// coarser alert threshold. Bands widened from an earlier pass's 15-23°C
// comfort zone to 13-24°C — a genuinely comfortable cycling temperature
// (e.g. 23°C) was being flagged amber as if it were already a heat
// concern, a false alarm this wider, more physiologically accurate
// "confort" band avoids.
export function getTempColorClass(temp: number): string {
  if (temp < 13) return "text-sky-600 font-semibold"; // Frío (< 13°C)
  if (temp <= 24) return "text-zinc-900 font-bold"; // Confort / Ideal (13-24°C) — neutro
  if (temp <= 29) return "text-amber-600 font-semibold"; // Moderado / Calor (25-29°C)
  return "text-rose-600 font-bold"; // Extremo (≥ 30°C)
}

export function getWindColorClass(wind: number): string {
  if (wind < 15) return "text-zinc-900 font-bold"; // Neutro (< 15 km/h)
  if (wind <= 25) return "text-amber-600 font-semibold"; // Moderado (15-25 km/h)
  return "text-rose-600 font-bold"; // Fuerte (> 25 km/h)
}

export function getHumidityColorClass(humidity: number): string {
  if (humidity >= 70) return "text-amber-600 font-semibold";
  return "text-zinc-900 font-bold";
}

// "Carrusel Híbrido PNS Style" — one horizontal swipeable strip of
// "weather point" cards — the real per-card width is measured live (see
// `handleContainerScroll`), but before the strip has ever rendered a first
// card to measure, this fallback assumes one card (280px min) + its own
// `gap-3`.
const CAROUSEL_CARD_SCROLL_AMOUNT_PX = 292;
// The strip's own `gap-3` (12px) — added to the *real* measured card width
// in `handleContainerScroll`, since Tailwind's `gap` isn't part of an
// element's own `getBoundingClientRect()`.
const CAROUSEL_CARD_GAP_PX = 12;

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
 * at once), rather than one replacing the other. `valueColorClass` (from
 * `getTempColorClass`/`getWindColorClass`/`getHumidityColorClass` above)
 * overrides the value's own default color/weight with the finer-grained
 * semáforo — independent of `alertLabel`, which still governs the tile's
 * background tint. */
function CarouselStatTile({
  label,
  icon,
  value,
  caption,
  alertLabel,
  valueColorClass,
}: {
  label: string;
  icon?: ReactNode;
  value: string;
  caption?: string;
  alertLabel?: string;
  valueColorClass?: string;
}) {
  // "Aplanamiento de UI" — no border here anymore, a background tint alone
  // (porcelain `zinc-50` normally, amber once a real threshold is crossed)
  // is enough to read as its own tile without stacking another framed box
  // on top of whatever already-flat surface this renders inside.
  const alert = Boolean(alertLabel);
  return (
    <div className={cn("min-w-0 rounded-lg p-2", alert ? "bg-amber-50/80" : "bg-zinc-50/80")}>
      <span
        className={cn(
          "mb-0.5 flex items-center gap-1 truncate font-mono text-[9px]",
          alert ? "text-amber-700" : "text-zinc-400"
        )}
      >
        {icon}
        {label}
      </span>
      <span className={cn("block truncate font-sans text-sm", valueColorClass ?? (alert ? "text-amber-900 font-bold" : "text-zinc-900 font-bold"))}>
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
        // "Sincronización Bidireccional" — 2 circles per hito: the small
        // visible marker (design) and a much larger, fully transparent one
        // stacked on top purely as a real touch target (`r=16`, ~32px
        // across) — the visible dot alone (r 3.5-6) is smaller than any
        // reasonable tap-accuracy tolerance on a real phone, so without this
        // second hitbox circle a rider could tap right next to a hito and
        // miss it entirely.
        <g key={points[i].key}>
          <circle
            cx={c.x}
            cy={c.y}
            r={i === activeIndex ? 6 : 3.5}
            fill={i === activeIndex ? BRONZE : "#a1a1aa"}
            stroke={i === activeIndex ? "#ffffff" : "none"}
            strokeWidth={i === activeIndex ? 2 : 0}
            className="pointer-events-none transition-all duration-150"
          />
          <circle
            cx={c.x}
            cy={c.y}
            r={16}
            fill="transparent"
            className="cursor-pointer touch-manipulation"
            onClick={() => onPointClick(i)}
          />
        </g>
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
  // "Jerarquía en Subtítulo de Impacto Térmico" — split into a primary label
  // (`sourceLabelBase`, the confidence tier — real forecast vs. seasonal
  // average vs. a generic estimate) and a secondary, visually de-emphasized
  // detail (`sourceLabelDetail`, the actual sample points) rather than one
  // flat string — the sample-point breakdown is supporting detail, not the
  // headline claim, so it renders smaller/dimmer instead of competing
  // equally with "Previsión real Open-Meteo" for attention.
  //
  // `multiPointSample` is true precisely when a real geographic multi-point
  // sample (start/valle/cima/llegada) succeeded — only possible in
  // route/GPX mode with a genuine elevation profile ("hay puerto"). Entreno
  // Manual (no coordinates at all) or a flat route with no meaningful
  // peak/trough both fall through to the same single-location forecast,
  // averaged across the ride's own departure-to-arrival window — "mitad de
  // ruta" describes that time-averaged midpoint reading in plain language,
  // not a second physical location actually being sampled.
  const sourceLabelBase =
    source === "dynamic"
      ? "Previsión real Open-Meteo"
      : source === "seasonal_average"
        ? "media histórica estacional"
        : "estimación genérica";
  const sourceLabelDetail =
    source === "dynamic" ? (multiPointSample ? "inicio / valle / cima / llegada" : "inicio / mitad de ruta / llegada") : null;

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

  // "Deshabilitación por Índice" — driven straight off `activeScrollIndex`
  // (which card is currently focused) rather than the scroll container's
  // own `scrollProgress` percentage. `scrollProgress` is a real-valued
  // fraction of `scrollWidth - clientWidth`, which can land a hair short of
  // `0`/`1` depending on how the browser rounds sub-pixel scroll offsets —
  // the `<= 0.01`/`>= 0.99` tolerance band worked around that, but an
  // index comparison has no rounding to work around in the first place.
  const isAtStart = activeScrollIndex === 0;
  const isAtEnd = activeScrollIndex >= weatherPoints.length - 1;

  // "Sincronización Bidireccional: SVG → Carrusel" — a tap on any hito in
  // the altimetry SVG (or the `←`/`→` buttons) scrolls straight to that
  // index's own DOM child via `scrollIntoView`, anchoring on its real
  // rendered boundary rather than a raw `scrollBy` pixel guess (which used
  // to drift out of sync with each card's own real width, `min-w-70
  // max-w-75`, after a couple of presses). `inline: "center"` centers the
  // target card in the visible strip — a clearer "this is the one you
  // tapped" cue than aligning it flush to the left edge — `block: "nearest"`
  // keeps this a purely horizontal scroll with no vertical page movement.
  function handleScrollToSpecificIndex(index: number) {
    const container = scrollContainerRef.current;
    if (!container) return;
    const clamped = Math.max(0, Math.min(weatherPoints.length - 1, index));
    const targetCard = container.children[clamped] as HTMLElement | undefined;
    targetCard?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }

  function handleScrollToIndex(direction: "left" | "right") {
    handleScrollToSpecificIndex(direction === "left" ? activeScrollIndex - 1 : activeScrollIndex + 1);
  }

  // "Sincronización Bidireccional: Carrusel → SVG" — the one native
  // `onScroll` handler every gesture (a raw touch/trackpad drag, or the
  // `scrollIntoView` calls above) fires, keeping `scrollProgress` (the
  // progress bar) and `activeScrollIndex` (the altimetry SVG's highlighted
  // node) in sync in real time regardless of which one actually drove the
  // strip. The active index is derived from the *real* rendered width of
  // the strip's own first card (`getBoundingClientRect`), not the fixed
  // `CAROUSEL_CARD_SCROLL_AMOUNT_PX` guess (kept only as a fallback before
  // the strip has rendered) — this app's cards are `w-full` (matching
  // whatever the container's own available width happens to be at each
  // breakpoint, not one fixed size), so measuring the real DOM node is
  // what keeps this accurate instead of drifting the way a hardcoded
  // constant would as content/viewport width changes.
  function handleContainerScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const maxScroll = scrollWidth - clientWidth;
    setScrollProgress(maxScroll > 0 ? scrollLeft / maxScroll : 0);
    const firstCardWidth = el.children[0]?.getBoundingClientRect().width || CAROUSEL_CARD_SCROLL_AMOUNT_PX;
    const currentIndex = Math.min(
      Math.round(scrollLeft / (firstCardWidth + CAROUSEL_CARD_GAP_PX)),
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
            lines — merged into one concise, still-dynamic line. Split into
            a bold primary label (`sourceLabelBase`) and a dimmer, smaller
            secondary detail (`sourceLabelDetail`) — the sample-point
            breakdown is supporting detail, not a second headline claim, so
            it no longer competes at the same size/weight. */}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-xs text-zinc-500">
          <span>{sourceLabelBase}</span>
          {sourceLabelDetail && (
            <>
              <span className="text-zinc-300">•</span>
              <span className="text-[10px] font-normal tracking-tight text-zinc-400">{sourceLabelDetail}</span>
            </>
          )}
          {!altitude && lapseRateAdjustmentC !== 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-normal text-zinc-400">
              <span className="text-zinc-300">•</span>
              <Mountain className="size-3" />
              {lapseRateAdjustmentC}°C por altitud
            </span>
          )}
        </div>
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
            valueColorClass={getTempColorClass(temperatureC)}
          />
          <CarouselStatTile
            label="Viento"
            icon={<Wind className="size-3 shrink-0" />}
            value={`${windSpeedKmh} km/h`}
            alertLabel={windSpeedKmh >= WIND_ALERT_THRESHOLD_KMH ? "Viento fuerte" : undefined}
            valueColorClass={getWindColorClass(windSpeedKmh)}
          />
          <CarouselStatTile
            label="Humedad"
            value={`${humidityPct}%`}
            alertLabel={humidityPct >= HUMIDITY_ALERT_THRESHOLD_PCT ? "Humedad alta" : undefined}
            valueColorClass={getHumidityColorClass(humidityPct)}
          />
        </div>
      ) : (
        // "Aplanamiento de UI (eliminación de Card Inception)" — no more
        // outer `rounded-2xl border bg-zinc-50/70` box wrapping this whole
        // module: it used to sit as a card nested inside Card 03's own
        // white card, a redundant frame around a frame. Just plain layout
        // now, flowing directly in Card 03's own flex column — the header
        // (with the route's real min/max temp range and hito count baked
        // directly into it, no separate summary tile needed), the
        // altimetry SVG, and the carousel below, separated only by a thin
        // `border-t` hairline (a real divider, not a second nested box).
        // "Cronograma Térmico Fijo" — always rendered expanded, no collapse
        // toggle: this module is the whole point of the 2+-hito case
        // (there's nothing else to show once the averaged 3-tile summary
        // above is hidden in its favor), so hiding it behind an extra tap
        // just cost the athlete a click to see the one thing this card
        // exists to show.
        <div className="flex flex-col gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-xs font-bold tracking-tight text-zinc-900">
              Cronograma térmico por puertos
            </span>
            {/* Badge de Rango Térmico — the low end colors as whatever
                "frío" or "confort" reads on `getTempColorClass`'s own
                scale (never an alert tone by definition, since the
                minimum of a range can't itself be the hot extreme), while
                the high end colors by its own real threshold — a route
                whose max hits "Extremo" reads that in the badge itself,
                not just deep inside the carousel below. */}
            <span className="shrink-0 font-mono text-[11px] font-medium text-zinc-500">
              (<span className={getTempColorClass(minTemperatureC ?? 0)}>{minTemperatureC}°C</span>
              {" — "}
              <span className={getTempColorClass(maxTemperatureC ?? 0)}>{maxTemperatureC}°C</span> ·{" "}
              {weatherPoints.length} hitos)
            </span>
          </div>

          <div className="flex flex-col gap-3 border-t border-zinc-100 pt-3">
            {/* Nav Header — plain caption now, no loose arrows: the
                ←/→ controls moved into the active hito card's own header
                below, right next to the content they actually navigate,
                instead of floating disconnected from it up here. Sits
                above the split below rather than inside either column,
                since it labels the whole module, not just one side of it. */}
            <span className="block font-mono text-[11px] font-medium whitespace-normal text-zinc-500">
              Previsión por altimetría y hora de paso
            </span>

            {/* "Layout Desktop Responsive para Card 03" — the profile chart
                and the point-by-point carousel stack vertically on mobile
                (chart above carousel, unchanged from before), but split into
                a 2-column row from `lg:` up: the chart stays fixed on the
                left while the carousel + progress bar occupy the right,
                since desktop has the horizontal room to show both
                side-by-side instead of the athlete scrolling past the chart
                to reach the carousel below it. */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-stretch">
              {/* Columna Izquierda (50% Ancho) — Perfil Altimétrico 2D.
                  "Simplificación del Gráfico Térmico en Móvil" — the framed
                  `bg-neutral-50`/`border`/`p-4` card only applies from `lg:`
                  up now; on mobile the mini thermal-profile chart sits
                  directly on Card 03's own white background with no nested
                  frame/margin of its own, matching this same section's own
                  "Aplanamiento de UI (eliminación de Card Inception)" pass
                  above — that removed the *outer* wrapper around this whole
                  module; this removes the one remaining nested box, on
                  mobile specifically, that survived it. */}
              <div className="flex w-full h-full min-h-[180px] flex-1 flex-col justify-center items-center bg-transparent p-0 lg:bg-neutral-50 lg:rounded-xl lg:p-4 lg:border lg:border-neutral-200/70">
                <AltitudeProfileSvg
                  points={weatherPoints}
                  profile={elevationProfile}
                  activeIndex={activeScrollIndex}
                  onPointClick={handleScrollToSpecificIndex}
                />
              </div>

              <div className="flex flex-col gap-3">
                {/* Contenedor de tarjetas con swipe táctil nativo — real
                    touch/trackpad/mouse-wheel scrolling, `snap-x
                    snap-mandatory` + `snap-center` on each full-width card
                    for the magnetic anchor (one hito fills the visible strip
                    at a time — no partial next-card peeking that could look
                    misaligned/cut off on a narrow phone), `touch-pan-x` so a
                    vertical page-scroll gesture starting on this strip isn't
                    captured by it. `-mx-1 px-1` lets a `snap-center` card's
                    own focus ring render uncropped at the strip's edges
                    without widening the row past its parent. Rendered in
                    strict chronological/route order — the same order
                    `weatherPoints` itself is already built in (Salida →
                    Valle → Cima → ... → Llegada). Each card is now a flat
                    "Panel de Hito Activo" — no border/shadow box of its own,
                    just a soft porcelain tint on whichever hito is currently
                    active (synced with the SVG above), a small bronze dot in
                    place of the old colored border as the "this one's active"
                    cue, and a bottom-hairline-divided name/km-altitude row
                    above 3 flattened (`CarouselStatTile`, now borderless too)
                    stat tiles. */}
                <div
                  ref={scrollContainerRef}
                  onScroll={handleContainerScroll}
                  className="scrollbar-none -mx-1 flex touch-pan-x snap-x snap-mandatory gap-3 overflow-x-auto px-1 py-1"
                  style={{ WebkitOverflowScrolling: "touch" }}
                >
                  {weatherPoints.map((point, index) => {
                    const isActive = index === activeScrollIndex;
                    return (
                      <div
                        key={point.key}
                        className={cn(
                          "w-full shrink-0 snap-center rounded-xl p-3 transition-colors",
                          isActive ? "bg-zinc-50/80" : "bg-transparent"
                        )}
                      >
                        {/* "Ajuste Tipográfico del Nombre de Cimas/Hitos" —
                            stacked (name+nav row, then Km/altitud row below it)
                            rather than name/km side-by-side, so a long real col
                            name (or the minimalist "Km 41 · 2324m" fallback,
                            never an invented label like "Cima" — see
                            `getPeakName` in `lib/overpass.ts`) still gets room
                            to itself instead of splitting it with a `shrink-0`
                            sibling — `line-clamp-1` keeps it to one line
                            without an aggressive mid-word cut.
                            "Navegación Integrada" — the ←/→ controls (and the
                            X/Y counter between them) now live directly in this
                            header, right next to the hito they navigate,
                            instead of floating disconnected above the SVG —
                            visually linking the control to the content it
                            actually operates on and making the swipeable strip
                            read as an obvious carousel. Every card renders its
                            own copy of this row, but only one card is ever
                            visible at a time (each is `w-full snap-center`), so
                            exactly one set is ever on screen; all of them
                            share the same global `activeScrollIndex`/
                            `isAtStart`/`isAtEnd` state, so navigation always
                            acts on whichever hito is actually in view. */}
                        <div className="flex flex-col gap-0.5 border-b border-zinc-200/60 pb-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 flex-1 items-center gap-1.5">
                              <span
                                className={cn(
                                  "size-2 shrink-0 rounded-full",
                                  isActive ? "bg-[#70685b]" : "bg-zinc-300"
                                )}
                              />
                              {point.type === "peak" && (
                                <Mountain className="size-3 shrink-0 text-[#70685b]" />
                              )}
                              <span className="line-clamp-1 font-mono text-[11px] font-bold tracking-tight text-zinc-900 uppercase">
                                {point.locationName}
                              </span>
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleScrollToIndex("left")}
                                disabled={isAtStart}
                                className="cursor-pointer rounded-md bg-zinc-100 p-1 text-zinc-700 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
                                aria-label="Hito anterior"
                              >
                                <ArrowLeft className="size-3.5" />
                              </button>
                              <span className="px-0.5 font-mono text-[10px] text-zinc-400">
                                {activeScrollIndex + 1}/{weatherPoints.length}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleScrollToIndex("right")}
                                disabled={isAtEnd}
                                className="cursor-pointer rounded-md bg-zinc-100 p-1 text-zinc-700 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
                                aria-label="Siguiente hito"
                              >
                                <ArrowRight className="size-3.5" />
                              </button>
                            </div>
                          </div>
                          {/* Km/altitud — the real distance-along-route
                              whenever a granular server hito supplied one
                              (a 2-point altitude fallback never had a real km
                              figure to show). */}
                          <span className="font-mono text-[10px] text-zinc-400">
                            {point.distanceKm != null ? `Km ${point.distanceKm} · ` : ""}
                            {point.elevationM != null ? `${point.elevationM}m altitud` : "Altitud no disponible"}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 pt-2">
                          <CarouselStatTile
                            label="Temp."
                            icon={<Thermometer className="size-3 shrink-0" />}
                            value={`${point.temperatureC}°C`}
                            caption={point.temperatureCaption}
                            alertLabel={point.temperatureC >= HEAT_ALERT_THRESHOLD_C ? "Calor extremo" : undefined}
                            valueColorClass={getTempColorClass(point.temperatureC)}
                          />
                          <CarouselStatTile
                            label="Viento"
                            icon={<Wind className="size-3 shrink-0" />}
                            value={`${point.windSpeedKmh} km/h`}
                            alertLabel={point.windSpeedKmh >= WIND_ALERT_THRESHOLD_KMH ? "Viento fuerte" : undefined}
                            valueColorClass={getWindColorClass(point.windSpeedKmh)}
                          />
                          <CarouselStatTile
                            label="Humedad"
                            value={`${point.humidityPct}%`}
                            alertLabel={point.humidityPct >= HUMIDITY_ALERT_THRESHOLD_PCT ? "Humedad alta" : undefined}
                            valueColorClass={getHumidityColorClass(point.humidityPct)}
                          />
                        </div>
                      </div>
                    );
                  })}
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

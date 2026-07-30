"use client";

import "leaflet/dist/leaflet.css";

import { useEffect } from "react";
import { MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";

import { cn } from "@/lib/utils";

// OpenTopoMap — a real, free, no-API-key topographic tile set (elevation-
// shaded terrain, forest/water color-coded, genuine road network) rather
// than CartoDB's monochrome `dark_all`/`light_all` basemaps this app used
// before. This one specific request asked for a colorful "Strava Dark Mode
// Topo" look (navy sea, forest-green terrain, slate urban grid, orange
// route) — a monochrome graphite basemap has no color information left to
// recover via a filter, so getting real hue differentiation back requires
// starting from a tile source that actually has it.
const TILE_URL = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
// OpenTopoMap's own required attribution wording (its usage policy asks for
// this exact form, not just a generic OSM credit) — SRTM is the elevation
// dataset the terrain shading itself is computed from.
const TILE_ATTRIBUTION =
  'map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)';

// Leaflet's `TileLayer` forwards a `className` straight onto every tile
// `<img>` it renders (a real `L.TileLayer` option, not react-leaflet's own
// invention) — this is what lets a CSS filter reach the actual tile images
// without also touching the `Polyline`/zoom controls/badge, which live in
// separate panes/DOM nodes. OpenTopoMap is natively a *light* map (its
// labels are dark text, designed for a light background) — a plain
// `brightness`-only darken would crush those same dark labels into the now-
// dark background instead of lifting them. `invert(100%) hue-rotate(180deg)`
// is the classic "dark-mode a light image" pair instead: inverting flips
// every element's lightness (dark labels become light, light terrain
// becomes dark) while the compensating 180° hue rotation approximately
// restores each color's original hue (blue sea stays blue-ish rather than
// flipping to its complementary orange) — together, real terrain colors
// survive, just inverted to a dark register. `contrast`/`saturate` then
// tune richness on top. Approximate by nature — a CSS filter can't be tuned
// to land on an exact target hex, and the source tile's own pixel values
// vary by location/zoom — verified visually against real coastal/mountain
// terrain (Sa Calobra) and a dense city (Palma de Mallorca) rather than
// computed.
const TILE_DARK_FILTER_CLASS =
  "[filter:invert(100%)_hue-rotate(180deg)_brightness(95%)_contrast(90%)_saturate(130%)]";

// Strava's own icon orange — the one deliberate exception to this app's
// "route line uses a gold/bronze accent, not literal brand colors" pattern
// from earlier passes, since this specific request asked for the Strava
// look by name. Every other bronze accent in the app (buttons, borders)
// stays `--terracotta`; only this map polyline uses Strava orange, and only
// because it needs to read as unmistakably "Strava" against the new
// colorful terrain.
const ROUTE_LINE_COLOR = "#FC5200";

/** `MapContainer` itself has no "fit to route" concept — this runs once
 * per `points` change and asks the underlying Leaflet map instance
 * directly, which is the documented way to imperatively control the map
 * from inside a `react-leaflet` tree. */
function FitBoundsToRoute({ points }: { points: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(points, { padding: [16, 16] });
  }, [map, points]);

  return null;
}

/**
 * A Tailwind-styled stand-in for Leaflet's own `zoomControl` — rendered with
 * `zoomControl={false}` on `MapContainer` below and these buttons in its
 * place, since Leaflet's default `+`/`−` control only takes inline sizing
 * from its own bundled CSS (no Tailwind class of ours can reach it) and read
 * as disproportionately large/heavy next to this app's otherwise compact,
 * sober chrome. Restyled as translucent "glass" chips
 * (`bg-[#181818]/80 backdrop-blur-md border-white/15`) to sit on top of the
 * now-dark, colorful topo basemap (see `TILE_DARK_FILTER_CLASS` above) rather
 * than the flat opaque `bg-white` squares this used to be — a light square
 * would read as a jarring cutout against dark topography.
 */
function MapZoomControls() {
  const map = useMap();

  return (
    <div className="absolute top-2 left-2 z-1000 flex flex-col gap-1">
      <button
        type="button"
        onClick={() => map.zoomIn()}
        aria-label="Acercar mapa"
        className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-white/15 bg-[#181818]/80 text-xs leading-none font-bold text-white backdrop-blur-md transition-colors hover:bg-white/10"
      >
        +
      </button>
      <button
        type="button"
        onClick={() => map.zoomOut()}
        aria-label="Alejar mapa"
        className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-white/15 bg-[#181818]/80 text-xs leading-none font-bold text-white backdrop-blur-md transition-colors hover:bg-white/10"
      >
        −
      </button>
    </div>
  );
}

/**
 * "Mapa de Vista Previa de Ruta" — a compact, non-interactive-feeling
 * (still pannable/zoomable, but purely informational) preview of the
 * selected Strava route or uploaded GPX track, so the athlete can see the
 * actual shape of the ride they're planning fuel for instead of just a
 * distance/elevation figure. `points` is already-decoded `[lat, lng]`
 * pairs regardless of source — the caller decodes a Strava route's
 * `summary_polyline` via `decodePolyline()` (`lib/polyline.ts`) or passes
 * a parsed GPX's own `points` directly (`lib/gpx-import.ts`), so this
 * component itself stays format-agnostic.
 *
 * Dynamically imported with `ssr: false` at every call site (Leaflet reads
 * `window`/`document` at module scope, which breaks Next's server render
 * pass) — never import this directly.
 */
export function RouteMapPreview({
  points,
  distanceKm,
  elevationGainM,
  className,
  emptyMessage = "Selecciona una ruta de Strava o sube un GPX para visualizar el trazado.",
}: {
  points: [number, number][] | null;
  distanceKm: number | null;
  elevationGainM: number | null;
  /** Overrides the default `mt-3 h-48 w-full` sizing — merged via `cn()`
   * (Tailwind-merge-aware), so a caller embedding this in its own grid cell
   * (e.g. Post-Ride Analysis's 2-column telemetry layout) can drop the
   * top margin and pick its own height instead of the planner's default. */
  className?: string;
  emptyMessage?: string;
}) {
  if (!points || points.length < 2) {
    return (
      <div
        className={cn(
          "mt-3 flex h-48 w-full items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-6 text-center",
          className
        )}
      >
        <p className="text-sm text-neutral-500">{emptyMessage}</p>
      </div>
    );
  }

  const badgeParts = [
    distanceKm != null ? `${distanceKm}km` : null,
    elevationGainM != null ? `D+ ${elevationGainM}m` : null,
  ].filter((part): part is string => part != null);

  return (
    <div
      className={cn(
        "relative z-0 isolate mt-3 h-48 w-full overflow-hidden rounded-lg border border-neutral-200",
        className
      )}
    >
      <MapContainer
        className="h-full w-full"
        center={points[0]}
        zoom={12}
        scrollWheelZoom={false}
        attributionControl={false}
        zoomControl={false}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} className={TILE_DARK_FILTER_CLASS} />
        <Polyline positions={points} pathOptions={{ color: ROUTE_LINE_COLOR, weight: 4, opacity: 1 }} />
        <FitBoundsToRoute points={points} />
        <MapZoomControls />
      </MapContainer>
      {badgeParts.length > 0 && (
        <div className="absolute bottom-2 left-2 z-[1000] rounded-md border border-white/15 bg-[#181818]/80 px-3 py-1.5 font-mono text-[11px] text-zinc-200 backdrop-blur-md">
          {badgeParts.join(" · ")}
        </div>
      )}
    </div>
  );
}

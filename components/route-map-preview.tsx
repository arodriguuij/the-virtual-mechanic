"use client";

import "leaflet/dist/leaflet.css";

import { useEffect } from "react";
import { MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";

import { cn } from "@/lib/utils";

// CartoDB Positron — a clean, low-saturation basemap (no busy POI icons/
// labels competing with the route line) that fits this app's sober
// editorial look better than a default OSM tile set.
const TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const ROUTE_LINE_COLOR = "#C85231";

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
 * sober chrome. `size-7` on mobile keeps roughly Leaflet's own default
 * footprint; `md:size-6` with a smaller glyph shrinks it further at the same
 * `md:` breakpoint where callers switch to a desktop layout, since a cursor
 * doesn't need as generous a touch target as a finger does.
 */
function MapZoomControls() {
  const map = useMap();

  return (
    <div className="absolute top-2 left-2 z-1000 flex flex-col overflow-hidden rounded-md border border-neutral-300 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => map.zoomIn()}
        aria-label="Acercar mapa"
        className="flex size-7 cursor-pointer items-center justify-center border-b border-neutral-300 text-sm leading-none font-bold text-neutral-700 transition-colors hover:bg-neutral-50 md:size-6 md:text-xs"
      >
        +
      </button>
      <button
        type="button"
        onClick={() => map.zoomOut()}
        aria-label="Alejar mapa"
        className="flex size-7 cursor-pointer items-center justify-center text-sm leading-none font-bold text-neutral-700 transition-colors hover:bg-neutral-50 md:size-6 md:text-xs"
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
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <Polyline positions={points} pathOptions={{ color: ROUTE_LINE_COLOR, weight: 3, opacity: 0.9 }} />
        <FitBoundsToRoute points={points} />
        <MapZoomControls />
      </MapContainer>
      {badgeParts.length > 0 && (
        <div className="absolute bottom-2 left-2 z-[1000] rounded-md border border-neutral-200 bg-white/90 px-3 py-1.5 font-mono text-xs text-neutral-800 shadow-sm backdrop-blur-sm">
          {badgeParts.join(" · ")}
        </div>
      )}
    </div>
  );
}

"use client";

import "leaflet/dist/leaflet.css";

import { useEffect } from "react";
import { MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";

import { cn } from "@/lib/utils";

// CartoDB Positron — a soft, low-contrast, minimalist basemap (pale porcelain
// land, muted blue water, faint gray roads/labels) rendered natively light,
// not derived from a dark tile via a CSS filter. Replaces the earlier
// "Strava Dark Mode Topo" experiment (OpenTopoMap +
// `invert(100%) hue-rotate(180deg)`) outright — that approach worked, but a
// filter-derived dark map is inherently a step removed from what it's
// approximating; a genuinely light, Apple Maps/Mapbox-Light-style tile needs
// no filter at all, which is simpler and reads cleaner against this app's own
// porcelain canvas.
const TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
// CartoDB's own required attribution wording for this tile set.
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Strava's own icon orange — reads as an unmistakable, high-contrast accent
// against Positron's pale, low-saturation basemap, same as it did against the
// darker topo tile before this pass.
const ROUTE_LINE_COLOR = "#FC5200";
// A wider, softer, near-black line rendered directly underneath the route
// itself — Leaflet's `Polyline` has no `box-shadow`-style prop of its own, so
// stacking a second, more transparent stroke beneath the real one is the
// standard way to fake one, giving the route a subtle sense of depth over the
// pale terrain rather than sitting perfectly flat on it.
const ROUTE_SHADOW_COLOR = "#1a1a1a";

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
 * sober chrome. Restyled as translucent light "glass" chips
 * (`bg-white/80 backdrop-blur-md`) to sit on the pale Positron basemap — the
 * same clear/frosted look Apple Maps' own floating controls use. No border —
 * this app's 100%-frameless pass removed the hairline outline these chips
 * used to carry, relying on the translucent fill + blur alone for
 * definition against the map tiles beneath. `top-3 left-3` (bumped from
 * `top-2 left-2`) gives a slightly more generous margin from the map's own
 * now-frameless edge.
 */
function MapZoomControls() {
  const map = useMap();

  return (
    <div className="absolute top-3 left-3 z-1000 flex flex-col gap-1">
      <button
        type="button"
        onClick={() => map.zoomIn()}
        aria-label="Acercar mapa"
        className="flex size-7 cursor-pointer items-center justify-center rounded-md bg-white/80 text-xs leading-none font-bold text-zinc-900 shadow-sm backdrop-blur-md transition-colors hover:bg-white"
      >
        +
      </button>
      <button
        type="button"
        onClick={() => map.zoomOut()}
        aria-label="Alejar mapa"
        className="flex size-7 cursor-pointer items-center justify-center rounded-md bg-white/80 text-xs leading-none font-bold text-zinc-900 shadow-sm backdrop-blur-md transition-colors hover:bg-white"
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
        // No border — this app's 100%-frameless pass differentiates every
        // container purely by background/shadow, never a hairline outline.
        // `overflow-hidden` still does real work here beyond clipping the
        // Leaflet tiles to `rounded-lg`: a caller embedding this flush inside
        // its own already-rounded card (see the Fueling Planner's Ruta
        // widget) overrides this component's own `rounded-lg`/`mt-3` via the
        // `className` merge below, letting the *parent* card's corners do
        // the clipping instead.
        "relative z-0 isolate mt-3 h-48 w-full overflow-hidden rounded-lg bg-white shadow-sm",
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
        {/* Shadow stroke first (wider, translucent dark), the real Strava-
            orange route drawn on top — gives the line a subtle sense of
            depth over the pale terrain without needing a CSS filter. */}
        <Polyline
          positions={points}
          pathOptions={{
            color: ROUTE_SHADOW_COLOR,
            weight: 6,
            opacity: 0.15,
            lineCap: "round",
            lineJoin: "round",
          }}
        />
        <Polyline
          positions={points}
          pathOptions={{
            color: ROUTE_LINE_COLOR,
            weight: 3.5,
            opacity: 1,
            lineCap: "round",
            lineJoin: "round",
          }}
        />
        <FitBoundsToRoute points={points} />
        <MapZoomControls />
      </MapContainer>
      {badgeParts.length > 0 && (
        <div className="absolute bottom-3 left-3 z-1000 rounded-lg bg-white/80 px-3 py-1.5 font-mono text-xs text-zinc-900 shadow-sm backdrop-blur-md">
          {badgeParts.join(" · ")}
        </div>
      )}
    </div>
  );
}

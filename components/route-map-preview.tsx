"use client";

import "leaflet/dist/leaflet.css";

import { Locate } from "lucide-react";
import { useEffect } from "react";
import { MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";

import { cn } from "@/lib/utils";

// CartoDB Voyager — a light, "Apple Maps / Strava Light"-style basemap with
// natural but soft colors (blue water, muted green terrain, a clear
// high-contrast road network) and fast-loading raster tiles. Replaces the
// earlier OpenTopoMap tile — OpenTopoMap's own dense contour-line styling
// read as busier/heavier than the clean, minimal look this app's PNS pass
// actually wants; Voyager keeps real terrain color information (unlike the
// even-flatter CartoDB Positron this app used before that) without
// OpenTopoMap's topographic clutter. Rendered with no CSS filter — this is
// meant to be used as-is, in its own natural daylight palette.
//
// `{s}` is Leaflet's own subdomain-substitution token — it must be paired
// with a *separate* `subdomains` prop listing the letters to round-robin
// through; a hyphenated inline range like `{a-c}` spelled directly into the
// URL isn't a token Leaflet's template parser recognizes at all, and threw
// "No value provided for variable {a-c}" before a single tile could load,
// crashing the whole Dashboard on mount (a real regression hit and fixed
// with the previous tile provider) — kept as an explicit `subdomains` prop
// here too, rather than relying on Leaflet's own default, to guard against
// the same mistake recurring.
const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_SUBDOMAINS = "abcd";
// CartoDB's own required attribution wording for this tile set.
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Obsidian black (`#18181B`) — reverted back from a brief verde-oliva
// (`#555a43`) experiment: against a live route on Voyager's soft-colored
// terrain, the olive tone didn't hold enough contrast/precision at a
// glance (a rider needs to read the exact line at a glance, not blend it
// into the landscape) — obsidian black is the maximum-contrast choice,
// kept fine (`weight: 2.5`) rather than bold so it still reads as a
// precise technical trace, not a heavy UI accent. Kept as a literal hex
// rather than a Tailwind class, since Leaflet's `Polyline` `color` prop
// needs a plain string.
const ROUTE_LINE_COLOR = "#18181B";
// A wider, softer, near-black line rendered directly underneath the route
// itself — Leaflet's `Polyline` has no `box-shadow`-style prop of its own, so
// stacking a second, more transparent stroke beneath the real one is the
// standard way to fake one, giving the route a subtle sense of depth over
// the terrain rather than sitting perfectly flat on it.
const ROUTE_SHADOW_COLOR = "#000000";

// "Estado Vacío del Mapa" — a generic regional backdrop for the dimmed
// base-map empty state below, rather than a blank/undefined center. Palma
// de Mallorca — the same locale this app's own worked examples throughout
// its history use (Sa Calobra, Palma) — reads as a sensible, real "this is
// what your map will look like" placeholder rather than an arbitrary
// coordinate or a stretched-out world view.
const EMPTY_STATE_CENTER: [number, number] = [39.5696, 2.6502];
const EMPTY_STATE_ZOOM = 10;

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
function MapZoomControls({ points }: { points: [number, number][] }) {
  const map = useMap();

  return (
    <div className="absolute top-3 left-3 z-1000 flex flex-col gap-1">
      <button
        type="button"
        onClick={() => map.zoomIn()}
        aria-label="Acercar mapa"
        className="flex size-7 cursor-pointer items-center justify-center rounded-sm bg-white/80 text-xs leading-none font-bold text-zinc-900 shadow-sm backdrop-blur-md transition-colors hover:bg-white"
      >
        +
      </button>
      <button
        type="button"
        onClick={() => map.zoomOut()}
        aria-label="Alejar mapa"
        className="flex size-7 cursor-pointer items-center justify-center rounded-sm bg-white/80 text-xs leading-none font-bold text-zinc-900 shadow-sm backdrop-blur-md transition-colors hover:bg-white"
      >
        −
      </button>
      {/* Re-center: a phone's own pan/scroll gesture easily drags the route
          out of frame (especially while the page itself is being scrolled
          past the map) — this snaps straight back to `fitBounds`, the exact
          same call `FitBoundsToRoute` already makes on mount, just re-run on
          demand rather than only once per `points` change. */}
      <button
        type="button"
        onClick={() => map.fitBounds(points, { padding: [16, 16] })}
        aria-label="Re-centrar mapa en la ruta"
        className="flex size-7 cursor-pointer items-center justify-center rounded-sm bg-white/80 text-zinc-900 shadow-sm backdrop-blur-md transition-colors hover:bg-white"
      >
        <Locate className="size-3.5" />
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
  emptyMessage = "Selecciona una ruta para comenzar",
}: {
  points: [number, number][] | null;
  distanceKm: number | null;
  elevationGainM: number | null;
  /** Overrides the default `mt-3 h-48 w-full` sizing — merged via `cn()`
   * (Tailwind-merge-aware), so a caller embedding this in its own grid cell
   * (e.g. Post-Ride Analysis's 2-column telemetry layout) can drop the
   * top margin and pick its own height instead of the planner's default. */
  className?: string;
  /** The empty-state pill's only text — overridden by Post-Ride Analysis
   * (a completed ride with no synced GPS data reads differently from
   * "you haven't picked a route yet"). */
  emptyMessage?: string;
}) {
  if (!points || points.length < 2) {
    // "Rediseño Reductivo del Estado Vacío" — a real (decorative,
    // non-interactive) base map dimmed via CSS filter, not a blank
    // porcelain box. This used to also carry a floating white card (an
    // icon badge, a title, and a "Subir archivo .GPX" button) — removed
    // outright per an explicit request for a purely minimal treatment: the
    // dimmed map should stay the dominant visual, with nothing but a single
    // small translucent pill of plain text floating over it. The upload
    // entry point this button used to duplicate still exists as its own
    // "+ Subir GPX" action above the map in Card 01 — nothing was lost by
    // removing the redundant one here.
    return (
      <div
        className={cn(
          "relative z-0 isolate mt-3 h-48 w-full overflow-hidden rounded-xl bg-white shadow-sm",
          className
        )}
      >
        <div className="pointer-events-none absolute inset-0 grayscale contrast-75 opacity-40">
          <MapContainer
            className="h-full w-full"
            center={EMPTY_STATE_CENTER}
            zoom={EMPTY_STATE_ZOOM}
            zoomControl={false}
            attributionControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            touchZoom={false}
            boxZoom={false}
            keyboard={false}
          >
            <TileLayer url={TILE_URL} subdomains={TILE_SUBDOMAINS} attribution={TILE_ATTRIBUTION} />
          </MapContainer>
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
          <span className="rounded-full border border-zinc-200/60 bg-white/80 px-4 py-2 font-mono text-xs tracking-tight text-zinc-700 shadow-xs backdrop-blur-md">
            {emptyMessage}
          </span>
        </div>
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
        // `overflow-hidden` clips the Leaflet tiles to `rounded-xl` on
        // every corner, including this component's own top corners — every
        // call site now keeps its default `rounded-xl` rather than
        // flattening it to `rounded-none` to bleed into a parent card's own
        // rounding (the earlier "full-bleed photo in a card" convention),
        // so the map always reads as its own fully rounded, self-contained
        // box regardless of what it's embedded inside.
        "relative z-0 isolate mt-3 h-48 w-full overflow-hidden rounded-xl bg-white shadow-sm",
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
        <TileLayer url={TILE_URL} subdomains={TILE_SUBDOMAINS} attribution={TILE_ATTRIBUTION} />
        {/* Shadow stroke first (wider, translucent dark), the real obsidian
            route drawn on top — gives the line a subtle sense of depth over
            the busier topo terrain without needing a CSS filter. */}
        <Polyline
          positions={points}
          pathOptions={{
            color: ROUTE_SHADOW_COLOR,
            weight: 4,
            opacity: 0.15,
            lineCap: "round",
            lineJoin: "round",
          }}
        />
        {/* Fine, technical stroke — `weight: 2.5`/`opacity: 0.95` reads as a
            deliberately thin, elegant trace rather than a bold UI element,
            per "Estilizado Minimalista de la Ruta en Mapa." */}
        <Polyline
          positions={points}
          pathOptions={{
            color: ROUTE_LINE_COLOR,
            weight: 2.5,
            opacity: 0.95,
            lineCap: "round",
            lineJoin: "round",
          }}
        />
        <FitBoundsToRoute points={points} />
        <MapZoomControls points={points} />
      </MapContainer>
      {badgeParts.length > 0 && (
        <div className="absolute bottom-3 left-3 z-1000 rounded-lg bg-white/80 px-3 py-1.5 font-mono text-xs text-zinc-900 shadow-sm backdrop-blur-md">
          {badgeParts.join(" · ")}
        </div>
      )}
    </div>
  );
}

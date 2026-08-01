"use client";

import "leaflet/dist/leaflet.css";

import { Compass, Locate, Upload } from "lucide-react";
import { useEffect } from "react";
import { MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";

import { cn } from "@/lib/utils";

// OpenTopoMap — a genuinely multi-hue outdoors/topographic basemap (natural
// blue sea, green forest/vegetation, tan/brown elevation contour bands, high-
// contrast road network), the "Strava-style" look this app's own PNS pass
// asked for. Replaces the earlier CartoDB Positron tile (a soft, near-
// monochrome porcelain-and-pale-blue basemap) — Positron reads as a clean,
// minimal Apple-Maps-style backdrop but has none of the terrain color
// information a rider actually wants when checking whether a route climbs
// through mountains or hugs the coast. Rendered with **no CSS filter** —
// unlike this app's earlier "Dark Vector HUD" experiment (which inverted
// this same tile to fake a dark map), this pass wants OpenTopoMap's own
// natural daylight palette as-is.
// `{a-c}` (a hyphenated inline range) isn't a placeholder Leaflet's own
// `TileLayer` URL-template parser understands — it only substitutes tokens
// it explicitly knows about (`{z}`/`{x}/`{y}`/`{s}`/`{r}`), and `{s}`
// specifically expects a *separate* `subdomains` prop listing the letters
// to round-robin through, not the range spelled out inline in the URL
// itself. Left as `{a-c}`, every tile request literally requested the
// path `/{a-c}.tile.../...`, which Leaflet's template engine rejected
// outright with "No value provided for variable {a-c}" before a single
// tile could load — crashing the whole Dashboard on mount, not just
// degrading the basemap.
const TILE_URL = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
const TILE_SUBDOMAINS = "abc";
// OpenTopoMap's own required attribution wording (CC-BY-SA), layered on top
// of the underlying OSM/SRTM data attribution its own tiles are built from.
const TILE_ATTRIBUTION =
  'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)';

// Obsidian black (`#18181B`) — this app's now-unified accent for every
// active/primary surface (Cards 01/02/04's active selectors, the CTA) —
// replaces the earlier muted bronze/taupe (`--terracotta`) route line: a
// thin, high-contrast line reads more cleanly against OpenTopoMap's own
// colorful, higher-detail terrain than the previous pale-basemap-tuned
// bronze did. Kept as a literal hex rather than a Tailwind class, since
// Leaflet's `Polyline` `color` prop needs a plain string.
const ROUTE_LINE_COLOR = "#18181B";
// A wider, softer, near-black line rendered directly underneath the route
// itself — Leaflet's `Polyline` has no `box-shadow`-style prop of its own, so
// stacking a second, more transparent stroke beneath the real one is the
// standard way to fake one, giving the route a subtle sense of depth over
// the busier topo terrain rather than sitting perfectly flat on it.
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
  title = "Sin ruta seleccionada",
  emptyMessage = "Selecciona una ruta o sube un archivo GPX para visualizar el trazado.",
  onUploadClick,
}: {
  points: [number, number][] | null;
  distanceKm: number | null;
  elevationGainM: number | null;
  /** Overrides the default `mt-3 h-48 w-full` sizing — merged via `cn()`
   * (Tailwind-merge-aware), so a caller embedding this in its own grid cell
   * (e.g. Post-Ride Analysis's 2-column telemetry layout) can drop the
   * top margin and pick its own height instead of the planner's default. */
  className?: string;
  /** Empty-state modal card's own title line — overridden by Post-Ride
   * Analysis (a completed ride with no synced GPS data reads differently
   * from "you haven't picked a route yet"). */
  title?: string;
  emptyMessage?: string;
  /** Renders a "Subir archivo .GPX" action inside the empty-state card —
   * only where the caller actually has an upload flow to open (the Fueling
   * Planner's Ruta widget). Omitted entirely at every other call site
   * (Post-Ride Analysis, the planner's own GPX-mode map, which can only
   * ever render once a file is already parsed) rather than showing a
   * button with nothing to do. */
  onUploadClick?: () => void;
}) {
  if (!points || points.length < 2) {
    // "Estado Vacío del Mapa" — a real (decorative, non-interactive) base
    // map dimmed via CSS filter, not a blank porcelain box or a dashed
    // placeholder rectangle: the athlete sees the same map surface they'll
    // get once a route is loaded, just muted, with a floating white card
    // explaining what to do next.
    return (
      <div
        className={cn(
          "relative z-0 isolate mt-3 h-48 w-full overflow-hidden rounded-sm bg-white shadow-sm",
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
        <div className="absolute inset-0 flex items-center justify-center px-4">
          <div className="mx-auto max-w-xs rounded-2xl border border-zinc-200/80 bg-white/95 p-5 text-center shadow-md backdrop-blur-md">
            <div className="mx-auto mb-3 flex size-9 items-center justify-center rounded-full border border-zinc-200 bg-white shadow-sm">
              <Compass className="size-4 text-zinc-600" strokeWidth={1} />
            </div>
            <p className="mb-1 font-mono text-xs font-bold tracking-wider text-zinc-800 uppercase">{title}</p>
            <p className="mb-3 text-xs text-zinc-500">{emptyMessage}</p>
            {onUploadClick && (
              <button
                type="button"
                onClick={onUploadClick}
                className="shadow-xs inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#18181B] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-800"
              >
                <Upload className="size-3.5 shrink-0" />
                Subir archivo .GPX
              </button>
            )}
          </div>
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
        // `overflow-hidden` still does real work here beyond clipping the
        // Leaflet tiles to `rounded-sm`: a caller embedding this flush inside
        // its own already-rounded card (see the Fueling Planner's Ruta
        // widget) overrides this component's own `rounded-sm`/`mt-3` via the
        // `className` merge below, letting the *parent* card's corners do
        // the clipping instead.
        "relative z-0 isolate mt-3 h-48 w-full overflow-hidden rounded-sm bg-white shadow-sm",
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
        <Polyline
          positions={points}
          pathOptions={{
            color: ROUTE_LINE_COLOR,
            weight: 2,
            opacity: 1,
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

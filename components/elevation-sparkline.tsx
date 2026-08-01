/**
 * "Perfil Altimétrico (Sparkline SVG)" — a lightweight, dependency-free
 * silhouette of a route's elevation profile, meant to sit directly under
 * `RouteMapPreview`'s own map container so a rider can read a route's real
 * shape (flat vs. a genuine mountain profile) at a glance, without needing
 * a full charting library for what's really just one filled polyline.
 *
 * Takes `points` in the exact same `{distanceFraction, elevationM}[]` shape
 * `detectMountainPasses` (`lib/metabolic-engine.ts`) already consumes —
 * `parsedGpx.elevationProfile` (`lib/gpx-import.ts`) is its one real data
 * source today, since a GPX file already carries per-point altitude
 * locally with zero extra network cost. A Strava-selected route has no
 * equivalent profile available at this point in the flow: its full
 * altitude stream is only ever fetched on-demand, once, when the athlete
 * actually clicks "Calcular estrategia" (`fetchRouteElevationExtremes` in
 * `lib/strava-routes.ts`) — deliberately never eager, so selecting a route
 * in Card 01 doesn't add passive Strava API calls (see that function's own
 * doc comment). Rendering a sparkline for Strava mode would need a second,
 * eager per-route streams call purely to draw this silhouette before any
 * calculation exists, which would contradict that deliberate constraint —
 * so this component (and its one call site, GPX mode's map container) is
 * scoped to the data source that's genuinely free to render immediately.
 */
export function ElevationSparkline({
  points,
  heightPx = 40,
}: {
  points: { distanceFraction: number; elevationM: number }[] | null;
  heightPx?: number;
}) {
  if (!points || points.length < 2) return null;

  const elevations = points.map((p) => p.elevationM);
  const minEle = Math.min(...elevations);
  const maxEle = Math.max(...elevations);
  const range = maxEle - minEle || 1;

  // A flat 0-100 x/y viewBox with `preserveAspectRatio="none"` lets the
  // SVG stretch to whatever width its container gives it — the silhouette
  // is relative (min/max mapped to the full height), not an absolute
  // elevation scale, since the point is "what shape is this route," not a
  // literal altitude axis.
  const toX = (fraction: number) => Math.max(0, Math.min(100, fraction * 100));
  const toY = (elevationM: number) => 100 - ((elevationM - minEle) / range) * 100;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.distanceFraction).toFixed(2)},${toY(p.elevationM).toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L100,100 L0,100 Z`;

  const gradientId = "elevation-sparkline-fill";

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height: heightPx }}
      role="img"
      aria-label="Perfil de elevación de la ruta"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6E6658" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#6E6658" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke="#121212"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

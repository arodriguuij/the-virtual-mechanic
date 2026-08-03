/**
 * "Perfil Altimétrico (Sparkline SVG)" — a lightweight, dependency-free
 * silhouette of a route's elevation profile, meant to sit directly under
 * `RouteMapPreview`'s own map container so a rider can read a route's real
 * shape (flat vs. a genuine mountain profile) at a glance, without needing
 * a full charting library for what's really just one filled polyline.
 *
 * Takes `points` in the exact same `{distanceFraction, elevationM}[]` shape
 * `detectMountainPasses` (`lib/metabolic-engine.ts`) already consumes. Two
 * call sites, two different data sources: a parsed GPX file already
 * carries per-point altitude locally (`parsedGpx.elevationProfile`, zero
 * extra network cost), while a selected Strava route has no equivalent
 * profile available client-side by default — its full altitude stream
 * used to be fetched only once, server-side, when the athlete actually
 * clicked "Calcular estrategia" (`fetchRouteElevationExtremes` in
 * `lib/strava-routes.ts`). "Mini-Gráfico de Altimetría Universal" added a
 * second, deliberate exception to that "never eager" rule specifically for
 * this sparkline: `GET /api/strava/route-elevation` fetches the same
 * streams data once per *explicit* route selection (never for every route
 * in the list), so this component's `points` prop is `null` while that
 * fetch is in flight or before any route is picked — same graceful
 * "render nothing yet" behavior as a GPX file with too few points.
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

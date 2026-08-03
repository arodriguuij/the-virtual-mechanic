import "server-only";

// "Geocodificación de Nombres de Puerto" — a bare "Km 42 · 1800m" readout
// tells the athlete nothing about *which* real climb this is; a named
// summit ("Coll de Ordino") reads as a genuine route briefing instead of a
// coordinate dump. OpenStreetMap's own Overpass API is a free, no-key
// public database of exactly this kind of tag — queried server-side only
// (never from the browser, both for CORS and to keep this off the client
// bundle) and used purely as enrichment: any failure here degrades to the
// same illustrative fallback string, never blocks the calculation itself.
//
// "Redundancia de Servidores Overpass" — the public `overpass-api.de`
// instance rate-limits/times out under load; these community-run mirrors
// run the same interpreter against the same OSM data, so a rejected/failed
// request against one is retried against the next in order rather than
// immediately falling back to the (real, but nameless) numeric readout.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
// Widened from an earlier 500m — real mountain passes (cols) in a place
// like Andorra are frequently tagged a few hundred meters off the road's
// own sampled route point (the pass node sits at the saddle itself, not
// necessarily on the exact GPS trace), so a tight 500m radius was missing
// well-known, clearly-named cols (Coll de Ordino, Arcalís, Beixalís) that a
// 1500m radius reliably resolves instead.
const OVERPASS_SEARCH_RADIUS_M = 1500;
const OVERPASS_FETCH_TIMEOUT_MS = 8000;

// Broad enough to classify which tier an element matched, not just read its
// name — `getPeakName`'s own tiered search below needs to tell a real
// pass/peak apart from a toponym fallback even though all 5 tag filters are
// queried together in one request.
type OverpassElement = {
  tags?: {
    name?: string;
    mountain_pass?: string;
    natural?: string;
    tourism?: string;
    place?: string;
  };
};
type OverpassResponse = { elements: OverpassElement[] };

// A named element's own tags decide which precedence tier it belongs to —
// see `getPeakName`'s own doc comment for why a pass/saddle always outranks
// a peak, which always outranks a generic toponym.
function isPassOrSaddle(el: OverpassElement): boolean {
  return el.tags?.mountain_pass === "yes" || el.tags?.natural === "saddle";
}
function isPeak(el: OverpassElement): boolean {
  return el.tags?.natural === "peak";
}
function isToponym(el: OverpassElement): boolean {
  return el.tags?.tourism === "viewpoint" || el.tags?.place === "locality";
}

// OSM contributors frequently enter a name in all-caps (or all-lowercase) —
// title-cased reads as a genuine proper noun instead of shouting or looking
// unfinished. Only applied when the name doesn't already contain a lowercase
// letter, so a name that's already properly cased (mixed-case, accents,
// "d'Ordino"-style apostrophes) is left completely untouched.
function toTitleCaseIfShouting(name: string): string {
  if (/[a-zà-ÿ]/.test(name)) return name;
  return name
    .toLowerCase()
    .split(" ")
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/**
 * Resolves a mountain-pass/summit's real name from OpenStreetMap within
 * `OVERPASS_SEARCH_RADIUS_M` of the given point. Queries both `node` and
 * `way` geometries (a real col is sometimes mapped as a way — a short
 * ridgeline segment — rather than a single node) across the strict pass/
 * peak tags — `mountain_pass=yes` (Pyrenees/Andorra cols are frequently
 * tagged this way, with no `natural=mountain_pass`/`saddle` counterpart),
 * `natural=saddle` (the other common tagging convention for the same kind
 * of pass), and `natural=peak` for a true summit rather than a through-pass
 * — plus, in the same single request, 2 more permissive toponym tags
 * (`tourism=viewpoint`, `place=locality`) at a tighter radius, for a "hito
 * ciego" whose road doesn't actually cross a node tagged as a real pass or
 * peak (a ski-station finish, a mirador) but does sit near *something*
 * named on OSM. `out tags` (not `out body`) is deliberate: a `way`'s full
 * body includes every node reference along its geometry, which we never
 * use — only the tags matter here, so `out tags` keeps the response small
 * regardless of how many `way`s match.
 *
 * "Orden de Precedencia Estricto" — a single query returns every tier's
 * matches together, so the *code*, not query order, decides precedence:
 * a real pass/saddle always wins if one exists within range, then a plain
 * peak, and only once neither exists does a generic toponym (viewpoint/
 * locality) get used — a named mirador should never outrank a real,
 * specifically-tagged col just because it happened to come back first in
 * the response.
 *
 * "Fallback Minimalista Puro" — falls back to a bare `Km {distanceKm} ·
 * {elevationM}m` whenever OSM has nothing named at this exact spot at any
 * tier, or every mirror in `OVERPASS_ENDPOINTS` fails. Deliberately *not*
 * prefixed with an invented label like "Cima" — this is enrichment, not a
 * required data source, and a numeric-only readout is honest about not
 * having found a real name, rather than dressing up a coordinate with a
 * word that implies a confirmed identification. Never blocks the caller's
 * own calculation on failure.
 */
export async function getPeakName(
  lat: number,
  lon: number,
  distanceKm: number,
  elevationM: number
): Promise<string> {
  const fallback = `Km ${Math.round(distanceKm)} · ${Math.round(elevationM)}m`;
  const strictRadius = OVERPASS_SEARCH_RADIUS_M;
  const toponymRadius = Math.round(OVERPASS_SEARCH_RADIUS_M * 0.53); // ~800m at the current 1500m default
  const query = `[out:json][timeout:8];(node["mountain_pass"="yes"](around:${strictRadius},${lat},${lon});node["natural"="saddle"](around:${strictRadius},${lat},${lon});node["natural"="peak"](around:${strictRadius},${lat},${lon});way["mountain_pass"="yes"](around:${strictRadius},${lat},${lon});way["natural"="saddle"](around:${strictRadius},${lat},${lon});node["tourism"="viewpoint"](around:${toponymRadius},${lat},${lon});node["place"="locality"](around:${toponymRadius},${lat},${lon}););out tags 10;`;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), OVERPASS_FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          body: `data=${encodeURIComponent(query)}`,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      // A 429 (rate-limited) or 5xx from this one mirror is exactly the
      // case worth retrying the next endpoint for — only a genuine "OSM
      // has nothing here" (a clean 200 with no matching element) should
      // resolve to the numeric fallback instead of trying another mirror.
      if (!res.ok) {
        console.warn(`[Overpass] ${endpoint} respondió ${res.status} — probando el siguiente mirror.`);
        continue;
      }
      const data: OverpassResponse = await res.json();
      const named = data.elements.filter((el) => el.tags?.name?.trim());
      const match =
        named.find(isPassOrSaddle) ?? named.find(isPeak) ?? named.find(isToponym) ?? named[0];
      const name = match?.tags?.name?.trim();
      return name ? toTitleCaseIfShouting(name) : fallback;
    } catch (err) {
      console.warn(`[Overpass] ${endpoint} falló (${err instanceof Error ? err.message : err}) — probando el siguiente mirror.`);
    }
  }
  return fallback;
}

// `{lat, lng, name}` — deliberately generic despite the "Gpx" name: the
// exact same shape and matching function below are reused for Strava's own
// route segments (`fetchRouteSegments` in `lib/strava-routes.ts`, matched
// against each segment's `start_latlng`), not just a GPX file's `<wpt>`
// waypoints.
export type GpxWaypoint = { lat: number; lng: number; name: string };

// A rider's own `<wpt>` (or a Strava segment's own `start_latlng`) sits at
// or near the real summit, not exactly on it — same "a few hundred meters
// off the sampled point" slack as the Overpass search radius above, though
// tighter, since both are a much stronger, more deliberate signal than a
// generic OSM tag and shouldn't match a peak they weren't actually meant to
// label.
const WAYPOINT_MATCH_RADIUS_M = 300;
const EARTH_RADIUS_M = 6_371_000;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * "Waypoints Explícitos / Segmentos Nativos de Strava" — regla de oro:
 * nunca inferir/adivinar un nombre de cima a partir del título del archivo
 * GPX. The two legitimate exceptions, both stronger signals than a generic
 * OSM tag lookup at the same point, so both are checked first, before ever
 * calling Overpass: a *real, explicit* `<wpt>` the rider (or the route's
 * original author) placed in a GPX file, or a named Strava segment a saved
 * route already passes through. Returns the nearest point's own name
 * within `WAYPOINT_MATCH_RADIUS_M`, or `null` when none is close enough —
 * callers should fall through to `getPeakName()` (Overpass, then the
 * minimalist numeric fallback) in that case, never fabricate a name of
 * their own either.
 */
export function findNearestWaypointName(lat: number, lng: number, waypoints: GpxWaypoint[]): string | null {
  let closest: { name: string; distanceM: number } | null = null;
  for (const wpt of waypoints) {
    const distanceM = haversineMeters(lat, lng, wpt.lat, wpt.lng);
    if (distanceM <= WAYPOINT_MATCH_RADIUS_M && (!closest || distanceM < closest.distanceM)) {
      closest = { name: wpt.name, distanceM };
    }
  }
  return closest?.name ?? null;
}

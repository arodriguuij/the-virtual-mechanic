import "server-only";

// "Geocodificación de Nombres de Puerto" — a bare "Km 42 · 1800m" readout
// tells the athlete nothing about *which* real climb this is; a named
// summit ("Coll de Ordino") reads as a genuine route briefing instead of a
// coordinate dump. OpenStreetMap's own Overpass API is a free, no-key
// public database of exactly this kind of tag — queried server-side only
// (never from the browser, both for CORS and to keep this off the client
// bundle) and used purely as enrichment: any failure here degrades to the
// same illustrative fallback string, never blocks the calculation itself.
const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";
// Widened from an earlier 500m — real mountain passes (cols) in a place
// like Andorra are frequently tagged a few hundred meters off the road's
// own sampled route point (the pass node sits at the saddle itself, not
// necessarily on the exact GPS trace), so a tight 500m radius was missing
// well-known, clearly-named cols (Coll de Ordino, Arcalís, Beixalís) that a
// 1500m radius reliably resolves instead.
const OVERPASS_SEARCH_RADIUS_M = 1500;
const OVERPASS_FETCH_TIMEOUT_MS = 6000;

type OverpassElement = { tags?: { name?: string } };
type OverpassResponse = { elements: OverpassElement[] };

/**
 * Resolves a mountain-pass/summit's real name from OpenStreetMap within
 * `OVERPASS_SEARCH_RADIUS_M` of the given point. Queries 4 separate node
 * filters as a union — `natural=mountain_pass`, `mountain_pass=yes` (some
 * cols are only tagged this second way, with no `natural=mountain_pass`
 * counterpart), `natural=saddle`, and `natural=peak` — rather than one
 * regex-matched `natural` tag, since `mountain_pass=yes` lives on its own
 * key entirely and was previously invisible to a query that only ever
 * inspected `natural`.
 *
 * "Fallback Minimalista Puro" — falls back to a bare `Km {distanceKm} ·
 * {elevationM}m` whenever OSM has nothing named at this exact spot (a
 * minor/unnamed summit) or the request itself fails/times out. Deliberately
 * *not* prefixed with an invented label like "Cima" — this is enrichment,
 * not a required data source, and a numeric-only readout is honest about
 * not having found a real name, rather than dressing up a coordinate with
 * a word that implies a confirmed identification. Never blocks the
 * caller's own calculation on failure.
 */
export async function getPeakName(
  lat: number,
  lon: number,
  distanceKm: number,
  elevationM: number
): Promise<string> {
  const fallback = `Km ${Math.round(distanceKm)} · ${Math.round(elevationM)}m`;
  try {
    const query = `[out:json][timeout:5];(node(around:${OVERPASS_SEARCH_RADIUS_M},${lat},${lon})["natural"="mountain_pass"];node(around:${OVERPASS_SEARCH_RADIUS_M},${lat},${lon})["mountain_pass"="yes"];node(around:${OVERPASS_SEARCH_RADIUS_M},${lat},${lon})["natural"="saddle"];node(around:${OVERPASS_SEARCH_RADIUS_M},${lat},${lon})["natural"="peak"];);out tags 1;`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OVERPASS_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(OVERPASS_API_URL, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return fallback;
    const data: OverpassResponse = await res.json();
    const name = data.elements.find((el) => el.tags?.name)?.tags?.name?.trim();
    return name || fallback;
  } catch {
    return fallback;
  }
}

export type GpxWaypoint = { lat: number; lng: number; name: string };

// A rider's own `<wpt>` sits at or near the real summit, not exactly on
// it — same "a few hundred meters off the sampled point" slack as the
// Overpass search radius above, though tighter, since a hand-placed
// waypoint is a much stronger, more deliberate signal than a generic OSM
// tag and shouldn't match a peak it wasn't actually meant to label.
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
 * "Waypoints Explícitos del GPX" — regla de oro: nunca inferir/adivinar un
 * nombre de cima a partir del título del archivo GPX. The one legitimate
 * exception is a *real, explicit* `<wpt>` the rider (or the route's
 * original author) placed in the file itself — a stronger, more specific
 * signal than a generic OSM tag lookup at the same point, so it's checked
 * first, before ever calling Overpass. Returns the nearest waypoint's own
 * name within `WAYPOINT_MATCH_RADIUS_M`, or `null` when none is close
 * enough — callers should fall through to `getPeakName()` (Overpass, then
 * the minimalist numeric fallback) in that case, never fabricate a name of
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

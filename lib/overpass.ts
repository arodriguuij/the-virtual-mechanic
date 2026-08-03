import "server-only";

// "Geocodificación de Nombres de Puerto" — a bare "Cima Km 42 · 1800m"
// readout tells the athlete nothing about *which* real climb this is; a
// named summit ("Coll de Ordino") reads as a genuine route briefing instead
// of a coordinate dump. OpenStreetMap's own Overpass API is a free, no-key
// public database of exactly this kind of tag — queried server-side only
// (never from the browser, both for CORS and to keep this off the client
// bundle) and used purely as enrichment: any failure here degrades to the
// same illustrative fallback string, never blocks the calculation itself.
const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_SEARCH_RADIUS_M = 500;
const OVERPASS_FETCH_TIMEOUT_MS = 6000;

type OverpassElement = { tags?: { name?: string } };
type OverpassResponse = { elements: OverpassElement[] };

/**
 * Resolves a mountain-pass/summit's real name from OpenStreetMap
 * (`natural=mountain_pass|saddle|peak`, the same 3 tags a real col/summit
 * is usually mapped under) within `OVERPASS_SEARCH_RADIUS_M` of the given
 * point. Falls back to `Cima Km {distanceKm} · {elevationM}m` whenever OSM
 * has nothing named at this exact spot (a minor/unnamed summit) or the
 * request itself fails/times out — this is enrichment, not a required data
 * source, so a network hiccup here must never fail the caller's own
 * calculation.
 */
export async function getPeakName(
  lat: number,
  lon: number,
  distanceKm: number,
  elevationM: number
): Promise<string> {
  const fallback = `Cima Km ${Math.round(distanceKm)} · ${Math.round(elevationM)}m`;
  try {
    const query = `[out:json][timeout:5];node(around:${OVERPASS_SEARCH_RADIUS_M},${lat},${lon})["natural"~"^(mountain_pass|saddle|peak)$"];out body 1;`;
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

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
 * inspected `natural`. Falls back to `Cima Km {distanceKm} · {elevationM}m`
 * whenever OSM has nothing named at this exact spot (a minor/unnamed
 * summit) or the request itself fails/times out — this is enrichment, not
 * a required data source, so a network hiccup here must never fail the
 * caller's own calculation.
 */
export async function getPeakName(
  lat: number,
  lon: number,
  distanceKm: number,
  elevationM: number
): Promise<string> {
  const fallback = `Cima Km ${Math.round(distanceKm)} · ${Math.round(elevationM)}m`;
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

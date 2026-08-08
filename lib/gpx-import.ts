/**
 * Client-side GPX parser for the "Parser GPX Híbrido" upload flow — an
 * athlete without a saved Strava route (or planning somewhere they've never
 * ridden) can still drag in a `.gpx` file and get the same route-mode
 * fueling strategy a Strava route would produce. Pure DOM parsing via the
 * browser's own `DOMParser`, no server round-trip needed: distance/elevation/
 * coordinates are plain geometry, and — unlike a Strava route's summary
 * polyline, which has no altitude per point and needs a second Strava API
 * call (`fetchRouteElevationExtremes`) to find the summit/valley — a GPX
 * track already carries elevation on every point, so both can be found
 * locally too.
 */

import { detectMountainPasses, type MountainPass } from "@/lib/metabolic-engine";
import { detectElevationMilestones, type ElevationMilestone } from "@/lib/utils/elevation-parser";

export type ParsedGpxRoute = {
  name: string;
  distanceKm: number;
  elevationGainM: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  /** Highest-elevation point along the track, and how far along the route
   * (0-1, by distance) it sits — feeds the same summit weather sampling a
   * real Strava route uses, without a second API call. `null` when the file
   * has no elevation data at all. */
  peakLat: number | null;
  peakLng: number | null;
  peakDistanceFraction: number | null;
  /** The peak point's own absolute elevation (meters above sea level) —
   * already read from the track's `<ele>` data while scanning for the
   * highest point, just not previously kept. Feeds the "cota máxima ≥ 500m"
   * half of the altitude-differentiated weather threshold (see
   * `POST /api/fueling/plan`). `null` alongside `peakLat`/`peakLng` when the
   * file has no elevation data at all. */
  peakElevationM: number | null;
  /** Lowest-elevation point along the track ("Cota Mínima / Valle") — a
   * route that starts high, descends into a hot valley, and then climbs has
   * its real thermal peak at this point, not at the start. Same shape as the
   * peak fields above, `null` under the same conditions. */
  troughLat: number | null;
  troughLng: number | null;
  troughDistanceFraction: number | null;
  troughElevationM: number | null;
  /** "Rutas Multipuerto de Alta Montaña" — every real climb-then-descend
   * pass found along the track's own elevation profile (see
   * `detectMountainPasses` in `lib/metabolic-engine.ts`), computed locally
   * since a GPX file already carries per-point altitude — feeds the same
   * multi-summit caffeine-splitting logic a Strava route's own streams
   * call uses. `[]` when the file has no usable elevation data. */
  mountainPasses: MountainPass[];
  /** "Algoritmo de Detección de Puertos/Valles" — a finer-grained Salida →
   * [Valle → Cima]* → Llegada milestone list (see `detectElevationMilestones`
   * in `lib/utils/elevation-parser.ts`), each with its own real coordinates
   * for weather sampling and (for a "peak" milestone) Overpass name lookup —
   * feeds Card 03's thermal-impact carousel. `[]` under the same "no usable
   * elevation data" condition as `mountainPasses`. */
  elevationMilestones: ElevationMilestone[];
  /** The full decoded track, for `RouteMapPreview` — a GPX file already has
   * every point in hand locally, no polyline decoding needed the way a
   * Strava route's `summaryPolyline` requires. */
  points: [number, number][];
  /** Every usable `{distanceFraction, elevationM}` point along the track —
   * feeds `GpxAltimetryPreview`'s full tactical chart and, client-side,
   * `components/fueling-planner.tsx`'s own `detectMountainPasses()` call
   * (Card 01's "N puertos" map-badge figure) — the exact same array
   * `detectMountainPasses` above already builds internally, just also
   * returned here so the caller doesn't need a second pass over `points`
   * to reconstruct it. `[]` under the same "no usable elevation data"
   * condition as `mountainPasses`. */
  elevationProfile: { distanceFraction: number; elevationM: number }[];
  /** "Regla de Oro: Sin Inferencia de Nombres" — real, explicit `<wpt>`
   * waypoints from the GPX file itself (rider- or route-author-placed),
   * the one legitimate source of a hito's name stronger than an OSM
   * Overpass lookup — never inferred from the file's own title/name.
   * Threaded through to `POST /api/fueling/plan`, which checks these
   * before ever calling Overpass (see `findNearestWaypointName` in
   * `lib/overpass.ts`). `[]` for a file with no named waypoints at all.
   */
  waypoints: { lat: number; lng: number; name: string }[];
};

type TrackPoint = { lat: number; lng: number; eleM: number | null };

const EARTH_RADIUS_KM = 6371;

function haversineKm(a: TrackPoint, b: TrackPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Real, explicitly-named `<wpt>` elements — a *different* GPX concept
 * from the `<trkpt>`/`<rtept>` track points `extractPoints` reads: a
 * waypoint is a standalone point of interest the file's author placed on
 * purpose (often exactly at a named summit/col), not part of the
 * continuous ridden/planned line. Only kept when it has both real
 * coordinates *and* a non-empty `<name>` — an unnamed waypoint has nothing
 * a hito could use anyway. */
function extractWaypoints(doc: Document): { lat: number; lng: number; name: string }[] {
  return Array.from(doc.getElementsByTagName("wpt"))
    .map((node): { lat: number; lng: number; name: string } | null => {
      const lat = Number(node.getAttribute("lat"));
      const lng = Number(node.getAttribute("lon"));
      const name = node.getElementsByTagName("name")[0]?.textContent?.trim();
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !name) return null;
      return { lat, lng, name };
    })
    .filter((w): w is { lat: number; lng: number; name: string } => w != null);
}

function extractPoints(doc: Document): TrackPoint[] {
  // Prefer real track points; fall back to route points if the file only has
  // a planned route (no `<trkseg>`), never both — mixing would double-count.
  let pointNodes = Array.from(doc.getElementsByTagName("trkpt"));
  if (pointNodes.length === 0) pointNodes = Array.from(doc.getElementsByTagName("rtept"));

  return pointNodes
    .map((node): TrackPoint | null => {
      const lat = Number(node.getAttribute("lat"));
      const lng = Number(node.getAttribute("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const eleText = node.getElementsByTagName("ele")[0]?.textContent;
      const eleM = eleText != null ? Number(eleText) : null;
      return { lat, lng, eleM: eleM != null && Number.isFinite(eleM) ? eleM : null };
    })
    .filter((p): p is TrackPoint => p != null);
}

/**
 * Returns `null` for a file with fewer than 2 usable coordinates (malformed
 * GPX, or one with no `trkpt`/`rtept` at all) — the caller should show an
 * error rather than proceeding with a degenerate "route".
 */
export function parseGpxFile(xmlText: string, fileName: string): ParsedGpxRoute | null {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return null;

  const points = extractPoints(doc);
  if (points.length < 2) return null;

  let distanceKm = 0;
  let elevationGainM = 0;
  const cumulativeDistanceKm: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    distanceKm += haversineKm(points[i - 1], points[i]);
    cumulativeDistanceKm.push(distanceKm);
    const prevEle = points[i - 1].eleM;
    const ele = points[i].eleM;
    if (prevEle != null && ele != null && ele > prevEle) {
      elevationGainM += ele - prevEle;
    }
  }

  let peakIndex = -1;
  let peakEleM = -Infinity;
  let troughIndex = -1;
  let troughEleM = Infinity;
  points.forEach((p, i) => {
    if (p.eleM == null) return;
    if (p.eleM > peakEleM) {
      peakEleM = p.eleM;
      peakIndex = i;
    }
    if (p.eleM < troughEleM) {
      troughEleM = p.eleM;
      troughIndex = i;
    }
  });

  const gpxName = doc.getElementsByTagName("name")[0]?.textContent?.trim();
  const start = points[0];
  const end = points[points.length - 1];

  const elevationProfile = points
    .map((p, i) => (p.eleM != null && distanceKm > 0 ? { distanceFraction: cumulativeDistanceKm[i] / distanceKm, elevationM: p.eleM } : null))
    .filter((p): p is { distanceFraction: number; elevationM: number } => p != null);
  const mountainPasses = detectMountainPasses(elevationProfile);
  const milestoneSourcePoints = points
    .map((p, i) =>
      p.eleM != null && distanceKm > 0
        ? { lat: p.lat, lng: p.lng, distanceFraction: cumulativeDistanceKm[i] / distanceKm, elevationM: p.eleM }
        : null
    )
    .filter(
      (p): p is { lat: number; lng: number; distanceFraction: number; elevationM: number } => p != null
    );
  const elevationMilestones = detectElevationMilestones(milestoneSourcePoints, distanceKm);

  return {
    name: gpxName || fileName.replace(/\.gpx$/i, ""),
    distanceKm: Math.round(distanceKm * 10) / 10,
    elevationGainM: Math.round(elevationGainM),
    startLat: start.lat,
    startLng: start.lng,
    endLat: end.lat,
    endLng: end.lng,
    peakLat: peakIndex >= 0 ? points[peakIndex].lat : null,
    peakLng: peakIndex >= 0 ? points[peakIndex].lng : null,
    peakElevationM: peakIndex >= 0 ? Math.round(peakEleM) : null,
    peakDistanceFraction:
      peakIndex >= 0 && distanceKm > 0
        ? Math.max(0, Math.min(1, cumulativeDistanceKm[peakIndex] / distanceKm))
        : null,
    troughLat: troughIndex >= 0 ? points[troughIndex].lat : null,
    troughLng: troughIndex >= 0 ? points[troughIndex].lng : null,
    troughElevationM: troughIndex >= 0 ? Math.round(troughEleM) : null,
    troughDistanceFraction:
      troughIndex >= 0 && distanceKm > 0
        ? Math.max(0, Math.min(1, cumulativeDistanceKm[troughIndex] / distanceKm))
        : null,
    mountainPasses,
    elevationMilestones,
    points: points.map((p): [number, number] => [p.lat, p.lng]),
    elevationProfile,
    waypoints: extractWaypoints(doc),
  };
}

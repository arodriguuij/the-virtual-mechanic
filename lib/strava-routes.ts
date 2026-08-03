import "server-only";

import { decodePolyline } from "@/lib/strava";
import { detectMountainPasses, type MountainPass } from "@/lib/metabolic-engine";
import {
  detectElevationMilestones,
  downsampleElevationProfile,
  type ElevationMilestone,
  type ElevationProfilePoint,
} from "@/lib/utils/elevation-parser";

const STRAVA_API_BASE = "https://www.strava.com/api/v3";

// Strava route `type`: 1 = ride, 2 = run. We only care about the former.
const RIDE_ROUTE_TYPE = 1;

type StravaRouteApiResponse = {
  id_str: string;
  name: string;
  distance: number; // meters
  elevation_gain: number; // meters
  type: number;
  map: { summary_polyline: string | null } | null;
  // Strava's own estimate (seconds) of how long this route takes an
  // "average" rider — a real, documented field on the Route resource,
  // distinct from `moving_time`/`elapsed_time` (activity-only fields; a
  // saved route has never actually been ridden, so it has no elapsed time
  // of its own). Used purely to pre-fill "Tiempo estimado" in Card 02 —
  // never a substitute for this app's own FTP/intensity-aware
  // `estimateRideDurationHours()` unless the athlete explicitly edits the
  // field (see `POST /api/fueling/plan`'s `durationHoursOverride`).
  estimated_moving_time?: number;
};

export type StravaRoute = {
  id: string;
  name: string;
  distanceKm: number;
  elevationGainM: number;
  // Decoded from the route's own polyline — null if Strava has no map for
  // it, in which case dynamic weather can't be sampled for this route.
  startLat: number | null;
  startLng: number | null;
  // The route's last coordinate — together with `startLat`/`startLng`, lets
  // the multi-point weather sample (valley/summit/finish, see
  // `fetchRouteElevationExtremes` below) cover a loop or point-to-point
  // route without a second Strava call, since it's decoded from the same
  // already-fetched polyline.
  endLat: number | null;
  endLng: number | null;
  // The raw encoded polyline itself, kept alongside the already-decoded
  // start point — the GPX export needs the *whole* track, not just its
  // first coordinate, and re-fetching it later would be a wasted API call
  // since it's already right here in the routes-list response.
  summaryPolyline: string | null;
  // Strava's own "Tiempo Estimado" for this route (seconds), `null` when
  // Strava has nothing on file for it — see `StravaRouteApiResponse`'s own
  // field comment above for why this isn't a real elapsed/moving time.
  estimatedMovingTimeSec: number | null;
};

/**
 * Lists the athlete's saved/starred cycling routes, id included — this is
 * what feeds the fueling planner's "Ruta guardada de Strava" selector.
 * Returns `[]` (rather than throwing) on any API failure so a Strava
 * hiccup degrades to the manual quick-calculator mode instead of breaking
 * the whole planner.
 */
export async function fetchAthleteRoutes(accessToken: string): Promise<StravaRoute[]> {
  const res = await fetch(`${STRAVA_API_BASE}/athlete/routes?per_page=30`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    console.error(`Strava routes request failed: ${res.status} ${await res.text()}`);
    return [];
  }

  const routes: StravaRouteApiResponse[] = await res.json();
  return routes
    .filter((route) => route.type === RIDE_ROUTE_TYPE)
    .map((route) => {
      const polyline = route.map?.summary_polyline;
      const coordinates = polyline ? decodePolyline(polyline) : [];
      const firstPoint = coordinates[0];
      const lastPoint = coordinates[coordinates.length - 1];
      return {
        id: route.id_str,
        name: route.name,
        distanceKm: Math.round((route.distance / 1000) * 10) / 10,
        elevationGainM: Math.round(route.elevation_gain),
        startLat: firstPoint?.[0] ?? null,
        startLng: firstPoint?.[1] ?? null,
        endLat: lastPoint?.[0] ?? null,
        endLng: lastPoint?.[1] ?? null,
        summaryPolyline: polyline ?? null,
        estimatedMovingTimeSec:
          typeof route.estimated_moving_time === "number" ? route.estimated_moving_time : null,
      };
    });
}

export type RouteElevationPoint = {
  lat: number;
  lng: number;
  // How far along the route (by distance, 0-1) this point sits — used to
  // estimate its pass-through time the same way `getRouteSamplePoints`
  // estimates time for its own control points.
  distanceFraction: number;
  // This point's own absolute elevation (meters above sea level) — already
  // computed while scanning the altitude stream for its high/low point, just
  // not previously returned. Feeds the altitude-differentiated weather
  // threshold (see `POST /api/fueling/plan`).
  elevationM: number;
};

export type RouteElevationExtremes = {
  // The "Cota Máxima / Puerto" — a mountain route's actual summit.
  peak: RouteElevationPoint;
  // The "Cota Mínima / Valle" — a route's lowest point along its own
  // trace, not necessarily the start (a route can start high, descend
  // into a hot valley, then climb — the valley, not the start, is where
  // the ride's real thermal peak sits). See `POST /api/fueling/plan`'s
  // "Valle / Salida" weather card.
  trough: RouteElevationPoint;
  // "Rutas Multipuerto de Alta Montaña" — every real climb-then-descend
  // pass along the route (see `detectMountainPasses`), found in the same
  // pass over the already-fetched altitude stream rather than a second
  // Strava call. Used to fraction caffeine dosing across multiple summits
  // instead of one single late-ride dose — see `POST /api/fueling/plan`.
  mountainPasses: MountainPass[];
  // "Algoritmo de Detección de Puertos/Valles" — a finer-grained Salida →
  // [Valle → Cima]* → Llegada milestone list (see
  // `detectElevationMilestones`), each with real coordinates for its own
  // per-point weather sample and (for a "peak" milestone) Overpass name
  // lookup — feeds Card 03's thermal-impact carousel, distinct from
  // `mountainPasses` above, which only drives caffeine-dose timing.
  elevationMilestones: ElevationMilestone[];
  // Thinned per-point `{distanceFraction, elevationM}` curve for the same
  // carousel's own altitude-profile SVG — the real shape of the route, not
  // just its summit/trough extremes.
  elevationProfile: ElevationProfilePoint[];
};

// Unlike activity streams, Strava's route streams endpoint always returns
// this array-of-typed-objects shape regardless of `key_by_type` — verified
// live against the real API, which does not honor that param here the way
// it does for `/activities/{id}/streams`.
type StravaRouteStreamEntry = {
  type: "latlng" | "altitude" | "distance" | string;
  data: number[] | [number, number][];
};

/**
 * Finds both the highest- and lowest-elevation points along a saved route in
 * one pass over the same altitude stream — the "Cota Máxima / Puerto" a
 * mountain route climbs to, and the "Cota Mínima / Valle" it may dip through
 * first, both of which a single start-coordinate weather sample would
 * completely miss. Strava's route summary (the `/athlete/routes` list) only
 * has 2D polyline geometry, no altitude per point, so this is a second,
 * on-demand call to `/routes/{id}/streams` — only made when the athlete
 * actually calculates a strategy for a route (never eagerly), so it doesn't
 * add to the passive Strava call volume "Strava API & cache defensivo" above
 * is about. Returns `null` (never throws) on any failure — missing streams,
 * malformed data, or a route the access token doesn't have permission for —
 * so the caller can fall back to the existing start-point-only weather
 * sample instead of failing the whole calculation.
 */
export async function fetchRouteElevationExtremes(
  accessToken: string,
  routeId: string
): Promise<RouteElevationExtremes | null> {
  const res = await fetch(
    `${STRAVA_API_BASE}/routes/${routeId}/streams?keys=latlng,altitude,distance`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;

  const streams: StravaRouteStreamEntry[] = await res.json();
  const altitude = streams.find((s) => s.type === "altitude")?.data as number[] | undefined;
  const latlng = streams.find((s) => s.type === "latlng")?.data as
    | [number, number][]
    | undefined;
  const distance = streams.find((s) => s.type === "distance")?.data as number[] | undefined;
  if (!altitude || !latlng || altitude.length === 0 || altitude.length !== latlng.length) {
    return null;
  }

  let peakIndex = 0;
  let peakAltitude = -Infinity;
  let troughIndex = 0;
  let troughAltitude = Infinity;
  altitude.forEach((alt, i) => {
    if (alt > peakAltitude) {
      peakAltitude = alt;
      peakIndex = i;
    }
    if (alt < troughAltitude) {
      troughAltitude = alt;
      troughIndex = i;
    }
  });

  const totalDistance = distance?.[distance.length - 1];
  const distanceFractionAt = (index: number) =>
    Math.max(
      0,
      Math.min(
        1,
        distance && totalDistance ? distance[index] / totalDistance : index / (altitude.length - 1)
      )
    );

  const peakPoint = latlng[peakIndex];
  const troughPoint = latlng[troughIndex];
  if (!peakPoint || !troughPoint) return null;
  const [peakLat, peakLng] = peakPoint;
  const [troughLat, troughLng] = troughPoint;
  const elevationProfile = altitude.map((elevationM, i) => ({
    distanceFraction: distanceFractionAt(i),
    elevationM,
  }));
  const mountainPasses = detectMountainPasses(elevationProfile);
  const totalDistanceKm = totalDistance ? totalDistance / 1000 : 0;
  const elevationMilestones = detectElevationMilestones(
    altitude.map((elevationM, i) => ({
      lat: latlng[i][0],
      lng: latlng[i][1],
      distanceFraction: distanceFractionAt(i),
      elevationM,
    })),
    totalDistanceKm
  );
  return {
    peak: {
      lat: peakLat,
      lng: peakLng,
      distanceFraction: distanceFractionAt(peakIndex),
      elevationM: Math.round(peakAltitude),
    },
    trough: {
      lat: troughLat,
      lng: troughLng,
      distanceFraction: distanceFractionAt(troughIndex),
      elevationM: Math.round(troughAltitude),
    },
    mountainPasses,
    elevationMilestones,
    elevationProfile: downsampleElevationProfile(elevationProfile),
  };
}

type StravaSummarySegment = {
  name?: string;
  start_latlng?: [number, number];
};

type StravaRouteDetailResponse = {
  segments?: StravaSummarySegment[];
};

/**
 * "Segmentos Nativos de Strava" — a saved route built with Strava's own
 * route-builder often already passes through named, official Strava
 * segments (real climbs like "Alpe d'Huez," annotated by Strava itself or
 * by other athletes) — a stronger signal for a hito's name than an OSM
 * Overpass lookup at the same point, so it's checked first (see
 * `findNearestWaypointName` in `lib/overpass.ts`, reused here against each
 * segment's own `start_latlng` the exact same way it matches a GPX file's
 * `<wpt>` waypoints). This is the plain route detail endpoint
 * (`GET /routes/{id}`), distinct from `/streams` (`fetchRouteElevationExtremes`
 * above, which has no segment data at all) — fetched in parallel with it
 * whenever a strategy is calculated for a saved route. Returns `[]` (never
 * throws) on any failure, an unauthorized/missing route, or a route with no
 * annotated segments at all — same "enrichment, not a required data
 * source" convention as `fetchRouteElevationExtremes`.
 *
 * Implemented against Strava's own documented `Route` resource schema
 * (`segments: SummarySegment[]`) — not verified against a live response in
 * this environment (no network access to Strava's API here). Flag for a
 * real-world check (a real saved route that passes through an official
 * Strava segment) the next time this path can be exercised live.
 */
export async function fetchRouteSegments(
  accessToken: string,
  routeId: string
): Promise<{ lat: number; lng: number; name: string }[]> {
  const res = await fetch(`${STRAVA_API_BASE}/routes/${routeId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];

  const route: StravaRouteDetailResponse = await res.json();
  if (!Array.isArray(route.segments)) return [];

  return route.segments
    .filter(
      (s): s is StravaSummarySegment & { start_latlng: [number, number]; name: string } =>
        Array.isArray(s.start_latlng) &&
        s.start_latlng.length === 2 &&
        typeof s.name === "string" &&
        s.name.trim().length > 0
    )
    .map((s) => ({ lat: s.start_latlng[0], lng: s.start_latlng[1], name: s.name.trim() }));
}

import "server-only";

import { decodePolyline } from "@/lib/strava";

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
      const firstPoint = polyline ? decodePolyline(polyline)[0] : undefined;
      return {
        id: route.id_str,
        name: route.name,
        distanceKm: Math.round((route.distance / 1000) * 10) / 10,
        elevationGainM: Math.round(route.elevation_gain),
        startLat: firstPoint?.[0] ?? null,
        startLng: firstPoint?.[1] ?? null,
      };
    });
}

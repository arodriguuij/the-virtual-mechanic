import "server-only";

const STRAVA_API_BASE = "https://www.strava.com/api/v3";

type StravaZoneApiResponse = {
  type: "heartrate" | "power";
  distribution_buckets: { min: number; max: number; time: number }[];
}[];

export type StravaPowerZones = { min: number; max: number; time: number }[];

/**
 * Real time-in-power-zone buckets for one activity, straight from Strava's
 * `/activities/{id}/zones` — only present if the athlete rode with a power
 * meter *and* has power zones configured in Strava. Returns `null` (never
 * throws) on a 404/missing-scope/no-data response, so the Post-Ride
 * Analysis can fall back to its average-watts estimate instead of failing.
 */
export async function fetchActivityPowerZones(
  accessToken: string,
  activityId: string
): Promise<StravaPowerZones | null> {
  const res = await fetch(`${STRAVA_API_BASE}/activities/${activityId}/zones`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    return null;
  }

  const zones: StravaZoneApiResponse = await res.json();
  const powerZones = zones.find((zone) => zone.type === "power");
  return powerZones?.distribution_buckets ?? null;
}

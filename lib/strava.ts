import "server-only";

const STRAVA_AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_API_BASE = "https://www.strava.com/api/v3";
const STRAVA_SCOPES = "read,activity:read_all,profile:read_all";

// Sport types we treat as "a ride" for the dashboard's cycling focus.
const CYCLING_SPORT_TYPES = new Set([
  "Ride",
  "MountainBikeRide",
  "GravelRide",
  "VirtualRide",
  "EBikeRide",
  "Handcycle",
  "Velomobile",
]);

// Strava requires the exact same redirect_uri in the authorize call and the
// token exchange. Deriving it from the incoming request (rather than a
// hardcoded literal) means this works unchanged on localhost and on
// whatever domain it's deployed to — as long as that domain is also set as
// the app's Authorization Callback Domain in the Strava API settings.
export function getStravaRedirectUri(requestUrl: string): string {
  return new URL("/api/auth/strava/callback", requestUrl).toString();
}

function getClientCredentials() {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Faltan STRAVA_CLIENT_ID o STRAVA_CLIENT_SECRET en .env.local");
  }
  return { clientId, clientSecret };
}

export function getStravaAuthorizeUrl(redirectUri: string): string {
  const { clientId } = getClientCredentials();
  const url = new URL(STRAVA_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", STRAVA_SCOPES);
  return url.toString();
}

export type StravaTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  athlete?: { id: number };
};

async function postToken(body: Record<string, string>): Promise<StravaTokenResponse> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    throw new Error(`Strava token request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<StravaTokenResponse> {
  const { clientId, clientSecret } = getClientCredentials();
  return postToken({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
}

export function refreshStravaToken(refreshToken: string): Promise<StravaTokenResponse> {
  const { clientId, clientSecret } = getClientCredentials();
  return postToken({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
}

export type StravaActivity = {
  id: number;
  name: string;
  distance: number;
  total_elevation_gain: number;
  moving_time: number;
  average_watts: number | null;
  type: string;
  sport_type: string;
  start_date: string;
  // [lat, lng], or an empty array when the activity has no GPS data or the
  // start is hidden by a privacy zone.
  start_latlng: [number, number] | [];
  // The Strava "gear" (bike) id this ride was logged against, e.g. "b12345678"
  // — null if the athlete didn't tag a bike on the activity.
  gear_id: string | null;
  // True for indoor trainer rides regardless of sport_type.
  trainer: boolean;
};

export async function fetchLatestRideActivity(
  accessToken: string
): Promise<StravaActivity | null> {
  const res = await fetch(`${STRAVA_API_BASE}/athlete/activities?per_page=10`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Strava activities request failed: ${res.status} ${await res.text()}`);
  }
  const activities: StravaActivity[] = await res.json();
  return activities.find((a) => CYCLING_SPORT_TYPES.has(a.sport_type ?? a.type)) ?? null;
}

/** True for an indoor/virtual ride — Zwift, Rouvy, a smart trainer, etc. —
 * where there's no real road surface or weather to model wear/climate from. */
export function isIndoorRide(activity: Pick<StravaActivity, "trainer" | "sport_type" | "type">): boolean {
  return activity.trainer === true || activity.sport_type === "VirtualRide" || activity.type === "VirtualRide";
}

export type StravaGear = {
  id: string;
  name: string;
  primary: boolean;
  distance: number;
};

/**
 * Lists the athlete's bikes as Strava knows them, id included — the only way
 * to find the real `gear_id` to store in `bikes.strava_gear_id` short of the
 * user reading it out of Strava's own UI (which doesn't surface it plainly).
 */
export async function fetchAthleteBikes(accessToken: string): Promise<StravaGear[]> {
  const res = await fetch(`${STRAVA_API_BASE}/athlete`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Strava athlete request failed: ${res.status} ${await res.text()}`);
  }
  const athlete = await res.json();
  return athlete.bikes ?? [];
}

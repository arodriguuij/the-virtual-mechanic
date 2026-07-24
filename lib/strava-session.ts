import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { refreshStravaToken } from "@/lib/strava";

/**
 * Returns a valid (refreshed if needed) Strava access token for this user,
 * persisting the refresh back to `profiles` — shared by every route that
 * calls the Strava API on the user's behalf (ride sync, route listing) so
 * the refresh dance lives in one place. Returns `null` if Strava was never
 * connected.
 */
export async function getValidStravaAccessToken(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("strava_access_token, strava_refresh_token, strava_expires_at")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.strava_refresh_token) return null;

  let accessToken = profile.strava_access_token as string | null;
  const expiresAtMs = profile.strava_expires_at
    ? new Date(profile.strava_expires_at as string).getTime()
    : 0;
  const needsRefresh = !accessToken || expiresAtMs < Date.now() + 60_000;

  if (needsRefresh) {
    const refreshed = await refreshStravaToken(profile.strava_refresh_token as string);
    accessToken = refreshed.access_token;

    const { error: refreshUpdateError } = await supabase
      .from("profiles")
      .update({
        strava_access_token: refreshed.access_token,
        strava_refresh_token: refreshed.refresh_token,
        strava_expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
      })
      .eq("id", userId);
    if (refreshUpdateError) throw refreshUpdateError;
  }

  return accessToken;
}

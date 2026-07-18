import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { fetchLatestRideActivity, refreshStravaToken } from "@/lib/strava";
import { getWeatherForRide } from "@/lib/open-meteo";
import { applyRideToDrivetrain, estimateWattsLost } from "@/lib/wear-model";

export async function POST(request: NextRequest) {
  const redirectWithError = (code: string) =>
    NextResponse.redirect(new URL(`/?strava_error=${code}`, request.url), { status: 303 });

  const supabase = await getAuthenticatedSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) return redirectWithError("no_session");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("strava_access_token, strava_refresh_token, strava_expires_at")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;

  if (!profile?.strava_refresh_token) {
    return redirectWithError("not_connected");
  }

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

  const activity = await fetchLatestRideActivity(accessToken!);
  if (!activity) {
    return redirectWithError("no_rides");
  }

  const activityId = String(activity.id);
  const { data: existing, error: existingError } = await supabase
    .from("activities")
    .select("id")
    .eq("id", activityId)
    .maybeSingle();
  if (existingError) throw existingError;

  // Everything below only runs for a genuinely new activity — re-syncing an
  // already-stored ride must not double-count its distance against wear.
  if (!existing) {
    const averageWatts = activity.average_watts ?? null;

    const startLatLng = activity.start_latlng.length === 2 ? activity.start_latlng : null;
    const weather = await getWeatherForRide(
      startLatLng,
      activity.start_date,
      activity.moving_time
    );
    // No GPS / no data for the window (indoor trainer, privacy zone, API
    // hiccup) — fall back to a neutral placeholder instead of failing sync.
    const humidityAvg = weather?.humidityAvg ?? 50;
    const rainMm = weather?.rainMm ?? 0;
    const wattsLost = estimateWattsLost({ averageWatts, humidityAvg, rainMm });

    const { error: insertError } = await supabase.from("activities").insert({
      id: activityId,
      profile_id: userId,
      name: activity.name,
      distance: activity.distance,
      total_elevation_gain: activity.total_elevation_gain,
      moving_time: activity.moving_time,
      average_watts: averageWatts,
      rain_mm: Math.round(rainMm * 10) / 10,
      humidity_avg: Math.round(humidityAvg * 10) / 10,
      watts_lost: wattsLost,
      activity_date: activity.start_date,
    });
    if (insertError) throw insertError;

    const rideKm = activity.distance / 1000;
    const { data: bike, error: bikeError } = await supabase
      .from("bikes")
      .select("id, components(id, type, tier, max_km, current_wear_percentage)")
      .eq("profile_id", userId)
      .limit(1)
      .maybeSingle();
    if (bikeError) throw bikeError;

    // Chain wear (weather-multiplied) is resolved first inside the model —
    // its pre-ride value then drives the cassette/chainring cascade — so the
    // whole drivetrain triangle comes back ready to persist in one pass.
    const wearUpdates = applyRideToDrivetrain(bike?.components ?? [], rideKm, {
      humidityAvg,
      rainMm,
    });

    for (const { id, newWearPercentage } of wearUpdates) {
      const { data: updated, error: wearUpdateError } = await supabase
        .from("components")
        .update({ current_wear_percentage: newWearPercentage })
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (wearUpdateError) throw wearUpdateError;
      if (!updated) {
        console.error(
          `No se pudo actualizar el desgaste del componente ${id}: RLS bloqueó el UPDATE.`
        );
      }
    }
  }

  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}

import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import {
  fetchLatestRideActivity,
  getRouteSamplePoints,
  isIndoorRide,
  refreshStravaToken,
} from "@/lib/strava";
import { getWeatherForRoute } from "@/lib/open-meteo";
import { applyRideToComponents, estimateWattsLost } from "@/lib/wear-model";

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

  // Fetched up front (even before we know if this activity is new) so the
  // gear-id shield can reject a wrong-bike activity before any DB write —
  // including the `activities` insert itself.
  const { data: bike, error: bikeError } = await supabase
    .from("bikes")
    .select(
      "id, strava_gear_id, components(id, type, tier, max_km, current_wear_percentage, lubricant_type, kms_since_last_lube)"
    )
    .eq("profile_id", userId)
    .limit(1)
    .maybeSingle();
  if (bikeError) throw bikeError;

  // Only enforced once a real gear id has been bound — until then, an unset
  // strava_gear_id means "accept every ride," matching pre-Sprint-A behavior.
  if (bike?.strava_gear_id && activity.gear_id !== bike.strava_gear_id) {
    return redirectWithError("wrong_bike");
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
    const isIndoor = isIndoorRide(activity);

    // Indoor/virtual rides have no real road weather to speak of — skip the
    // Open-Meteo round trip entirely and fall back to the same neutral
    // placeholder used when outdoor weather data is unavailable.
    let humidityAvg = 50;
    let rainMm = 0;
    if (!isIndoor) {
      const distanceKm = activity.distance / 1000;
      const summaryPolyline = activity.map?.summary_polyline;
      // Dynamic point count (1 per 25km, clamped to [3, 8]) instead of a
      // fixed sample size — a long ride gets enough coverage to catch a
      // localized storm, a short one doesn't hammer the API for nothing.
      const samplePoints = summaryPolyline
        ? getRouteSamplePoints(summaryPolyline, distanceKm, activity.start_date, activity.moving_time)
        : [];
      const weather = samplePoints.length > 0 ? await getWeatherForRoute(samplePoints) : null;
      // No route map / no data at any sampled point (privacy zone, API
      // hiccup) — fall back to a neutral placeholder instead of failing sync.
      humidityAvg = weather?.humidityAvg ?? 50;
      rainMm = weather?.rainMm ?? 0;
    }
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

    // "Ruta en Mojado" — at least one geographic sample point along the
    // route crossed real rain, even if the start coordinate stayed dry.
    // Chemically strips the chain's lubricant — flagged here (before the
    // model runs) purely as an internal signal; the actual counter jump
    // happens inside applyRideToComponents/getNextKmsSinceLastLube.
    if (!isIndoor && rainMm > 0 && (bike?.components ?? []).some((c) => c.type === "chain")) {
      console.warn(
        `Ruta en Mojado: "${activity.name}" (máx ${rainMm}mm en un punto de muestreo). kms_since_last_lube salta al límite de degradación del lubricante hasta la próxima relubricación.`
      );
    }

    // Chain wear (weather- and lubricant-multiplied) is resolved first
    // inside the model — its pre-ride wear and lubrication state then drive
    // the cassette/chainring cascade and chemical multipliers — plus the
    // braking module reacting to this same ride's rain and elevation gain —
    // so every wearable part on the bike comes back ready to persist in one
    // pass. Indoor rides zero out every road-contact part regardless of the
    // (placeholder) weather values passed in.
    const wearUpdates = applyRideToComponents(bike?.components ?? [], {
      km: rideKm,
      elevationGainM: activity.total_elevation_gain,
      weather: { humidityAvg, rainMm },
      isIndoor,
    });

    for (const { id, newWearPercentage, newKmsSinceLastLube } of wearUpdates) {
      const patch: { current_wear_percentage: number; kms_since_last_lube?: number } = {
        current_wear_percentage: newWearPercentage,
      };
      if (newKmsSinceLastLube !== undefined) {
        patch.kms_since_last_lube = newKmsSinceLastLube;
      }
      const { data: updated, error: wearUpdateError } = await supabase
        .from("components")
        .update(patch)
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

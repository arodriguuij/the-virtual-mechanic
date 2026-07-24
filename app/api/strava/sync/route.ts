import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { fetchLatestRideActivity, getRouteSamplePoints, isIndoorRide } from "@/lib/strava";
import { getValidStravaAccessToken } from "@/lib/strava-session";
import { getWeatherForRoute } from "@/lib/open-meteo";
import {
  getCarbOxidationRateGPerHour,
  getFluidLossMlPerHour,
  getRelativeIntensity,
  getSodiumLossMgPerHour,
} from "@/lib/metabolic-engine";

// Typical smart-trainer-room conditions — warmer and more humid than a
// comfortable outdoor baseline, since indoor rides get none of the
// convective cooling a moving bike gets outside.
const INDOOR_TEMPERATURE_C = 26;
const INDOOR_HUMIDITY_PCT = 60;

export async function POST(request: NextRequest) {
  const redirectWithError = (code: string) =>
    NextResponse.redirect(new URL(`/?strava_error=${code}`, request.url), { status: 303 });

  const supabase = await getAuthenticatedSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) return redirectWithError("no_session");

  const accessToken = await getValidStravaAccessToken(supabase, userId);
  if (!accessToken) {
    return redirectWithError("not_connected");
  }

  const activity = await fetchLatestRideActivity(accessToken);
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
  // already-stored ride must not double-count its nutritional cost.
  if (!existing) {
    const averageWatts = activity.average_watts ?? null;
    const isIndoor = isIndoorRide(activity);

    let humidityAvg: number;
    let temperatureAvgC: number;
    let rainMm: number;
    if (isIndoor) {
      // No real outdoor weather to sample for a trainer ride.
      humidityAvg = INDOOR_HUMIDITY_PCT;
      temperatureAvgC = INDOOR_TEMPERATURE_C;
      rainMm = 0;
    } else {
      const distanceKm = activity.distance / 1000;
      const summaryPolyline = activity.map?.summary_polyline;
      const samplePoints = summaryPolyline
        ? getRouteSamplePoints(summaryPolyline, distanceKm, activity.start_date, activity.moving_time)
        : [];
      const weather = samplePoints.length > 0 ? await getWeatherForRoute(samplePoints) : null;
      // No route map / no data at any sampled point (privacy zone, API
      // hiccup) — fall back to a neutral placeholder instead of failing sync.
      humidityAvg = weather?.humidityAvg ?? 50;
      temperatureAvgC = weather?.temperatureAvgC ?? 18;
      rainMm = weather?.rainMm ?? 0;
    }

    const { data: athleteProfile, error: athleteProfileError } = await supabase
      .from("athlete_profiles")
      .select("ftp, sweat_rate")
      .eq("id", userId)
      .maybeSingle();
    if (athleteProfileError) throw athleteProfileError;

    // No FTP set up yet → can't estimate carb oxidation for this ride; the
    // ride is still logged, just without nutrition figures attached.
    let carbsBurnedG: number | null = null;
    let fluidLossMl: number | null = null;
    let sodiumLossMg: number | null = null;
    if (athleteProfile?.ftp && averageWatts != null) {
      const relativeIntensity = getRelativeIntensity(averageWatts, athleteProfile.ftp);
      const hours = activity.moving_time / 3600;
      carbsBurnedG = Math.round(getCarbOxidationRateGPerHour(relativeIntensity) * hours);

      const sweatRate = athleteProfile.sweat_rate ?? "medium";
      const fluidLossMlPerHour = getFluidLossMlPerHour(sweatRate, temperatureAvgC, humidityAvg);
      fluidLossMl = Math.round(fluidLossMlPerHour * hours);
      sodiumLossMg = Math.round(getSodiumLossMgPerHour(fluidLossMlPerHour) * hours);
    }

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
      temperature_avg: Math.round(temperatureAvgC * 10) / 10,
      carbs_burned_g: carbsBurnedG,
      fluid_loss_ml: fluidLossMl,
      sodium_loss_mg: sodiumLossMg,
      activity_date: activity.start_date,
    });
    if (insertError) throw insertError;
  }

  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}

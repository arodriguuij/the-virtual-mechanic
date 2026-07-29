import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchLatestRideActivity, getRouteSamplePoints, isIndoorRide } from "@/lib/strava";
import { getWeatherForRoute } from "@/lib/open-meteo";
import {
  getFluidLossMlPerHour,
  getGlycogenBurnedGrams,
  getRelativeIntensity,
  getSodiumLossMgPerHour,
} from "@/lib/metabolic-engine";

// Typical smart-trainer-room conditions — warmer and more humid than a
// comfortable outdoor baseline, since indoor rides get none of the
// convective cooling a moving bike gets outside.
const INDOOR_TEMPERATURE_C = 26;
const INDOOR_HUMIDITY_PCT = 60;

export type SyncLatestActivityResult =
  | { status: "no_rides" }
  | { status: "synced"; activityName: string; isNew: boolean };

/**
 * Pulls the athlete's latest cycling activity and writes it into `activities`
 * if it isn't already there — the exact logic `POST /api/strava/sync`'s
 * button handler runs, extracted here so the first-login onboarding
 * bootstrap (`app/api/auth/strava/callback/route.ts`) can reuse the identical
 * weather-sampling/nutrition-calculation pipeline instead of drifting out of
 * sync with a second, hand-copied implementation. Never throws on a Strava
 * hiccup at the per-point weather level (same "fall back to a neutral
 * placeholder" convention as the rest of this codebase) — only a genuine
 * Supabase error propagates, since both callers already handle that as a
 * hard failure of their own request.
 */
export async function syncLatestActivity(
  supabase: SupabaseClient,
  userId: string,
  accessToken: string
): Promise<SyncLatestActivityResult> {
  const activity = await fetchLatestRideActivity(accessToken);
  if (!activity) return { status: "no_rides" };

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
      humidityAvg = weather?.humidityAvg ?? 50;
      temperatureAvgC = weather?.temperatureAvgC ?? 18;
      rainMm = weather?.rainMm ?? 0;
    }

    const { data: athleteProfile, error: athleteProfileError } = await supabase
      .from("athlete_profiles")
      .select("ftp, sweat_rate, athlete_type, is_salty_sweater")
      .eq("id", userId)
      .maybeSingle();
    if (athleteProfileError) throw athleteProfileError;

    let carbsBurnedG: number | null = null;
    let fluidLossMl: number | null = null;
    let sodiumLossMg: number | null = null;
    if (athleteProfile?.ftp && averageWatts != null) {
      const relativeIntensity = getRelativeIntensity(averageWatts, athleteProfile.ftp);
      const athleteType = athleteProfile.athlete_type ?? "balanced";
      carbsBurnedG = getGlycogenBurnedGrams(relativeIntensity, activity.moving_time, athleteType);
      const hours = activity.moving_time / 3600;

      const fluidLossMlPerHour = getFluidLossMlPerHour(
        athleteProfile.sweat_rate,
        temperatureAvgC,
        humidityAvg
      );
      fluidLossMl = Math.round(fluidLossMlPerHour * hours);
      sodiumLossMg = Math.round(
        getSodiumLossMgPerHour(fluidLossMlPerHour, athleteProfile.is_salty_sweater ?? false) * hours
      );
    }

    const { error: insertError } = await supabase.from("activities").upsert(
      {
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
      },
      { onConflict: "id", ignoreDuplicates: true }
    );
    if (insertError) throw insertError;
  }

  return { status: "synced", activityName: activity.name, isNew: !existing };
}

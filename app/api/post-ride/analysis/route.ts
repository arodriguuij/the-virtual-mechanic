import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { getValidStravaAccessToken } from "@/lib/strava-session";
import { fetchActivityPowerZones } from "@/lib/strava-zones";
import { hasPostRideLog, logFuelingPlan } from "@/lib/fueling-logs";
import {
  getFluidLossMlPerHour,
  getGlycogenBurnedFromPowerZones,
  getGlycogenBurnedGrams,
  getPostRideRecoveryTarget,
  getRecoveryMealOptions,
  getRelativeIntensity,
  getSodiumLossMgPerHour,
} from "@/lib/metabolic-engine";

export async function POST(request: NextRequest) {
  const supabase = await getAuthenticatedSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const activityId = typeof body?.activityId === "string" ? body.activityId : null;
  if (!activityId) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { data: athleteProfile, error: athleteProfileError } = await supabase
    .from("athlete_profiles")
    .select("ftp, weight_kg, sweat_rate, athlete_type")
    .eq("id", userId)
    .maybeSingle();
  if (athleteProfileError) throw athleteProfileError;
  if (!athleteProfile) {
    return NextResponse.json({ error: "no_profile" }, { status: 400 });
  }

  const { data: activity, error: activityError } = await supabase
    .from("activities")
    .select(
      "id, name, distance, moving_time, average_watts, humidity_avg, temperature_avg, carbs_burned_g, fluid_loss_ml, sodium_loss_mg, activity_date"
    )
    .eq("id", activityId)
    .eq("profile_id", userId)
    .maybeSingle();
  if (activityError) throw activityError;
  if (!activity) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const hours = activity.moving_time / 3600;

  // Prefer real time-in-power-zone data over a single ride-average watts
  // figure — falls back gracefully (no power meter, no zones configured,
  // or a seed/synthetic activity id Strava has never heard of).
  let carbsBurnedG: number | null = null;
  let source: "zones" | "average_watts" | "stored" | "no_data" = "no_data";

  const athleteType = athleteProfile.athlete_type ?? "balanced";

  const accessToken = await getValidStravaAccessToken(supabase, userId);
  if (accessToken) {
    const buckets = await fetchActivityPowerZones(accessToken, activityId);
    if (buckets && athleteProfile.ftp) {
      carbsBurnedG = getGlycogenBurnedFromPowerZones(buckets, athleteProfile.ftp, athleteType);
      source = "zones";
    }
  }

  if (carbsBurnedG == null && athleteProfile.ftp && activity.average_watts != null) {
    const relativeIntensity = getRelativeIntensity(activity.average_watts, athleteProfile.ftp);
    carbsBurnedG = getGlycogenBurnedGrams(relativeIntensity, activity.moving_time, athleteType);
    source = "average_watts";
  }

  if (carbsBurnedG == null && activity.carbs_burned_g != null) {
    carbsBurnedG = activity.carbs_burned_g;
    source = "stored";
  }

  if (carbsBurnedG == null) {
    return NextResponse.json({ error: "no_data" }, { status: 400 });
  }

  const fluidLossMlPerHour = getFluidLossMlPerHour(
    athleteProfile.sweat_rate,
    activity.temperature_avg ?? 18,
    activity.humidity_avg
  );
  const fluidLossMl = Math.round(fluidLossMlPerHour * hours);
  const sodiumLossMg = Math.round(getSodiumLossMgPerHour(fluidLossMlPerHour) * hours);

  const recoveryTarget = getPostRideRecoveryTarget(athleteProfile.weight_kg);
  const mealOptions = getRecoveryMealOptions(recoveryTarget);

  let loggedNew = false;
  const alreadyLogged = await hasPostRideLog(supabase, userId, activityId);
  if (!alreadyLogged) {
    await logFuelingPlan(supabase, {
      profileId: userId,
      kind: "post_ride",
      activityId,
      totalCarbsG: carbsBurnedG,
      fluidMl: fluidLossMl,
      sodiumMg: sodiumLossMg,
      moneySaved: 0,
    });
    loggedNew = true;
  }

  return NextResponse.json({
    activity: {
      name: activity.name,
      activityDate: activity.activity_date,
      distanceKm: Math.round((activity.distance / 1000) * 10) / 10,
      durationHours: Math.round(hours * 100) / 100,
    },
    carbsBurnedG,
    fluidLossMl,
    sodiumLossMg,
    source,
    recoveryTarget,
    mealOptions,
    loggedNew,
  });
}

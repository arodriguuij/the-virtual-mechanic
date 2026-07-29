import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { fetchActivityDetail } from "@/lib/strava";
import { decodePolyline } from "@/lib/polyline";
import { getValidStravaAccessToken } from "@/lib/strava-session";
import { fetchActivityPowerZones } from "@/lib/strava-zones";
import { hasPostRideLog, logFuelingPlan } from "@/lib/fueling-logs";
import {
  getFluidLossMlPerHour,
  getGlycogenBurnedFromHeartRate,
  getGlycogenBurnedFromPowerZones,
  getGlycogenBurnedGrams,
  getMacroRecoveryTarget,
  getRecoveryDebt,
  getRelativeIntensity,
  getRelativeIntensityFromLevel,
  getSodiumLossMgPerHour,
  type IntensityLevel,
} from "@/lib/metabolic-engine";

// The post-ride RPE picker only offers 3 of the 5 named intensities — a
// rider self-reporting effort after the fact thinks in "easy/moderate/hard,"
// not 5 finely graded levels the pre-ride planner uses when a real target
// power is being set in advance.
const VALID_RPE_LEVELS: readonly IntensityLevel[] = ["endurance", "tempo", "threshold"];

function isValidRpeLevel(value: unknown): value is IntensityLevel {
  return typeof value === "string" && (VALID_RPE_LEVELS as readonly string[]).includes(value);
}

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
  const rpeLevel = isValidRpeLevel(body?.rpeLevel) ? body.rpeLevel : null;

  const { data: athleteProfile, error: athleteProfileError } = await supabase
    .from("athlete_profiles")
    .select("ftp, weight_kg, sweat_rate, athlete_type, is_salty_sweater")
    .eq("id", userId)
    .maybeSingle();
  if (athleteProfileError) throw athleteProfileError;
  if (!athleteProfile) {
    return NextResponse.json({ error: "no_profile" }, { status: 400 });
  }

  const { data: activity, error: activityError } = await supabase
    .from("activities")
    .select(
      "id, name, distance, moving_time, average_watts, total_elevation_gain, humidity_avg, temperature_avg, carbs_burned_g, fluid_loss_ml, sodium_loss_mg, activity_date"
    )
    .eq("id", activityId)
    .eq("profile_id", userId)
    .maybeSingle();
  if (activityError) throw activityError;
  if (!activity) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const hours = activity.moving_time / 3600;
  // Guaranteed real: the `!athleteProfile` check above already means this
  // row exists, and `weight_kg` is `NOT NULL` — no fallback needed, and none
  // should ever be added here (see CLAUDE.md's "Eliminating profile
  // fallbacks" — a fabricated weight would silently skew every downstream
  // energy/glycogen figure on this response).
  const weightKg = athleteProfile.weight_kg;

  // Prefers, in order: real time-in-power-zone data; a heart-rate-based
  // estimate when there's no power meter at all (device_watts false/absent —
  // real HR beats trusting Strava's own estimated wattage); a plain
  // ride-average-watts estimate (real or Strava-estimated, whichever it is)
  // when there's no HR either; the sync-time stored figure; a self-reported
  // RPE level for a rider with literally no sensors of any kind (no power,
  // no HR, and Strava itself has no estimate); and only then "needs_rpe" (not
  // yet "no data" — there's still a path forward) or, if RPE was somehow
  // also unusable, "no_data" — never a computed/returned NaN.
  let carbsBurnedG: number | null = null;
  // "no_data" here is only ever an unused initial value — every branch below
  // that sets `carbsBurnedG` also sets `source`, and the one path where none
  // of them fire returns early (`needs_rpe`/`no_data` as the error code)
  // before this field is ever serialized into a real response.
  let source: "zones" | "heartrate" | "average_watts" | "stored" | "rpe" | "no_data" = "no_data";

  const athleteType = athleteProfile.athlete_type ?? "balanced";

  const accessToken = await getValidStravaAccessToken(supabase, userId);
  // Fetched unconditionally (not just when the zones/FTP path is unavailable)
  // — this now also powers the telemetry card's energy/power/heart-rate
  // display below, which is a separate concern from which fallback tier
  // actually produced `carbsBurnedG`.
  const activityDetail = accessToken ? await fetchActivityDetail(accessToken, activityId) : null;

  if (accessToken) {
    const buckets = await fetchActivityPowerZones(accessToken, activityId);
    if (buckets && athleteProfile.ftp) {
      carbsBurnedG = getGlycogenBurnedFromPowerZones(buckets, athleteProfile.ftp, athleteType);
      source = "zones";
    }
  }

  // Plan A: no real power meter on this ride, but it has heart-rate data.
  if (
    carbsBurnedG == null &&
    activityDetail &&
    !activityDetail.deviceWatts &&
    activityDetail.hasHeartrate &&
    activityDetail.averageHeartrate &&
    activityDetail.maxHeartrate
  ) {
    carbsBurnedG = getGlycogenBurnedFromHeartRate(
      activityDetail.averageHeartrate,
      activityDetail.maxHeartrate,
      activity.moving_time,
      athleteType
    );
    source = "heartrate";
  }

  // Plan B: ride-average watts — real or Strava-estimated, whichever it is
  // — when there's nothing more precise to go on.
  if (carbsBurnedG == null && athleteProfile.ftp && activity.average_watts != null) {
    const relativeIntensity = getRelativeIntensity(activity.average_watts, athleteProfile.ftp);
    carbsBurnedG = getGlycogenBurnedGrams(relativeIntensity, activity.moving_time, athleteType);
    source = "average_watts";
  }

  if (carbsBurnedG == null && activity.carbs_burned_g != null) {
    carbsBurnedG = activity.carbs_burned_g;
    source = "stored";
  }

  // Plan C: a genuinely sensor-less ride (no power meter, no heart-rate
  // strap, and Strava itself had nothing stored at sync time either) — the
  // one case a real number is only possible if the rider tells us how hard
  // it felt. Doesn't need FTP, unlike zones/Plan B, since the intensity
  // comes directly from the self-reported level rather than a %FTP figure.
  if (carbsBurnedG == null && rpeLevel) {
    const relativeIntensity = getRelativeIntensityFromLevel(rpeLevel);
    carbsBurnedG = getGlycogenBurnedGrams(relativeIntensity, activity.moving_time, athleteType);
    source = "rpe";
  }

  if (carbsBurnedG == null) {
    return NextResponse.json({ error: "needs_rpe" }, { status: 400 });
  }
  if (!Number.isFinite(carbsBurnedG)) {
    return NextResponse.json({ error: "no_data" }, { status: 400 });
  }

  const fluidLossMlPerHour = getFluidLossMlPerHour(
    athleteProfile.sweat_rate,
    activity.temperature_avg ?? 18,
    activity.humidity_avg
  );
  const fluidLossMl = Math.round(fluidLossMlPerHour * hours);
  const sodiumLossMg = Math.round(
    getSodiumLossMgPerHour(fluidLossMlPerHour, athleteProfile.is_salty_sweater ?? false) * hours
  );

  // Telemetry card data — the raw sensor readings themselves (energy, power,
  // heart rate), always computed with a safe fallback/default regardless of
  // which tier above actually produced `carbsBurnedG`, so a rider with no
  // power meter still sees a real (if less precise) energy figure and a
  // clean "N/A" rather than a blank or a NaN for whatever sensor they don't
  // have. Roughly, kilojoules of mechanical work ≈ kcal burned for a cyclist
  // (a widely-used coaching approximation, not a clinical conversion) — same
  // "heuristic, not clinical" convention as the rest of this file.
  const kilojoules = activityDetail?.kilojoules ?? null;
  const calories = activityDetail?.calories ?? null;
  const elevationGainM = activity.total_elevation_gain ?? 0;
  const energyKcal = kilojoules
    ? Math.round(kilojoules)
    : calories
      ? Math.round(calories)
      : Math.round(hours * (weightKg * 10) + elevationGainM * 0.75);
  const energySource: "kilojoules" | "calories" | "estimated" = kilojoules
    ? "kilojoules"
    : calories
      ? "calories"
      : "estimated";

  const hasDevicePower = activityDetail?.deviceWatts === true;
  const powerWatts = activityDetail?.averageWatts ?? activity.average_watts ?? null;
  const powerSource: "device" | "estimated" | "none" = hasDevicePower
    ? "device"
    : powerWatts != null
      ? "estimated"
      : "none";
  const normalizedPowerWatts = hasDevicePower ? (activityDetail?.weightedAverageWatts ?? null) : null;
  const heartrateAvg = activityDetail?.averageHeartrate ?? null;

  // Decoded route geometry for the telemetry card's map preview — many
  // Strava routes share generic/duplicate names, so seeing the actual track
  // shape is what actually lets an athlete confirm *which* ride they're
  // auditing. `null` for an indoor ride, a GPS-less outdoor one, or if the
  // token/API call failed — `RouteMapPreview` already renders a neutral
  // placeholder for that case.
  const points = activityDetail?.summaryPolyline
    ? decodePolyline(activityDetail.summaryPolyline)
    : null;

  // Initial figures assume zero in-ride intake — the client recomputes this
  // live once the athlete fills in what they actually consumed during the
  // ride (see `components/post-ride-analysis.tsx`), using the same pure
  // `getRecoveryDebt`/`getMacroRecoveryTarget` functions re-imported there.
  const recoveryDebt = getRecoveryDebt({
    carbsBurnedG,
    carbsConsumedG: 0,
    fluidLossMl,
    fluidConsumedMl: 0,
    sodiumLossMg,
    sodiumConsumedMg: 0,
  });
  const recoveryTarget = getMacroRecoveryTarget({
    weightKg: athleteProfile.weight_kg,
    recoveryDebt,
  });

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
    });
    loggedNew = true;
  }

  return NextResponse.json({
    activity: {
      name: activity.name,
      activityDate: activity.activity_date,
      distanceKm: Math.round((activity.distance / 1000) * 10) / 10,
      elevationGainM: Math.round(elevationGainM),
      durationHours: Math.round(hours * 100) / 100,
      points,
      // The exact temperature this ride's fluid/sodium loss was computed
      // from (sampled at sync time via Open-Meteo along the route — see
      // "Geographic microclimate sampling" — or a fixed indoor placeholder
      // for a trainer ride) — surfaced so the telemetry card can cite it
      // rather than asking the athlete to trust an unexplained number.
      temperatureAvgC: activity.temperature_avg,
    },
    carbsBurnedG,
    fluidLossMl,
    sodiumLossMg,
    source,
    telemetry: {
      energyKcal,
      energySource,
      powerWatts,
      normalizedPowerWatts,
      powerSource,
      heartrateAvg,
    },
    weightKg: athleteProfile.weight_kg,
    recoveryTarget,
    loggedNew,
  });
}

import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { getWeatherForDeparture } from "@/lib/open-meteo";
import { logFuelingPlan } from "@/lib/fueling-logs";
import {
  estimateRideDurationHours,
  getBottlePlan,
  getCarbLoadingTarget,
  getFluidLossMlPerHour,
  getGutCappedCarbTarget,
  getHomeLabRecipe,
  getMoneySavedVsGels,
  getPersonalizedCarbOxidationRateGPerHour,
  getRelativeIntensity,
  getRelativeIntensityFromLevel,
  getSodiumLossMgPerHour,
  simulateGlycogenBattery,
  type IntensityLevel,
} from "@/lib/metabolic-engine";

// Above this ride duration, the pre-event carb-loading module shows
// automatically — below it, only if the athlete flags the ride as a
// target event/competition via the planner's optional switch.
const TARGET_EVENT_DURATION_THRESHOLD_HOURS = 3.5;

// Fallback climate for whenever there's no real forecast to sample (quick
// calculator mode with no route coordinates, or Open-Meteo came back empty)
// — a plausible "typical training day," not this specific ride's weather.
const PLANNING_TEMPERATURE_C = 22;
const PLANNING_HUMIDITY_PCT = 55;

const VALID_INTENSITIES = new Set<IntensityLevel>([
  "recovery",
  "endurance",
  "tempo",
  "threshold",
  "vo2max",
]);

export async function POST(request: NextRequest) {
  const supabase = await getAuthenticatedSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const { data: athleteProfile, error: athleteProfileError } = await supabase
    .from("athlete_profiles")
    .select("ftp, weight_kg, sweat_rate, gut_training_level, athlete_type")
    .eq("id", userId)
    .maybeSingle();
  if (athleteProfileError) throw athleteProfileError;
  if (!athleteProfile) {
    return NextResponse.json({ error: "no_profile" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || (body.mode !== "route" && body.mode !== "quick")) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const departureIso = typeof body.departureIso === "string" ? body.departureIso : null;
  const isTargetEvent = body.isTargetEvent === true;
  const athleteType = athleteProfile.athlete_type ?? "balanced";

  let durationHours: number;
  let relativeIntensity: number;
  let startLat: number | null = null;
  let startLng: number | null = null;
  let rideDistanceKm: number | null = null;

  if (body.mode === "route") {
    const { distanceKm, elevationGainM, intensity } = body;
    if (typeof distanceKm !== "number" || typeof elevationGainM !== "number") {
      return NextResponse.json({ error: "invalid_route" }, { status: 400 });
    }
    const intensityLevel: IntensityLevel = VALID_INTENSITIES.has(intensity)
      ? intensity
      : "endurance";
    durationHours = estimateRideDurationHours({
      distanceKm,
      elevationGainM,
      ftp: athleteProfile.ftp,
      weightKg: athleteProfile.weight_kg,
      intensity: intensityLevel,
    });
    relativeIntensity = getRelativeIntensityFromLevel(intensityLevel);
    startLat = typeof body.startLat === "number" ? body.startLat : null;
    startLng = typeof body.startLng === "number" ? body.startLng : null;
    rideDistanceKm = distanceKm;
  } else {
    const { durationHours: hours, averageWatts } = body;
    if (
      typeof hours !== "number" ||
      hours <= 0 ||
      typeof averageWatts !== "number" ||
      averageWatts <= 0
    ) {
      return NextResponse.json({ error: "invalid_quick" }, { status: 400 });
    }
    durationHours = hours;
    relativeIntensity = getRelativeIntensity(averageWatts, athleteProfile.ftp);
  }

  let temperatureC = PLANNING_TEMPERATURE_C;
  let humidityPct = PLANNING_HUMIDITY_PCT;
  let weatherSource: "dynamic" | "planning_default" = "planning_default";

  if (startLat != null && startLng != null && departureIso) {
    const weather = await getWeatherForDeparture(startLat, startLng, departureIso, durationHours);
    if (weather) {
      temperatureC = weather.temperatureAvgC;
      humidityPct = weather.humidityAvg;
      weatherSource = "dynamic";
    }
  }

  const gutTarget = getGutCappedCarbTarget(
    relativeIntensity,
    athleteProfile.gut_training_level,
    athleteType
  );
  const carbsGPerHour = gutTarget.recommendedGPerHour;
  const fluidLossMlPerHour = getFluidLossMlPerHour(
    athleteProfile.sweat_rate,
    temperatureC,
    humidityPct
  );
  const sodiumMgPerHour = getSodiumLossMgPerHour(fluidLossMlPerHour);
  const recipe = getHomeLabRecipe({
    carbsGPerHour,
    sodiumMgPerHour,
    fluidLossMlPerHour,
    durationHours,
  });
  const moneySaved = getMoneySavedVsGels(recipe.totalCarbsG);
  const bottlePlan = getBottlePlan(recipe);

  // The battery drains at the ride's *true* metabolic demand (uncapped,
  // phenotype-adjusted) regardless of what the gut can absorb — the gut cap
  // limits the recommended intake, not the body's actual burn rate.
  const trueBurnRateGPerHour = getPersonalizedCarbOxidationRateGPerHour(relativeIntensity, athleteType);
  const glycogenBattery = simulateGlycogenBattery({
    weightKg: athleteProfile.weight_kg,
    burnRateGPerHour: trueBurnRateGPerHour,
    intakeGPerHour: carbsGPerHour,
    durationHours,
    distanceKm: rideDistanceKm,
  });

  const isLongOrTargetRide = durationHours > TARGET_EVENT_DURATION_THRESHOLD_HOURS || isTargetEvent;
  const carbLoading = isLongOrTargetRide ? getCarbLoadingTarget(athleteProfile.weight_kg) : null;

  await logFuelingPlan(supabase, {
    profileId: userId,
    kind: "pre_ride",
    totalCarbsG: recipe.totalCarbsG,
    fluidMl: recipe.waterMl,
    sodiumMg: recipe.sodiumMg,
    moneySaved,
  });

  return NextResponse.json({
    durationHours: Math.round(durationHours * 100) / 100,
    carbsGPerHour,
    sodiumMgPerHour,
    fluidLossMlPerHour,
    recipe,
    moneySaved,
    weather: {
      temperatureC: Math.round(temperatureC * 10) / 10,
      humidityPct: Math.round(humidityPct * 10) / 10,
      source: weatherSource,
    },
    gutTraining: {
      isGutLimited: gutTarget.isGutLimited,
      gutCapGPerHour: gutTarget.gutCapGPerHour,
      uncappedGPerHour: gutTarget.uncappedGPerHour,
    },
    bottlePlan,
    glycogenBattery,
    carbLoading,
  });
}

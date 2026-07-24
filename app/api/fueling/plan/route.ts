import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { getWeatherForDeparture } from "@/lib/open-meteo";
import { logFuelingPlan } from "@/lib/fueling-logs";
import {
  estimateRideDurationHours,
  getFluidLossMlPerHour,
  getGutCappedCarbTarget,
  getHomeLabRecipe,
  getMoneySavedVsGels,
  getRelativeIntensity,
  getRelativeIntensityFromLevel,
  getSodiumLossMgPerHour,
  type IntensityLevel,
} from "@/lib/metabolic-engine";

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
    .select("ftp, weight_kg, sweat_rate, gut_training_level")
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

  let durationHours: number;
  let relativeIntensity: number;
  let startLat: number | null = null;
  let startLng: number | null = null;

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

  const gutTarget = getGutCappedCarbTarget(relativeIntensity, athleteProfile.gut_training_level);
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
  });
}

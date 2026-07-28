import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { getWeatherForDeparture, getWeatherForRoute } from "@/lib/open-meteo";
import { fetchRoutePeakPoint } from "@/lib/strava-routes";
import { getValidStravaAccessToken } from "@/lib/strava-session";
import { logFuelingPlan } from "@/lib/fueling-logs";
import {
  estimateRideDurationHours,
  generateTimingTimeline,
  getBottlePlan,
  getCarbLoadingTarget,
  getFluidLossMlPerHour,
  getGutCappedCarbTarget,
  getHomeLabRecipe,
  getHybridGelSuggestion,
  getLapseRateAdjustedTemperature,
  getOptimalPocketFoodSelection,
  getPersonalizedCarbOxidationRateGPerHour,
  getPocketFoodMilestones,
  getPocketFoodTotalCarbsG,
  getReloadStrategy,
  getRelativeIntensity,
  getRelativeIntensityFromLevel,
  getSodiumLossMgPerHour,
  getThermalImpactNote,
  simulateGlycogenBattery,
  type FuelingMode,
  type IntensityLevel,
  type PocketFoodItemType,
  type PocketFoodSelection,
} from "@/lib/metabolic-engine";

const VALID_FUELING_MODES = new Set<FuelingMode>(["optimal", "inventory", "hybrid"]);

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

const VALID_POCKET_FOOD_TYPES = new Set<PocketFoodItemType>([
  "banana",
  "energy_bar",
  "rice_cake",
  "dates",
  "gel_small",
  "gel_standard",
  "gel_high",
]);

// A single free-text "custom food" entry could otherwise be abused to smuggle
// an absurd carb figure into the recipe — cap it at a generous but sane
// per-ride ceiling (a full day's carb-loading target, give or take).
const MAX_CUSTOM_CARBS_G = 500;

/** Only known item types with a positive integer quantity survive, plus a
 * capped `customCarbsG` — anything else in the request body is silently
 * dropped rather than rejected, same "degrade gracefully" convention as
 * `getStravaRoutes()` returning `[]`. */
function sanitizePocketFoodSelection(input: unknown): PocketFoodSelection {
  if (!input || typeof input !== "object") return {};
  const result: PocketFoodSelection = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key === "customCarbsG" && typeof value === "number" && value > 0) {
      result.customCarbsG = Math.min(MAX_CUSTOM_CARBS_G, Math.round(value));
      continue;
    }
    if (VALID_POCKET_FOOD_TYPES.has(key as PocketFoodItemType) && typeof value === "number" && value > 0) {
      result[key as PocketFoodItemType] = Math.round(value);
    }
  }
  return result;
}

export async function POST(request: NextRequest) {
  const supabase = await getAuthenticatedSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const { data: athleteProfile, error: athleteProfileError } = await supabase
    .from("athlete_profiles")
    .select(
      "ftp, weight_kg, sweat_rate, gut_training_level, athlete_type, bottle_count, bottle_capacity_ml, is_salty_sweater"
    )
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
  const fuelingMode: FuelingMode = VALID_FUELING_MODES.has(body.fuelingMode)
    ? body.fuelingMode
    : "inventory";
  // `optimal` mode overrides this with its own auto-selection once
  // `durationHours` is known below — `inventory`/`hybrid` both use the
  // athlete's real manual selection as-is (they only differ in what the UI
  // suggests on top of it, see `getHybridGelSuggestion` below).
  let pocketFood = sanitizePocketFoodSelection(body.pocketFood);
  let pocketFoodCarbsG = getPocketFoodTotalCarbsG(pocketFood);

  let durationHours: number;
  let relativeIntensity: number;
  let startLat: number | null = null;
  let startLng: number | null = null;
  let endLat: number | null = null;
  let endLng: number | null = null;
  let routeId: string | null = null;
  let rideDistanceKm: number | null = null;
  let rideElevationGainM: number | null = null;

  if (body.mode === "route") {
    const { distanceKm, elevationGainM, intensity, durationHoursOverride } = body;
    if (typeof distanceKm !== "number" || typeof elevationGainM !== "number") {
      return NextResponse.json({ error: "invalid_route" }, { status: 400 });
    }
    const intensityLevel: IntensityLevel = VALID_INTENSITIES.has(intensity)
      ? intensity
      : "endurance";
    // The GPX Híbrido uploader estimates duration from the athlete's own
    // historical Strava pace (distance / avg speed) rather than this FTP/
    // W-per-kg heuristic, and lets the athlete edit that estimate directly —
    // when supplied, it always wins over the computed figure.
    durationHours =
      typeof durationHoursOverride === "number" && durationHoursOverride > 0
        ? durationHoursOverride
        : estimateRideDurationHours({
            distanceKm,
            elevationGainM,
            ftp: athleteProfile.ftp,
            weightKg: athleteProfile.weight_kg,
            intensity: intensityLevel,
          });
    relativeIntensity = getRelativeIntensityFromLevel(intensityLevel);
    startLat = typeof body.startLat === "number" ? body.startLat : null;
    startLng = typeof body.startLng === "number" ? body.startLng : null;
    endLat = typeof body.endLat === "number" ? body.endLat : null;
    endLng = typeof body.endLng === "number" ? body.endLng : null;
    routeId = typeof body.routeId === "string" ? body.routeId : null;
    rideDistanceKm = distanceKm;
    rideElevationGainM = elevationGainM;
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

  // "Modo Óptimo" replaces whatever the athlete may have manually selected
  // (the client already disables that selector when this mode is active,
  // but the server never trusts client-computed food choices either way)
  // with a duration-scaled auto-selection now that `durationHours` is known.
  if (fuelingMode === "optimal") {
    pocketFood = getOptimalPocketFoodSelection(durationHours);
    pocketFoodCarbsG = getPocketFoodTotalCarbsG(pocketFood);
  }

  let temperatureC = PLANNING_TEMPERATURE_C;
  let humidityPct = PLANNING_HUMIDITY_PCT;
  let temperatureMaxC: number | null = null;
  let windSpeedKmh = 0;
  let weatherSource: "dynamic" | "planning_default" = "planning_default";
  // True only once a real 3-point sample (start/summit/finish) succeeds —
  // that's a genuine altitude-based reading at the actual high point, which
  // makes the elevation-gain lapse-rate *approximation* below redundant.
  let sampledAtRealAltitude = false;
  // How far along the ride (0-1) its real elevation peak sits — feeds the
  // caffeine milestone in `generateTimingTimeline` below. Only set when a
  // real peak point was found (Strava route streams, or a client-supplied
  // GPX peak), never for the elevation-gain lapse-rate approximation.
  let peakFractionForTimeline: number | null = null;

  // A GPX Híbrido upload already found its own elevation peak client-side
  // (it has per-point altitude, unlike a Strava route's summary polyline) and
  // sends it directly — preferred over a Strava streams call when present,
  // and the only option at all for a route with no Strava `routeId`.
  const clientPeakLat = typeof body.peakLat === "number" ? body.peakLat : null;
  const clientPeakLng = typeof body.peakLng === "number" ? body.peakLng : null;
  const clientPeakFraction =
    typeof body.peakDistanceFraction === "number" ? body.peakDistanceFraction : null;

  if (startLat != null && startLng != null && departureIso) {
    if (endLat != null && endLng != null) {
      let peak: { lat: number; lng: number; distanceFraction: number } | null =
        clientPeakLat != null && clientPeakLng != null && clientPeakFraction != null
          ? { lat: clientPeakLat, lng: clientPeakLng, distanceFraction: clientPeakFraction }
          : null;
      if (!peak && routeId) {
        const accessToken = await getValidStravaAccessToken(supabase, userId);
        peak = accessToken ? await fetchRoutePeakPoint(accessToken, routeId) : null;
      }
      if (peak) {
        const start = new Date(departureIso);
        const durationMs = durationHours * 60 * 60 * 1000;
        const weather = await getWeatherForRoute([
          { lat: startLat, lng: startLng, atDate: start },
          {
            lat: peak.lat,
            lng: peak.lng,
            atDate: new Date(start.getTime() + durationMs * peak.distanceFraction),
          },
          { lat: endLat, lng: endLng, atDate: new Date(start.getTime() + durationMs) },
        ]);
        if (weather) {
          temperatureC = weather.temperatureAvgC;
          temperatureMaxC = weather.temperatureMaxC;
          humidityPct = weather.humidityAvg;
          windSpeedKmh = weather.windSpeedKmhAvg;
          weatherSource = "dynamic";
          sampledAtRealAltitude = true;
          peakFractionForTimeline = peak.distanceFraction;
        }
      }
    }

    if (!sampledAtRealAltitude) {
      const weather = await getWeatherForDeparture(startLat, startLng, departureIso, durationHours);
      if (weather) {
        temperatureC = weather.temperatureAvgC;
        humidityPct = weather.humidityAvg;
        windSpeedKmh = weather.windSpeedKmhAvg;
        weatherSource = "dynamic";
      }
    }
  }

  // Only a single start-coordinate sample silently assumes the whole route
  // sits at that altitude, overestimating temperature (and sweat/sodium
  // loss) on a route that climbs into the mountains — correct for that
  // using the route's own elevation gain as a proxy for how high it climbs.
  // Skipped when the 3-point sample above already measured the real
  // summit's temperature directly.
  let lapseRateAdjustmentC = 0;
  if (!sampledAtRealAltitude && rideElevationGainM != null) {
    const adjustedTemperatureC = getLapseRateAdjustedTemperature(temperatureC, rideElevationGainM);
    lapseRateAdjustmentC = Math.round((adjustedTemperatureC - temperatureC) * 10) / 10;
    temperatureC = adjustedTemperatureC;
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
  const sodiumMgPerHour = getSodiumLossMgPerHour(
    fluidLossMlPerHour,
    athleteProfile.is_salty_sweater ?? false
  );
  const totalRideCarbsG = Math.round(carbsGPerHour * durationHours);
  const recipe = getHomeLabRecipe({
    carbsGPerHour,
    sodiumMgPerHour,
    fluidLossMlPerHour,
    durationHours,
    pocketFoodCarbsG,
  });
  const bottlePlan = getBottlePlan(recipe, athleteProfile.bottle_capacity_ml);
  const reloadStrategy = getReloadStrategy({
    bottlePlan,
    durationHours,
    distanceKm: rideDistanceKm,
    maxBottlesOnBike: athleteProfile.bottle_count,
  });
  const nutritionMilestones = getPocketFoodMilestones({
    selection: pocketFood,
    durationHours,
    distanceKm: rideDistanceKm,
  });
  const timingTimeline = generateTimingTimeline({
    selection: pocketFood,
    durationHours,
    distanceKm: rideDistanceKm,
    fluidLossMlPerHour,
    peakFraction: peakFractionForTimeline,
  });
  const thermalImpactNote = getThermalImpactNote(temperatureC, humidityPct);

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

  // "Modo Híbrido" — purely advisory: how many standard gels would close
  // the gap left after the athlete's own fixed staple selection, alongside
  // (never instead of) the bottle recipe above, which already covers that
  // same real gap regardless of this suggestion.
  const hybridGelSuggestion =
    fuelingMode === "hybrid"
      ? getHybridGelSuggestion(Math.max(0, totalRideCarbsG - pocketFoodCarbsG))
      : null;

  await logFuelingPlan(supabase, {
    profileId: userId,
    kind: "pre_ride",
    totalCarbsG: recipe.totalCarbsG,
    fluidMl: recipe.waterMl,
    sodiumMg: recipe.sodiumMg,
  });

  return NextResponse.json({
    durationHours: Math.round(durationHours * 100) / 100,
    carbsGPerHour,
    sodiumMgPerHour,
    fluidLossMlPerHour,
    recipe,
    totalRideCarbsG,
    pocketFood,
    pocketFoodCarbsG,
    fuelingMode,
    hybridGelSuggestion,
    weather: {
      temperatureC: Math.round(temperatureC * 10) / 10,
      temperatureMaxC: temperatureMaxC != null ? Math.round(temperatureMaxC * 10) / 10 : null,
      humidityPct: Math.round(humidityPct * 10) / 10,
      windSpeedKmh: Math.round(windSpeedKmh * 10) / 10,
      source: weatherSource,
      multiPointSample: sampledAtRealAltitude,
      lapseRateAdjustmentC,
      thermalImpactNote,
    },
    gutTraining: {
      isGutLimited: gutTarget.isGutLimited,
      gutCapGPerHour: gutTarget.gutCapGPerHour,
      uncappedGPerHour: gutTarget.uncappedGPerHour,
    },
    bottlePlan,
    reloadStrategy,
    nutritionMilestones,
    timingTimeline,
    glycogenBattery,
    carbLoading,
  });
}

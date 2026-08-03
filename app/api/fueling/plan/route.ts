import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import {
  getSeasonalAverageWeather,
  getWeatherForDeparture,
  getWeatherForRoute,
  isBeyondForecastRange,
  type PointSample,
} from "@/lib/open-meteo";
import { fetchRouteElevationExtremes } from "@/lib/strava-routes";
import { getValidStravaAccessToken } from "@/lib/strava-session";
import { logFuelingPlan } from "@/lib/fueling-logs";
import { getPeakName } from "@/lib/overpass";
import {
  type ElevationMilestone,
  type ElevationProfilePoint,
} from "@/lib/utils/elevation-parser";
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
  getNetCarbDeficit,
  getOptimalPocketFoodSelection,
  getPersonalizedCarbOxidationRateGPerHour,
  getPocketFoodMilestones,
  getPocketFoodTotalCarbsG,
  getReloadStrategy,
  getRelativeIntensityFromLevel,
  getSodiumLossMgPerHour,
  getThermalAdaptation,
  getTrainLowCarbTargetGPerHour,
  isPastCaffeineCurfew,
  type FuelingMode,
  type IntensityLevel,
  type MountainPass,
  type PocketFoodItemType,
  type PocketFoodSelection,
} from "@/lib/metabolic-engine";

const VALID_FUELING_MODES = new Set<FuelingMode>(["optimal", "inventory", "hybrid"]);

// Above this ride duration, the pre-event carb-loading module shows
// automatically — below it, only if the athlete flags the ride as a
// target event/competition via the planner's optional switch. Lowered from
// 3.5h to 2.5h — a genuinely demanding ride's glycogen stakes start well
// before the old, more conservative cutoff.
const TARGET_EVENT_DURATION_THRESHOLD_HOURS = 2.5;

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
  "competition",
]);

const VALID_POCKET_FOOD_TYPES = new Set<PocketFoodItemType>([
  "soda",
  "pastry",
  "banana",
  "milk_bread",
  "energy_bar",
  "rice_cake",
  "dates",
  "gummies",
  "gel_small",
  "gel_standard",
  "gel_high",
  "gel_ultra",
]);

// "Calibrador Rápido" — the target power everywhere in this app is derived
// from the athlete's own FTP, never a real potenciómetro reading (Strava's
// own route-planning tools have no such measurement to give either), so a
// rider expecting a draft/tailwind-assisted effort can nudge the target a
// fixed ±10% rather than picking a whole different intensity zone.
const VALID_INTENSITY_CALIBRATION_PCT = new Set([-10, 0, 10]);

/** Client-supplied mountain-pass list (GPX Híbrido, computed locally via
 * `detectMountainPasses` — see `lib/gpx-import.ts`) — sanitized the same
 * "drop anything malformed, never reject the whole request" way every other
 * client-supplied array in this route is handled. */
function sanitizeMountainPasses(input: unknown): MountainPass[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (p): p is { distanceFraction: number; elevationM: number; gainM?: number } =>
        p &&
        typeof p === "object" &&
        typeof p.distanceFraction === "number" &&
        typeof p.elevationM === "number"
    )
    .map((p) => ({
      distanceFraction: Math.max(0, Math.min(1, p.distanceFraction)),
      elevationM: p.elevationM,
      gainM: typeof p.gainM === "number" ? p.gainM : 0,
    }));
}

const VALID_ELEVATION_MILESTONE_TYPES = new Set(["start", "peak", "valley", "end"]);

/** Client-supplied elevation-milestone list (GPX Híbrido, computed locally
 * via `detectElevationMilestones` — see `lib/gpx-import.ts`) — sanitized the
 * same "drop anything malformed, never reject the whole request" way every
 * other client-supplied array in this route is handled. */
function sanitizeElevationMilestones(input: unknown): ElevationMilestone[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (m): m is ElevationMilestone =>
        m &&
        typeof m === "object" &&
        VALID_ELEVATION_MILESTONE_TYPES.has(m.type) &&
        typeof m.lat === "number" &&
        typeof m.lng === "number" &&
        typeof m.distanceFraction === "number" &&
        typeof m.distanceKm === "number" &&
        typeof m.elevationM === "number"
    )
    .map((m) => ({
      type: m.type,
      lat: m.lat,
      lng: m.lng,
      distanceFraction: Math.max(0, Math.min(1, m.distanceFraction)),
      distanceKm: m.distanceKm,
      elevationM: m.elevationM,
    }));
}

/** Client-supplied elevation profile (GPX Híbrido, already computed locally
 * — see `ParsedGpxRoute.elevationProfile` in `lib/gpx-import.ts`), sanitized
 * the same way. Feeds Card 03's altitude-profile SVG on the client. */
function sanitizeElevationProfile(input: unknown): ElevationProfilePoint[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (p): p is ElevationProfilePoint =>
        p && typeof p === "object" && typeof p.distanceFraction === "number" && typeof p.elevationM === "number"
    )
    .map((p) => ({
      distanceFraction: Math.max(0, Math.min(1, p.distanceFraction)),
      elevationM: p.elevationM,
    }));
}

// A single free-text "custom food" entry could otherwise be abused to smuggle
// an absurd carb figure into the recipe — cap it at a generous but sane
// per-ride ceiling (a full day's carb-loading target, give or take).
const MAX_CUSTOM_CARBS_G = 500;

/** Only known item types with a positive integer quantity survive, plus a
 * capped `customCarbsG` and a boolean `includeCaffeine` — anything else in
 * the request body is silently dropped rather than rejected, same
 * "degrade gracefully" convention as `getStravaRoutes()` returning `[]`. */
function sanitizePocketFoodSelection(input: unknown): PocketFoodSelection {
  if (!input || typeof input !== "object") return {};
  const result: PocketFoodSelection = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key === "customCarbsG" && typeof value === "number" && value > 0) {
      result.customCarbsG = Math.min(MAX_CUSTOM_CARBS_G, Math.round(value));
      continue;
    }
    if (key === "includeCaffeine" && typeof value === "boolean") {
      result.includeCaffeine = value;
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
  // "Entrenamientos en Ayunas / Z2 Low Carb (Train Low)" — overrides the
  // usual intensity-driven carb target with a fixed low-carb floor (see
  // `getTrainLowCarbTargetGPerHour`), applied further below once the
  // ride's normal gut-capped target has already been computed.
  const trainLow = body.trainLow === true;
  // "Calibrador Rápido de Vatios Estimados" — every target watts figure in
  // this planner is FTP-derived, not read from a real potenciómetro, so a
  // ±10% nudge lets the athlete correct for a drafted/tailwind-assisted (or
  // headwind-slowed) effort without picking a different intensity zone.
  const intensityCalibrationPct = VALID_INTENSITY_CALIBRATION_PCT.has(body.intensityCalibrationPct)
    ? body.intensityCalibrationPct
    : 0;
  const intensityCalibrationMultiplier = 1 + intensityCalibrationPct / 100;
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
    relativeIntensity = getRelativeIntensityFromLevel(intensityLevel) * intensityCalibrationMultiplier;
    startLat = typeof body.startLat === "number" ? body.startLat : null;
    startLng = typeof body.startLng === "number" ? body.startLng : null;
    endLat = typeof body.endLat === "number" ? body.endLat : null;
    endLng = typeof body.endLng === "number" ? body.endLng : null;
    routeId = typeof body.routeId === "string" ? body.routeId : null;
    rideDistanceKm = distanceKm;
    rideElevationGainM = elevationGainM;
  } else {
    // "Vatios Objetivo" was removed from Entreno Manual entirely — a real
    // average-watts figure doesn't exist for a ride that hasn't happened
    // yet, and asking the athlete to guess one was redundant once the same
    // Intensidad Objetivo selector every other mode already uses covers the
    // same input. Relative intensity is now derived purely from the chosen
    // zone's %FTP (`getRelativeIntensityFromLevel`, the exact same formula
    // `estimateRideDurationHours` already uses to size a route-mode ride),
    // multiplied against the athlete's real profile FTP — an intensity
    // selection is mandatory here now, unlike the old optional
    // `structuredIntensity` override on top of a watts-derived fallback.
    const { durationHours: hours, intensity } = body;
    const intensityLevel: IntensityLevel | null = VALID_INTENSITIES.has(intensity) ? intensity : null;
    if (typeof hours !== "number" || hours <= 0 || !intensityLevel) {
      return NextResponse.json({ error: "invalid_quick" }, { status: 400 });
    }
    durationHours = hours;
    relativeIntensity = getRelativeIntensityFromLevel(intensityLevel) * intensityCalibrationMultiplier;
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
  let weatherSource: "dynamic" | "planning_default" | "seasonal_average" = "planning_default";
  // True only once a real multi-point sample (valley/summit/finish) succeeds
  // — that's a genuine altitude-based reading at the actual high/low points,
  // which makes the elevation-gain lapse-rate *approximation* below
  // redundant.
  let sampledAtRealAltitude = false;
  // How far along the ride (0-1) its real elevation peak sits — feeds the
  // caffeine milestone in `generateTimingTimeline` below. Only set when a
  // real peak point was found (Strava route streams, or a client-supplied
  // GPX peak), never for the elevation-gain lapse-rate approximation.
  let peakFractionForTimeline: number | null = null;
  // The route's own real high/low points (m above sea level), when known —
  // feed both the altitude-differentiated weather threshold below (ΔH =
  // peak - trough, the actual elevation *range* the route covers, not just
  // its cumulative D+) and each altitude card's "(Xm)" label. `null`
  // whenever no real elevation profile was resolved at all (no route/GPX
  // peak+trough data, or the Strava streams call failed).
  let peakElevationM: number | null = null;
  let troughElevationM: number | null = null;
  // The real per-point readings behind the 4-point sample below (start,
  // trough/valley, peak/summit, finish, in that order) — kept separately
  // from the blended `temperatureC`/`humidityPct`/`windSpeedKmh` averages so
  // the "Valle / Salida" and "Cima del Puerto" cards below can each show
  // their own real reading rather than a value diluted by every other
  // sampled point.
  let routeSamplePoints: (PointSample | null)[] | null = null;
  // "Rutas Multipuerto de Alta Montaña" — starts from whatever the client
  // already computed locally (a GPX Híbrido upload, which has no Strava
  // `routeId` to fetch streams for) and gets overwritten below by the real
  // Strava streams call whenever a saved route's own elevation profile is
  // fetched instead.
  let mountainPasses: MountainPass[] = sanitizeMountainPasses(body.mountainPasses);
  // "Algoritmo de Detección de Puertos/Valles" — same source precedence as
  // `mountainPasses` above: a GPX upload's own client-computed Salida/Valle/
  // Cima/Llegada list wins until a real Strava streams call (below)
  // overwrites it with the route's actual elevation profile.
  let elevationMilestones: ElevationMilestone[] = sanitizeElevationMilestones(body.elevationMilestones);
  let elevationProfile: ElevationProfilePoint[] = sanitizeElevationProfile(body.elevationProfile);
  // Real per-milestone weather (Temp/Viento/Humedad), one entry per detected
  // hito, in route order — `[]` on a flat/short route with no genuine
  // pass/valley to report, or on any weather-sampling failure.
  let weatherPoints: {
    key: string;
    locationName: string;
    elevationM: number;
    distanceKm: number;
    distanceFraction: number;
    temperatureC: number;
    humidityPct: number;
    windSpeedKmh: number;
  }[] = [];

  // A GPX Híbrido upload already found its own elevation extremes
  // client-side (it has per-point altitude, unlike a Strava route's summary
  // polyline) and sends them directly — preferred over a Strava streams call
  // when present, and the only option at all for a route with no Strava
  // `routeId`.
  const clientPeakLat = typeof body.peakLat === "number" ? body.peakLat : null;
  const clientPeakLng = typeof body.peakLng === "number" ? body.peakLng : null;
  const clientPeakFraction =
    typeof body.peakDistanceFraction === "number" ? body.peakDistanceFraction : null;
  const clientPeakElevationM = typeof body.peakElevationM === "number" ? body.peakElevationM : null;
  const clientTroughLat = typeof body.troughLat === "number" ? body.troughLat : null;
  const clientTroughLng = typeof body.troughLng === "number" ? body.troughLng : null;
  const clientTroughFraction =
    typeof body.troughDistanceFraction === "number" ? body.troughDistanceFraction : null;
  const clientTroughElevationM =
    typeof body.troughElevationM === "number" ? body.troughElevationM : null;

  if (startLat != null && startLng != null && departureIso) {
    // A departure planned further out than Open-Meteo's forecast horizon has
    // no real forecast to query yet — skip the point-by-point forecast
    // sampling entirely (it would just fail per-point) and fall back to a
    // seasonal historical average for the route's start coordinates instead.
    if (isBeyondForecastRange(departureIso)) {
      const weather = await getSeasonalAverageWeather(startLat, startLng, new Date(departureIso));
      if (weather) {
        temperatureC = weather.temperatureAvgC;
        humidityPct = weather.humidityAvg;
        windSpeedKmh = weather.windSpeedKmhAvg;
        weatherSource = "seasonal_average";
      }
    } else {
      if (endLat != null && endLng != null) {
        type RoutePoint = { lat: number; lng: number; distanceFraction: number; elevationM: number | null };
        let peak: RoutePoint | null =
          clientPeakLat != null && clientPeakLng != null && clientPeakFraction != null
            ? {
                lat: clientPeakLat,
                lng: clientPeakLng,
                distanceFraction: clientPeakFraction,
                elevationM: clientPeakElevationM,
              }
            : null;
        let trough: RoutePoint | null =
          clientTroughLat != null && clientTroughLng != null && clientTroughFraction != null
            ? {
                lat: clientTroughLat,
                lng: clientTroughLng,
                distanceFraction: clientTroughFraction,
                elevationM: clientTroughElevationM,
              }
            : null;
        if ((!peak || !trough) && routeId) {
          const accessToken = await getValidStravaAccessToken(supabase, userId);
          const extremes = accessToken ? await fetchRouteElevationExtremes(accessToken, routeId) : null;
          if (extremes) {
            peak ??= extremes.peak;
            trough ??= extremes.trough;
            // A real Strava route's own streams call is the only source for
            // this (a GPX upload already sent its own client-computed list
            // via `body.mountainPasses`, sanitized into `mountainPasses`
            // above) — mutually exclusive in practice, so this always wins
            // whenever it fires.
            mountainPasses = extremes.mountainPasses;
            elevationMilestones = extremes.elevationMilestones;
            elevationProfile = extremes.elevationProfile;
          }
        }
        if (peak && trough) {
          peakElevationM = peak.elevationM;
          troughElevationM = trough.elevationM;
          const start = new Date(departureIso);
          const durationMs = durationHours * 60 * 60 * 1000;
          const atFraction = (fraction: number) => new Date(start.getTime() + durationMs * fraction);
          // Order matters — every downstream read of `routeSamplePoints`
          // below assumes this exact [start, trough, peak, finish] layout.
          const weather = await getWeatherForRoute([
            { lat: startLat, lng: startLng, atDate: start },
            { lat: trough.lat, lng: trough.lng, atDate: atFraction(trough.distanceFraction) },
            { lat: peak.lat, lng: peak.lng, atDate: atFraction(peak.distanceFraction) },
            { lat: endLat, lng: endLng, atDate: new Date(start.getTime() + durationMs) },
          ]);
          if (weather) {
            // The ride-average that drives the fluid-loss estimate below
            // deliberately stays scoped to start/summit/finish (excluding
            // the valley point) — unchanged from before the valley sample
            // was added, since a brief dip through a hot valley shouldn't
            // resize the *whole* ride's sweat-rate estimate any more than a
            // brief summit stretch should (see the existing "average, not
            // max, drives fluid loss" convention). `temperatureMaxC`, by
            // contrast, *does* fold the valley sample in — it's exactly the
            // "hottest single sampled point" this figure already promises,
            // and skipping the valley here was the diagnosed bug (a route
            // that dips into a hot valley before climbing had its real
            // thermal peak silently ignored).
            const [startSample, troughSample, peakSample, finishSample] = weather.pointSamples;
            const avgSamples = [startSample, peakSample, finishSample].filter(
              (s): s is NonNullable<typeof s> => s != null
            );
            if (avgSamples.length > 0) {
              temperatureC = avgSamples.reduce((sum, s) => sum + s.temperatureC, 0) / avgSamples.length;
              humidityPct = avgSamples.reduce((sum, s) => sum + s.humidity, 0) / avgSamples.length;
              windSpeedKmh = avgSamples.reduce((sum, s) => sum + s.windSpeedKmh, 0) / avgSamples.length;
              temperatureMaxC = Math.max(
                ...[startSample, troughSample, peakSample, finishSample]
                  .filter((s): s is NonNullable<typeof s> => s != null)
                  .map((s) => s.temperatureC)
              );
              weatherSource = "dynamic";
              sampledAtRealAltitude = true;
              peakFractionForTimeline = peak.distanceFraction;
              routeSamplePoints = weather.pointSamples;
            }
          }
        }
      }

      // "Cronograma Térmico por Puertos/Valles" — real per-hito weather (not
      // just the single blended start/summit/finish/valley sample above),
      // one Open-Meteo lookup per detected milestone, in parallel. Feeds
      // Card 03's thermal-impact carousel with a genuinely granular
      // Salida/Valle/Cima/Llegada breakdown instead of one 2-point valley-
      // vs-peak comparison.
      if (elevationMilestones.length > 0) {
        const start = new Date(departureIso);
        const durationMs = durationHours * 60 * 60 * 1000;
        const milestoneWeather = await getWeatherForRoute(
          elevationMilestones.map((m) => ({
            lat: m.lat,
            lng: m.lng,
            atDate: new Date(start.getTime() + durationMs * m.distanceFraction),
          }))
        );
        if (milestoneWeather) {
          const named = await Promise.all(
            elevationMilestones.map(async (m, i) => {
              const sample = milestoneWeather.pointSamples[i];
              if (!sample) return null;
              const locationName =
                m.type === "peak"
                  ? await getPeakName(m.lat, m.lng, m.distanceKm, m.elevationM)
                  : m.type === "valley"
                    ? `Valle Km ${Math.round(m.distanceKm)}`
                    : m.type === "start"
                      ? "Salida"
                      : "Llegada";
              return {
                key: `${m.type}-${i}`,
                locationName,
                elevationM: m.elevationM,
                distanceKm: m.distanceKm,
                distanceFraction: m.distanceFraction,
                temperatureC: Math.round(sample.temperatureC * 10) / 10,
                humidityPct: Math.round(sample.humidity * 10) / 10,
                windSpeedKmh: Math.round(sample.windSpeedKmh * 10) / 10,
              };
            })
          );
          weatherPoints = named.filter((p): p is NonNullable<typeof p> => p != null);
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
  }

  // Snapshot of the base-level reading *before* the lapse-rate correction
  // below overwrites `temperatureC` in place — needed by the "Valle /
  // Salida" altitude card further down, whenever the multi-point sample
  // above didn't already give us a real, independent valley-vs-summit
  // breakdown.
  const preLapseTemperatureC = temperatureC;

  // Only a single start-coordinate sample silently assumes the whole route
  // sits at that altitude, overestimating temperature (and sweat/sodium
  // loss) on a route that climbs into the mountains — correct for that
  // using the route's own elevation gain as a proxy for how high it climbs.
  // Skipped when the multi-point sample above already measured the real
  // summit's temperature directly.
  let lapseRateAdjustmentC = 0;
  if (!sampledAtRealAltitude && rideElevationGainM != null) {
    const adjustedTemperatureC = getLapseRateAdjustedTemperature(temperatureC, rideElevationGainM);
    lapseRateAdjustmentC = Math.round((adjustedTemperatureC - temperatureC) * 10) / 10;
    temperatureC = adjustedTemperatureC;
  }

  // "Impacto Térmico Diferenciado por Altitud" — a route with a real climb
  // can have valley/base conditions meaningfully different from its actual
  // summit, which the single blended `temperatureC` above (still what drives
  // the fluid-loss calculation — a brief summit or valley stretch shouldn't
  // resize the *whole* ride's sweat-rate estimate) intentionally hides.
  // Surfaced here as an explicit valley-vs-peak comparison instead, whenever
  // the climb is significant enough to matter. `routeElevationRangeM` is the
  // real elevation *range* the route covers (cota máxima − cota mínima) when
  // both are known — not the same thing as `rideElevationGainM` (cumulative
  // D+, which sums every uphill segment and can overstate a rolling route or
  // understate a route that starts already near its own summit), falling
  // back to that D+ figure only when the route's real high/low points
  // weren't resolved at all.
  const ALTITUDE_ELEVATION_RANGE_THRESHOLD_M = 400;
  const ALTITUDE_PEAK_ELEVATION_THRESHOLD_M = 500;
  const routeElevationRangeM =
    peakElevationM != null && troughElevationM != null
      ? peakElevationM - troughElevationM
      : rideElevationGainM;
  const hasSignificantClimb =
    (routeElevationRangeM ?? 0) >= ALTITUDE_ELEVATION_RANGE_THRESHOLD_M ||
    (peakElevationM ?? 0) >= ALTITUDE_PEAK_ELEVATION_THRESHOLD_M;

  let altitudeWeather: {
    base: { temperatureC: number; humidityPct: number; windSpeedKmh: number; elevationM: number | null };
    peak: { temperatureC: number; humidityPct: number; windSpeedKmh: number; elevationM: number | null };
  } | null = null;

  if (hasSignificantClimb) {
    const round1 = (n: number) => Math.round(n * 10) / 10;
    // `routeSamplePoints` is always `[start, trough, peak, finish]`, in that
    // order — see the 4-point `getWeatherForRoute` call above.
    const troughSample = routeSamplePoints?.[1] ?? null;
    const peakSample = routeSamplePoints?.[2] ?? null;
    if (troughSample && peakSample) {
      // "Valle / Punto Más Cálido" — sampled directly at the route's own
      // lowest point (its real coordinates and estimated pass-through time),
      // not the start, so a route that descends into a valley before
      // climbing gets its actual thermal peak here instead of the
      // (typically cooler, higher) departure point's own reading.
      altitudeWeather = {
        base: {
          temperatureC: round1(troughSample.temperatureC),
          humidityPct: round1(troughSample.humidity),
          windSpeedKmh: round1(troughSample.windSpeedKmh),
          elevationM: troughElevationM,
        },
        peak: {
          temperatureC: round1(peakSample.temperatureC),
          humidityPct: round1(peakSample.humidity),
          windSpeedKmh: round1(peakSample.windSpeedKmh),
          elevationM: peakElevationM,
        },
      };
    } else if (routeElevationRangeM != null) {
      // No real per-point valley/summit reading (no route/GPX elevation
      // profile resolved, or its own weather request failed) — reuse the
      // same lapse-rate approximation already applied to `temperatureC`
      // above (`-0.65°C per 100m`, see `getLapseRateAdjustedTemperature`),
      // applied across the real elevation range when known (falls back to
      // `getLapseRateAdjustedTemperature`'s own `rideElevationGainM`
      // parameter otherwise), surfaced as its own explicit peak figure
      // rather than only folded into the single blended `temperatureC`.
      // Lapse rate only corrects temperature — humidity/wind are shared
      // between both cards here.
      const peakTemperatureC = getLapseRateAdjustedTemperature(preLapseTemperatureC, routeElevationRangeM);
      altitudeWeather = {
        base: {
          temperatureC: round1(preLapseTemperatureC),
          humidityPct: round1(humidityPct),
          windSpeedKmh: round1(windSpeedKmh),
          elevationM: troughElevationM,
        },
        peak: {
          temperatureC: round1(peakTemperatureC),
          humidityPct: round1(humidityPct),
          windSpeedKmh: round1(windSpeedKmh),
          elevationM: peakElevationM,
        },
      };
    }
  }

  // "Adaptación Térmica Extrema" — cold below 8°C, heat above 32°C, checked
  // against the final (lapse-rate/altitude-adjusted) temperature so a
  // mountain summit's own real cold reading counts, not just the valley
  // start.
  const thermalAdaptation = getThermalAdaptation(temperatureC);

  const gutTarget = getGutCappedCarbTarget(
    relativeIntensity,
    athleteProfile.gut_training_level,
    athleteType
  );
  // "Modo Eficiencia Metabólica (Train Low)" — overrides the ride's normal
  // gut-capped target with a fixed low-carb floor once the athlete opts in;
  // hydration/sodium below are completely unaffected.
  const carbsGPerHour = trainLow ? getTrainLowCarbTargetGPerHour() : gutTarget.recommendedGPerHour;
  const fluidLossMlPerHour = getFluidLossMlPerHour(
    athleteProfile.sweat_rate,
    temperatureC,
    humidityPct
  );
  const sodiumMgPerHour = getSodiumLossMgPerHour(
    fluidLossMlPerHour,
    athleteProfile.is_salty_sweater ?? false,
    thermalAdaptation.isExtremeHeat
  );
  const totalRideCarbsG = Math.round(carbsGPerHour * durationHours);
  const recipe = getHomeLabRecipe({
    carbsGPerHour,
    sodiumMgPerHour,
    fluidLossMlPerHour,
    durationHours,
    pocketFoodCarbsG,
    forceHighCarbRatio: isTargetEvent,
  });
  const bottlePlan = getBottlePlan(recipe, athleteProfile.bottle_capacity_ml, {
    coldWeatherReduction: thermalAdaptation.isExtremeCold,
    minWaterBottles: thermalAdaptation.isExtremeHeat ? 1 : 0,
  });
  const reloadStrategy = getReloadStrategy({
    bottlePlan,
    durationHours,
    distanceKm: rideDistanceKm,
    fluidLossMlPerHour,
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
    bottleCapacityMl: athleteProfile.bottle_capacity_ml,
    mountainPasses,
  });
  // "Sensibilidad a Cafeína e Horario Nocturno" — an arrival at/after 18:30
  // local drops every caffeine milestone the timeline above just scheduled,
  // regardless of pocket food or route profile, to protect the athlete's
  // night's sleep.
  const arrivalDate = departureIso ? new Date(new Date(departureIso).getTime() + durationHours * 3_600_000) : null;
  const caffeineSuppressed =
    arrivalDate != null &&
    isPastCaffeineCurfew(arrivalDate) &&
    timingTimeline.entries.some((entry) => entry.type === "caffeine");
  if (caffeineSuppressed) {
    timingTimeline.entries = timingTimeline.entries.filter((entry) => entry.type !== "caffeine");
  }
  // The real deficit is measured against the ride's *true* metabolic demand
  // (uncapped, phenotype-adjusted) regardless of what the gut can absorb —
  // the gut cap limits the recommended intake, not the body's actual burn
  // rate.
  const trueBurnRateGPerHour = getPersonalizedCarbOxidationRateGPerHour(relativeIntensity, athleteType);
  const netCarbDeficit = getNetCarbDeficit({
    burnRateGPerHour: trueBurnRateGPerHour,
    intakeGPerHour: carbsGPerHour,
    durationHours,
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
      // "Impacto Térmico Diferenciado por Altitud" — only present on a route
      // with a significant climb (D+ ≥ 400m or a known summit ≥ 500m), see
      // `hasSignificantClimb` above. `null` for a flat route/Entreno Manual,
      // in which case the single blended reading above is the whole story.
      altitude: altitudeWeather,
      // "Cronograma Térmico por Puertos/Valles" — real Salida/Valle/Cima/
      // Llegada milestones with their own weather + (for a peak) an
      // Overpass-resolved name. `[]` on a flat/short route with nothing to
      // detect — Card 03 falls back to the single blended reading above.
      weatherPoints,
      // Thinned elevation curve for the same carousel's altitude-profile
      // SVG — `[]` when no real per-point profile was ever resolved (Entreno
      // Manual, or a route/GPX with no usable altitude stream).
      elevationProfile,
    },
    gutTraining: {
      isGutLimited: gutTarget.isGutLimited,
      gutCapGPerHour: gutTarget.gutCapGPerHour,
      uncappedGPerHour: gutTarget.uncappedGPerHour,
    },
    bottlePlan,
    // The athlete's real cage count (1 or 2) — the client's "Ambos Mix"
    // bottle-config preference needs this to credit the right number of
    // bottles instead of assuming a hardcoded 2 (see
    // `getBottleCarbsContributionG` in `components/fueling-planner.tsx`).
    athleteBottleCount: athleteProfile.bottle_count,
    reloadStrategy,
    nutritionMilestones,
    timingTimeline,
    netCarbDeficit,
    carbLoading,
    trainLow,
    thermalAdaptation,
    caffeineSuppressed,
    mountainPassesDetected: mountainPasses.length,
  });
}

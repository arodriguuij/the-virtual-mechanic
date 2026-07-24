/**
 * Heuristic formulas turning an athlete's physiological profile (FTP,
 * weight, sweat rate) plus ride intensity and ambient weather into a
 * fueling plan — simple, documented rules of thumb grounded in mainstream
 * sports-nutrition guidance (carb oxidation ceilings, sweat sodium
 * concentration ranges), not a clinical or individually-calibrated model.
 * Tune the constants below once there's real sweat-test/metabolic-cart data
 * to calibrate against. All pure, no I/O — safe to import from both server
 * and client components.
 */

export type SweatRate = "low" | "medium" | "high";

export type IntensityLevel = "recovery" | "endurance" | "tempo" | "threshold" | "vo2max";

export const intensityLabels: Record<IntensityLevel, string> = {
  recovery: "Recuperación",
  endurance: "Fondo",
  tempo: "Tempo",
  threshold: "Umbral",
  vo2max: "VO2 Max",
};

/** Assumed %FTP for each named intensity — used by the pre-ride planner,
 * which doesn't have real power data yet. */
const INTENSITY_RELATIVE_FTP: Record<IntensityLevel, number> = {
  recovery: 0.55,
  endurance: 0.7,
  tempo: 0.85,
  threshold: 0.98,
  vo2max: 1.15,
};

export function getRelativeIntensityFromLevel(level: IntensityLevel): number {
  return INTENSITY_RELATIVE_FTP[level];
}

export function getRelativeIntensity(averageWatts: number, ftp: number): number {
  if (ftp <= 0) return 0;
  return averageWatts / ftp;
}

/**
 * Estimated ride moving time from distance + elevation + the rider's own
 * FTP-derived target power — a simplified two-term heuristic, not a full
 * physical simulation of aerodynamic drag, rolling resistance, or gradient:
 * a flat-road speed estimated from W/kg, plus a Naismith's-rule-style
 * climbing time bonus from an estimated VAM (vertical meters/hour), both
 * scaling with the same W/kg figure. Used to size the fueling window for a
 * saved Strava route, which has no real moving-time data of its own yet.
 */
export function estimateRideDurationHours({
  distanceKm,
  elevationGainM,
  ftp,
  weightKg,
  intensity = "endurance",
}: {
  distanceKm: number;
  elevationGainM: number;
  ftp: number;
  weightKg: number;
  intensity?: IntensityLevel;
}): number {
  const targetWatts = ftp * getRelativeIntensityFromLevel(intensity);
  const wPerKg = weightKg > 0 ? targetWatts / weightKg : 0;

  // ~22km/h flat at 2.5 W/kg, +5km/h per extra W/kg, clamped to a plausible
  // range for a road ride.
  const flatSpeedKmh = Math.min(45, Math.max(15, 22 + (wPerKg - 2.5) * 5));
  // ~700 vertical meters/hour at 2.5 W/kg, scaling with W/kg, clamped
  // between a gentle spin and a pro-level sustained climb.
  const vamMPerHour = Math.min(1800, Math.max(300, wPerKg * 280));

  const flatTimeHours = distanceKm / flatSpeedKmh;
  const climbTimeHours = elevationGainM / vamMPerHour;
  return flatTimeHours + climbTimeHours;
}

/**
 * Carbohydrate oxidation rate (g/h) by relative intensity (%FTP). Bands
 * follow the widely-cited progression from ~30g/h at low aerobic intensity
 * up to the ~90-100g/h practical gut-absorption ceiling for single/multiple
 * transportable-carb mixes at threshold and above.
 */
export function getCarbOxidationRateGPerHour(relativeIntensity: number): number {
  if (relativeIntensity < 0.5) return 30;
  if (relativeIntensity < 0.65) return 45;
  if (relativeIntensity < 0.8) return 60;
  if (relativeIntensity < 0.95) return 75;
  if (relativeIntensity < 1.1) return 90;
  return 100;
}

/**
 * "Gut Training Scale" — the gut's carb-absorption rate is itself trainable
 * and improves gradually with repeated exposure to high intra-workout carb
 * intake, so a rider who has never practiced fueling at 90g/h will likely
 * feel gut distress even if their legs/lungs could support that intensity.
 * Each level's cap is the *upper* bound of its stated range — the ceiling
 * the recommendation should never exceed regardless of how hard the ride
 * itself demands.
 */
export type GutTrainingLevel = "beginner" | "intermediate" | "advanced" | "pro";

export const gutTrainingLevelLabels: Record<GutTrainingLevel, string> = {
  beginner: "Principiante",
  intermediate: "Intermedio",
  advanced: "Avanzado",
  pro: "Pro",
};

/** Full advertised range per level, for display — the cap used in
 * calculations is always the upper bound (`GUT_TRAINING_CAP_G_PER_HOUR`). */
export const gutTrainingLevelRanges: Record<GutTrainingLevel, string> = {
  beginner: "40-50 g/h",
  intermediate: "60-75 g/h",
  advanced: "80-90 g/h",
  pro: "100-120 g/h",
};

const GUT_TRAINING_CAP_G_PER_HOUR: Record<GutTrainingLevel, number> = {
  beginner: 50,
  intermediate: 75,
  advanced: 90,
  pro: 120,
};

export function getGutTrainingCapGPerHour(level: GutTrainingLevel): number {
  return GUT_TRAINING_CAP_G_PER_HOUR[level];
}

export type GutCappedCarbTarget = {
  /** What the ride's intensity alone would call for. */
  uncappedGPerHour: number;
  /** The actual recommendation — never above the athlete's current gut
   * training cap. */
  recommendedGPerHour: number;
  isGutLimited: boolean;
  gutCapGPerHour: number;
};

/**
 * Clamps the intensity-driven carb target to the athlete's current
 * digestive capacity — recommending more than the gut can absorb just
 * causes GI distress mid-ride, it doesn't extract more energy.
 */
export function getGutCappedCarbTarget(
  relativeIntensity: number,
  gutTrainingLevel: GutTrainingLevel
): GutCappedCarbTarget {
  const uncappedGPerHour = getCarbOxidationRateGPerHour(relativeIntensity);
  const gutCapGPerHour = getGutTrainingCapGPerHour(gutTrainingLevel);
  return {
    uncappedGPerHour,
    recommendedGPerHour: Math.min(uncappedGPerHour, gutCapGPerHour),
    isGutLimited: uncappedGPerHour > gutCapGPerHour,
    gutCapGPerHour,
  };
}

/** Baseline sweat rate (ml/h) at comfortable conditions (~18°C, 50%
 * humidity) for each self-reported category. */
const SWEAT_RATE_BASE_ML_PER_HOUR: Record<SweatRate, number> = {
  low: 500,
  medium: 750,
  high: 1000,
};

export const sweatRateLabels: Record<SweatRate, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};

/** Heat and humidity both push sweat rate up from the comfortable-condition
 * baseline — +2%/°C above 18°C, +0.4%/point of humidity above 50%. */
export function getHeatHumidityMultiplier(temperatureC: number, humidityPct: number): number {
  const heatFactor = 1 + Math.max(0, temperatureC - 18) * 0.02;
  const humidityFactor = 1 + Math.max(0, humidityPct - 50) * 0.004;
  return heatFactor * humidityFactor;
}

export function getFluidLossMlPerHour(
  sweatRate: SweatRate,
  temperatureC: number,
  humidityPct: number
): number {
  return Math.round(
    SWEAT_RATE_BASE_ML_PER_HOUR[sweatRate] * getHeatHumidityMultiplier(temperatureC, humidityPct)
  );
}

/** Average sweat sodium concentration for a mid-range "salty sweater" —
 * real individual values range roughly 400-1500mg/L. */
const SODIUM_CONCENTRATION_MG_PER_L = 700;

export function getSodiumLossMgPerHour(fluidLossMlPerHour: number): number {
  return Math.round((fluidLossMlPerHour / 1000) * SODIUM_CONCENTRATION_MG_PER_L);
}

export type HomeLabRecipe = {
  maltodextrinG: number;
  fructoseG: number;
  sodiumMg: number;
  waterMl: number;
  totalCarbsG: number;
};

/**
 * "Receta de Laboratorio Casero" — a maltodextrin:fructose 1:0.8 (by
 * weight) mix, the standard 2:1 glucose:fructose-equivalent ratio used to
 * raise the gut's total carb absorption ceiling above what either sugar
 * alone can achieve, dissolved in the rider's own fluid-loss target so one
 * bottle covers both carbs and hydration.
 */
export function getHomeLabRecipe({
  carbsGPerHour,
  sodiumMgPerHour,
  fluidLossMlPerHour,
  durationHours,
}: {
  carbsGPerHour: number;
  sodiumMgPerHour: number;
  fluidLossMlPerHour: number;
  durationHours: number;
}): HomeLabRecipe {
  const totalCarbsG = carbsGPerHour * durationHours;
  const maltodextrinG = totalCarbsG / 1.8;
  const fructoseG = totalCarbsG - maltodextrinG;

  return {
    maltodextrinG: Math.round(maltodextrinG),
    fructoseG: Math.round(fructoseG),
    sodiumMg: Math.round(sodiumMgPerHour * durationHours),
    waterMl: Math.round(fluidLossMlPerHour * durationHours),
    totalCarbsG: Math.round(totalCarbsG),
  };
}

/** Price per 30g-of-carbs "unit" — a commercial gel vs. the equivalent
 * bulk-bought DIY maltodextrin/fructose/sodium mix — used only for the
 * "money saved" comparison, not a real price feed. */
const COMMERCIAL_PRICE_EUR_PER_30G = 2.5;
const HOMEMADE_PRICE_EUR_PER_30G = 0.35;
const GEL_EQUIVALENT_CARBS_G = 30;

export function getMoneySavedVsGels(totalCarbsG: number): number {
  const units = totalCarbsG / GEL_EQUIVALENT_CARBS_G;
  const saved = units * (COMMERCIAL_PRICE_EUR_PER_30G - HOMEMADE_PRICE_EUR_PER_30G);
  return Math.round(saved * 100) / 100;
}

/** Total carbs burned across a whole ride — the oxidation rate integrated
 * over its duration, used for the post-ride "glycogen quemado" readout. */
export function getGlycogenBurnedGrams(relativeIntensity: number, movingTimeSeconds: number): number {
  const hours = movingTimeSeconds / 3600;
  return Math.round(getCarbOxidationRateGPerHour(relativeIntensity) * hours);
}

export type RecoveryTarget = {
  carbsG: number;
  proteinG: number;
};

/** Standard post-exercise recovery window guidance: ~1.1g carbs/kg and
 * ~0.3g protein/kg to kickstart glycogen resynthesis and muscle repair. */
export function getPostRideRecoveryTarget(weightKg: number): RecoveryTarget {
  return {
    carbsG: Math.round(weightKg * 1.1),
    proteinG: Math.round(weightKg * 0.3),
  };
}

export type PowerZoneBucket = {
  /** Watts. */
  min: number;
  max: number;
  /** Seconds spent in this bucket. */
  time: number;
};

/**
 * Glycogen burned across a whole ride from real time-in-power-zone data
 * (Strava's `/activities/{id}/zones`) rather than a single ride-average
 * watts figure — a ride with the same average power but spent half at
 * recovery pace and half at threshold burns meaningfully more glycogen
 * than a steady ride at that same average, since oxidation rate isn't
 * linear in power. Each bucket's own midpoint %FTP picks its oxidation
 * rate via `getCarbOxidationRateGPerHour`, applied to that bucket's actual
 * time, then summed — no fixed Z1-Z5 relabeling, since Strava's bucket
 * boundaries are whatever the athlete configured, not a standard 5-zone
 * split.
 */
export function getGlycogenBurnedFromPowerZones(
  buckets: PowerZoneBucket[],
  ftp: number
): number {
  if (ftp <= 0) return 0;
  let totalGrams = 0;
  for (const bucket of buckets) {
    if (bucket.time <= 0) continue;
    const midpointWatts = bucket.max > 0 ? (bucket.min + bucket.max) / 2 : bucket.min;
    const relativeIntensity = getRelativeIntensity(midpointWatts, ftp);
    const hours = bucket.time / 3600;
    totalGrams += getCarbOxidationRateGPerHour(relativeIntensity) * hours;
  }
  return Math.round(totalGrams);
}

export type RecoveryMealOption = {
  label: string;
  description: string;
  approxCarbsG: number;
  approxProteinG: number;
};

/** Household-measure reference macros (illustrative fixtures, not a real
 * nutrition database) used to scale two simple, no-scale-needed recovery
 * meal templates to the athlete's actual recovery target. */
const RICE_CARBS_G_PER_CUP = 45;
const RICE_PROTEIN_G_PER_CUP = 4;
const CHICKEN_PROTEIN_G_PER_100G = 31;
const CHICKPEA_CAN_CARBS_G = 35;
const CHICKPEA_CAN_PROTEIN_G = 20;
const TUNA_CAN_PROTEIN_G = 26;
const BANANA_CARBS_G = 27;
const BANANA_PROTEIN_G = 1;

/**
 * "Plato de Recuperación Objetivo" — two real, scale-free meal proposals
 * sized (in whole/half household units) to approximately hit the target
 * carbs/protein, rather than a precise gram-for-gram recipe.
 */
export function getRecoveryMealOptions(target: RecoveryTarget): RecoveryMealOption[] {
  const riceCups = Math.max(0.5, Math.round((target.carbsG / RICE_CARBS_G_PER_CUP) * 2) / 2);
  const rawChickenG = (target.proteinG / CHICKEN_PROTEIN_G_PER_100G) * 100;
  const chickenG = Math.max(50, Math.round(rawChickenG / 10) * 10);

  const chickpeaCans = Math.max(1, Math.round((target.carbsG - BANANA_CARBS_G) / CHICKPEA_CAN_CARBS_G));
  const tunaCans = Math.max(1, Math.round(target.proteinG / TUNA_CAN_PROTEIN_G));

  return [
    {
      label: "Opción A",
      description: `${riceCups} tazas de arroz blanco cocido + ${chickenG}g de pechuga de pollo`,
      approxCarbsG: Math.round(riceCups * RICE_CARBS_G_PER_CUP),
      approxProteinG: Math.round(
        riceCups * RICE_PROTEIN_G_PER_CUP + (chickenG / 100) * CHICKEN_PROTEIN_G_PER_100G
      ),
    },
    {
      label: "Opción B",
      description: `${chickpeaCans} bote(s) de garbanzos + ${tunaCans} lata(s) de atún + 1 plátano`,
      approxCarbsG: Math.round(chickpeaCans * CHICKPEA_CAN_CARBS_G + BANANA_CARBS_G),
      approxProteinG: Math.round(
        chickpeaCans * CHICKPEA_CAN_PROTEIN_G + tunaCans * TUNA_CAN_PROTEIN_G + BANANA_PROTEIN_G
      ),
    },
  ];
}

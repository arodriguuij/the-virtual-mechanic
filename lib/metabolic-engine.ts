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

/** Rough per-kg market prices for buying maltodextrin/fructose/electrolyte
 * salt in bulk vs. a single commercial energy gel — used only for the
 * "money saved" comparison, not a real price feed. */
const BULK_PRICE_EUR_PER_KG = { maltodextrin: 6, fructose: 8, sodium: 3 };
const COMMERCIAL_GEL_PRICE_EUR = 1.5;
const COMMERCIAL_GEL_CARBS_G = 25;

export function getMoneySavedVsGels(recipe: HomeLabRecipe): number {
  const homemadeCost =
    (recipe.maltodextrinG / 1000) * BULK_PRICE_EUR_PER_KG.maltodextrin +
    (recipe.fructoseG / 1000) * BULK_PRICE_EUR_PER_KG.fructose +
    (recipe.sodiumMg / 1_000_000) * BULK_PRICE_EUR_PER_KG.sodium;
  const commercialCost = (recipe.totalCarbsG / COMMERCIAL_GEL_CARBS_G) * COMMERCIAL_GEL_PRICE_EUR;
  return Math.round((commercialCost - homemadeCost) * 100) / 100;
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

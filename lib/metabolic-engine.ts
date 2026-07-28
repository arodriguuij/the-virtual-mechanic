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
 * Metabolic phenotype (a simplified VLaMax-style classification) — a
 * "diesel" athlete's higher fat-oxidation efficiency and an "explosive"
 * athlete's higher glycolytic rate both show up mainly at low-moderate
 * intensity; above tempo everyone burns glycolytically regardless of
 * phenotype, so the adjustment only applies below the aerobic-zone
 * threshold shared with `getCarbOxidationRateGPerHour`'s own bands.
 */
export type AthleteType = "diesel" | "balanced" | "explosive";

export const athleteTypeLabels: Record<AthleteType, string> = {
  diesel: "Diésel / Escalador de Fondo",
  balanced: "Balanced / Todoterreno",
  explosive: "Explosivo / Esprinter / BTT",
};

export const athleteTypeDescriptions: Record<AthleteType, string> = {
  diesel: "Alta eficiencia en grasa — menor consumo de glucógeno en ritmos suaves.",
  balanced: "Línea base metabólica, sin ajuste.",
  explosive: "Alta VLaMax — mayor tasa glucolítica incluso a ritmos suaves.",
};

const AEROBIC_ZONE_RELATIVE_INTENSITY_THRESHOLD = 0.8;
const ATHLETE_TYPE_MULTIPLIER: Record<AthleteType, number> = {
  diesel: 0.85,
  balanced: 1.0,
  explosive: 1.15,
};

/**
 * The phenotype-adjusted carb oxidation rate — same %FTP bands as
 * `getCarbOxidationRateGPerHour`, scaled by the athlete type multiplier
 * only while below the aerobic-zone threshold (tempo and above converge to
 * the unadjusted rate for every phenotype).
 */
export function getPersonalizedCarbOxidationRateGPerHour(
  relativeIntensity: number,
  athleteType: AthleteType
): number {
  const base = getCarbOxidationRateGPerHour(relativeIntensity);
  if (relativeIntensity >= AEROBIC_ZONE_RELATIVE_INTENSITY_THRESHOLD) return base;
  return Math.round(base * ATHLETE_TYPE_MULTIPLIER[athleteType]);
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
  gutTrainingLevel: GutTrainingLevel,
  athleteType: AthleteType = "balanced"
): GutCappedCarbTarget {
  const uncappedGPerHour = getPersonalizedCarbOxidationRateGPerHour(relativeIntensity, athleteType);
  const gutCapGPerHour = getGutTrainingCapGPerHour(gutTrainingLevel);
  return {
    uncappedGPerHour,
    recommendedGPerHour: Math.min(uncappedGPerHour, gutCapGPerHour),
    isGutLimited: uncappedGPerHour > gutCapGPerHour,
    gutCapGPerHour,
  };
}

// Below this fraction of the athlete's own gut-training cap, their real
// average intake is meaningfully under-using their current digestive
// capacity — worth calling out as headroom, not just noise in the data.
const INTAKE_HEADROOM_FRACTION = 0.85;

/**
 * "Recomendación Biológica" (`/estadisticas`) — a plain-language nudge
 * comparing the athlete's real average consumed-carb rate (`getWeeklyPerformance`'s
 * `avgIntakeGPerHour`, real logged intake, never planned targets) against
 * their own gut-training cap, so the recommendation is personalized to
 * their actual logged behavior rather than a generic tip. `null` input
 * (no consumption data logged yet) returns a plain "not enough data" note
 * rather than fabricating a comparison with nothing to compare.
 */
export function getIntakeRecommendationNote(
  avgIntakeGPerHour: number | null,
  gutTrainingLevel: GutTrainingLevel
): string {
  const capGPerHour = getGutTrainingCapGPerHour(gutTrainingLevel);
  if (avgIntakeGPerHour == null) {
    return "Todavía no hay suficientes datos de consumo real — registra tu ingesta tras cada salida para desbloquear una recomendación personalizada.";
  }
  if (avgIntakeGPerHour > capGPerHour) {
    return `Tu ingesta real (${avgIntakeGPerHour} g/h) ya supera el techo de tu nivel actual (${capGPerHour} g/h) — es una señal de que tu intestino podría estar listo para subir de nivel en Gut Training.`;
  }
  if (avgIntakeGPerHour >= capGPerHour * INTAKE_HEADROOM_FRACTION) {
    return `Tu promedio de ${avgIntakeGPerHour} g/h ya está cerca de tu capacidad actual (${capGPerHour} g/h) — mantén esta rutina y considera avanzar de nivel cuando te sientas cómodo.`;
  }
  return `Tu promedio de ${avgIntakeGPerHour} g/h está por debajo de tu capacidad de ${gutTrainingLevelRanges[gutTrainingLevel]}. Puedes aumentar la dosis en salidas de fondo para aprovechar mejor tu ventana digestiva.`;
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

// Standard environmental lapse rate — ambient temperature falls ~6.5°C per
// 1000m of altitude gained. The pre-ride planner's dynamic weather only
// samples the route's *start* coordinates (a saved Strava route has no
// elapsed-time-to-point mapping the way a completed activity's polyline
// does), which silently assumes the whole route sits at the start's
// altitude — systematically overestimating temperature, and therefore
// sweat rate and sodium loss, on a route that climbs into the mountains.
// Strava's route summary doesn't expose real elev_high/elev_low the way a
// completed activity does, so total elevation gain is used as a practical
// proxy for how far above the start the route's high point sits.
const LAPSE_RATE_C_PER_1000M = 6.5;

export function getLapseRateAdjustedTemperature(
  baseTemperatureC: number,
  elevationGainM: number
): number {
  const adjustmentC = (Math.max(0, elevationGainM) / 1000) * LAPSE_RATE_C_PER_1000M;
  return Math.round((baseTemperatureC - adjustmentC) * 10) / 10;
}

/** Above this, sweat rate no longer scales gently — a hard +20% heat-stress
 * bump replaces the gradual per-degree slope below it. */
const HIGH_HEAT_THRESHOLD_C = 25;
const HIGH_HEAT_MULTIPLIER = 1.2;

/** Heat and humidity both push sweat rate up from the comfortable-condition
 * baseline. Below `HIGH_HEAT_THRESHOLD_C`, heat scales gently at +2%/°C
 * above 18°C; above it, the body's cooling demand jumps rather than
 * climbing linearly, so a flat +20% applies instead of continuing the
 * per-degree slope. Humidity always scales gently, +0.4%/point above 50%. */
export function getHeatHumidityMultiplier(temperatureC: number, humidityPct: number): number {
  const heatFactor =
    temperatureC > HIGH_HEAT_THRESHOLD_C
      ? HIGH_HEAT_MULTIPLIER
      : 1 + Math.max(0, temperatureC - 18) * 0.02;
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

/** Average sweat sodium concentration for a typical athlete — real
 * individual values range roughly 400-1500mg/L. Self-identified "salty
 * sweaters" (white crust on the jersey, stinging eyes — see
 * `athlete_profiles.is_salty_sweater`) sit meaningfully above that average,
 * so they get a distinct, elevated figure rather than the same baseline
 * everyone else uses — under-dosing sodium for a genuine heavy sweater risks
 * cramping and, on long hot rides, hyponatremia. */
const SODIUM_CONCENTRATION_MG_PER_L = 700;
const SALTY_SWEATER_SODIUM_CONCENTRATION_MG_PER_L = 1200;

export function getSodiumLossMgPerHour(
  fluidLossMlPerHour: number,
  isSaltySweater: boolean = false
): number {
  const concentration = isSaltySweater
    ? SALTY_SWEATER_SODIUM_CONCENTRATION_MG_PER_L
    : SODIUM_CONCENTRATION_MG_PER_L;
  return Math.round((fluidLossMlPerHour / 1000) * concentration);
}

/** Common table salt (NaCl) is only ~39.3% pure sodium by weight — every
 * sodium figure in the DIY recipe is a *pure sodium* target, but a kitchen
 * scale weighs salt, not sodium, so this is the actual number to weigh out
 * (1 / 0.393 ≈ 2.54g of salt per gram of pure sodium). */
const SODIUM_TO_TABLE_SALT_MULTIPLIER = 2.54;

export function getTableSaltGrams(sodiumMg: number): number {
  return Math.round((sodiumMg / 1000) * SODIUM_TO_TABLE_SALT_MULTIPLIER * 10) / 10;
}

/** Reference equivalences for converting a kitchen-scale gram figure into
 * something measurable without a scale at all — a rider mixing a bottle at
 * 6am rarely has one to hand. Approximate (real teaspoon/scoop volumes vary
 * by brand/density), which is exactly why the UI must always show the gram
 * figure alongside the equivalence, never the equivalence alone. */
export const SALT_G_PER_TEASPOON = 5;
export const POWDER_G_PER_SCOOP = 30;

export type HouseholdMeasures = {
  saltTeaspoons: number;
  maltodextrinScoops: number;
  fructoseScoops: number;
};

/**
 * "Conversión a Medidas Caseras" — turns the recipe's gram figures into
 * practical kitchen-counter measures (table-salt teaspoons, powder scoops)
 * so the DIY recipe is actually followable without a gram scale. Takes
 * *table salt* grams (see `getTableSaltGrams` above), not pure sodium mg —
 * callers must convert first, same convention as everywhere else this file
 * displays sodium.
 */
export function calculateHouseholdMeasures({
  saltG,
  maltodextrinG,
  fructoseG,
}: {
  saltG: number;
  maltodextrinG: number;
  fructoseG: number;
}): HouseholdMeasures {
  return {
    saltTeaspoons: Math.round((saltG / SALT_G_PER_TEASPOON) * 10) / 10,
    maltodextrinScoops: Math.round((maltodextrinG / POWDER_G_PER_SCOOP) * 10) / 10,
    fructoseScoops: Math.round((fructoseG / POWDER_G_PER_SCOOP) * 10) / 10,
  };
}

/**
 * "Nutrición Híbrida" — solid pocket food covers part of the ride's carb
 * target before the bottle recipe is sized, since a rider who's eating
 * solid food doesn't need the same grams dissolved in their bottles.
 * Commercial gels come in three common dose tiers rather than one fixed
 * figure (small/standard/high-carb "hydro" gels genuinely differ by ~2x in
 * carb content), each modeled as its own catalog entry so a rider can mix
 * doses in the same ride (e.g. 1 standard + 1 high-carb). Fixed
 * illustrative carb figures per item, not a real nutrition database (same
 * convention as the recovery meal options below).
 */
export type PocketFoodItemType =
  | "banana"
  | "energy_bar"
  | "rice_cake"
  | "dates"
  | "gel_small"
  | "gel_standard"
  | "gel_high";

export const pocketFoodLabels: Record<PocketFoodItemType, string> = {
  banana: "🍌 Plátano",
  energy_bar: "🍫 Barrita energética",
  rice_cake: "🍙 Bollo de arroz / Rice cake",
  dates: "🌴 Dátiles (2 uds)",
  gel_small: "🧃 Gel pequeño",
  gel_standard: "🧃 Gel estándar",
  gel_high: "🧃 Gel alta carga / Hydro",
};

export const pocketFoodCarbsG: Record<PocketFoodItemType, number> = {
  banana: 22,
  energy_bar: 30,
  rice_cake: 25,
  dates: 18,
  gel_small: 25,
  gel_standard: 30,
  gel_high: 45,
};

/** `customCarbsG` covers anything outside the fixed catalog — a rider's own
 * homemade snack, a brand not listed, etc. — entered as a free grams value
 * rather than forced through one of the preset items. */
export type PocketFoodSelection = Partial<Record<PocketFoodItemType, number>> & {
  customCarbsG?: number;
};

export function getPocketFoodTotalCarbsG(selection: PocketFoodSelection): number {
  const { customCarbsG, ...items } = selection;
  const catalogTotal = (Object.entries(items) as [PocketFoodItemType, number][]).reduce(
    (sum, [type, qty]) => sum + pocketFoodCarbsG[type] * Math.max(0, qty ?? 0),
    0
  );
  return catalogTotal + Math.max(0, customCarbsG ?? 0);
}

/**
 * "Modo de Fueling" — three ways of arriving at the same DIY-recipe
 * pipeline, differing only in *where the pocket-food selection comes
 * from* before `getHomeLabRecipe`'s existing `pocketFoodCarbsG` subtraction
 * runs:
 * - `optimal` — the athlete makes no choice at all; `getOptimalPocketFoodSelection`
 *   below picks it automatically.
 * - `inventory` — the athlete's own manual catalog selection, used as-is
 *   (this was this app's only behavior before modes existed; the type/UI
 *   were originally named "pantry"/"Mi Despensa", renamed to "Mi Inventario"
 *   for a more technical/professional tone across the app).
 * - `hybrid` — the athlete's manual selection is treated as a fixed base,
 *   and `getHybridGelSuggestion` below additionally suggests how many
 *   standard gels would close whatever gap is left, as advisory
 *   information alongside the bottle recipe (which still covers the true
 *   remaining gap either way, exactly like `inventory` mode).
 */
export type FuelingMode = "optimal" | "inventory" | "hybrid";

/**
 * "Modo Óptimo" — a high-digestive-efficiency strategy composed *exclusively*
 * of the DIY bottle plus fast-absorption gels, never solid food: solids
 * (banana, energy bar, rice cake, dates) slow gastric emptying relative to a
 * gel or liquid carb source, which matters more the harder/longer the ride
 * gets — exactly the rides this mode targets. Below ~2.5h there's nothing to
 * gain from any pocket food at all (an all-liquid DIY bottle is simpler and
 * just as effective); past that, gel count/tier
 * scales with duration as a proxy for total carb demand — a fixed, modest
 * allowance, not a full combinatorial optimizer (this file's "heuristic, not
 * clinical" convention throughout).
 */
export function getOptimalPocketFoodSelection(durationHours: number): PocketFoodSelection {
  if (durationHours < 2.5) return {};
  if (durationHours < 4) return { gel_standard: 1 };
  if (durationHours < 6) return { gel_standard: 2 };
  return { gel_standard: 1, gel_high: 1 };
}

/**
 * "Modo Híbrido" — a simple greedy fill with one gel size (not a full
 * combinatorial optimizer, same convention as `getOptimalPocketFoodSelection`
 * above): how many standard gels (30g each) would close the remaining carb
 * gap after the athlete's own fixed staple selection. Purely advisory — the
 * DIY bottle recipe still covers the real remaining gap regardless of
 * whether the athlete actually carries these gels, this just names an
 * alternative way to close the same gap.
 */
export function getHybridGelSuggestion(remainingCarbsG: number): number {
  if (remainingCarbsG <= 0) return 0;
  return Math.round(remainingCarbsG / pocketFoodCarbsG.gel_standard);
}

export type NutritionMilestone = {
  label: string;
  atKm: number | null;
  atHours: number;
};

/**
 * When each pocket-food item should be eaten — spread evenly across the
 * ride (never right at the start or the finish) rather than all at once,
 * one milestone per individual item selected (2 gels → 2 separate
 * milestones at different points). Any custom carb amount becomes a single
 * additional milestone, since it has no per-unit count of its own.
 */
export function getPocketFoodMilestones({
  selection,
  durationHours,
  distanceKm,
}: {
  selection: PocketFoodSelection;
  durationHours: number;
  distanceKm: number | null;
}): NutritionMilestone[] {
  const { customCarbsG, ...selectedItems } = selection;
  const labels: string[] = [];
  for (const [type, qty] of Object.entries(selectedItems) as [PocketFoodItemType, number][]) {
    for (let i = 0; i < Math.max(0, qty ?? 0); i++) labels.push(`Comer ${pocketFoodLabels[type]}`);
  }
  if (customCarbsG != null && customCarbsG > 0) {
    labels.push(`Comer ración personalizada (${Math.round(customCarbsG)}g HC)`);
  }
  const n = labels.length;
  if (n === 0) return [];

  return labels.map((label, i) => {
    const fraction = (i + 1) / (n + 1);
    return {
      label,
      atKm: distanceKm != null ? Math.round(distanceKm * fraction * 10) / 10 : null,
      atHours: Math.round(durationHours * fraction * 100) / 100,
    };
  });
}

/** Minimum/maximum sip reminder interval — even a very low sweat rate still
 * gets reminded at least every 20 minutes (a bottle left untouched for
 * longer is easy to forget entirely), and even a very high one is capped at
 * 10 minutes (more frequent than that stops being a distinct "reminder" and
 * just becomes constant sipping). */
const HYDRATION_INTERVAL_MIN_MINUTES = 10;
const HYDRATION_INTERVAL_MAX_MINUTES = 20;

/**
 * "Frecuencia Hídrica" — how often (in minutes) to remind the athlete to
 * drink, scaled inversely to their actual fluid-loss rate: a higher sweat
 * rate needs more frequent, smaller sips rather than the same interval with
 * bigger gulps (which risks gastric sloshing at high intensity).
 */
export function getHydrationIntervalMinutes(fluidLossMlPerHour: number): number {
  const litersPerHour = fluidLossMlPerHour / 1000;
  if (litersPerHour <= 0) return HYDRATION_INTERVAL_MAX_MINUTES;
  return Math.max(
    HYDRATION_INTERVAL_MIN_MINUTES,
    Math.min(HYDRATION_INTERVAL_MAX_MINUTES, Math.round(180 / (litersPerHour * 10)))
  );
}

// Solid food (slow to digest) only makes sense early, before intensity rises
// and gastric blood flow drops — placed somewhere in the ride's first third.
const SOLID_FOOD_MAX_FRACTION = 0.3;
// Caffeine only meaningfully helps a ride long enough to still have a hard
// effort left in it once it kicks in — below this there's nothing to time it
// against.
const CAFFEINE_MIN_DURATION_HOURS = 1.5;
const CAFFEINE_LEAD_MINUTES = 45;
// Caffeine is only ever suggested late in the ride — early placement (the
// bug this window fixes: a route whose elevation peak sits near the start,
// e.g. a climb straight out of the departure point, used to time caffeine as
// early as km 5 / minute 12, which defeats the point of a late-ride alertness
// boost) is never allowed. Absent a real late climb to time against, the
// suggestion lands at the midpoint of this window.
const CAFFEINE_WINDOW_START_FRACTION = 0.65;
const CAFFEINE_WINDOW_END_FRACTION = 0.75;
// A route's real elevation peak only overrides the fixed window when it
// falls in the second half of the ride — a genuine late climb is worth
// timing caffeine against directly; an early one is not a reason to move
// caffeine earlier than the window above.
const LATE_CLIMB_MIN_FRACTION = 0.5;

export type TimingTimelineEntry = {
  type: "solid" | "gel" | "caffeine";
  label: string;
  atFractionOfRide: number;
  atMinutes: number;
  atKm: number | null;
};

export type TimingTimeline = {
  hydrationIntervalMinutes: number;
  entries: TimingTimelineEntry[];
};

function makeTimingEntry(
  type: TimingTimelineEntry["type"],
  label: string,
  fraction: number,
  durationHours: number,
  distanceKm: number | null
): TimingTimelineEntry {
  const clamped = Math.max(0, Math.min(1, fraction));
  return {
    type,
    label,
    atFractionOfRide: Math.round(clamped * 100) / 100,
    atMinutes: Math.round(clamped * durationHours * 60),
    atKm: distanceKm != null ? Math.round(distanceKm * clamped * 10) / 10 : null,
  };
}

/**
 * "Cronograma Dinámico de Ingesta" — unlike `getPocketFoodMilestones` (which
 * just spreads every selected item evenly across the ride), this places each
 * *kind* of food where it's physiologically most useful: slow-digesting
 * solids early (first third), fast-absorption gels from the second half
 * through the finish, and a caffeine hit timed to peak ~45 minutes before the
 * ride's hardest moment — the route's real elevation peak when known (a
 * saved Strava route's summit or a parsed GPX's own high point), or a
 * fixed 75%-of-ride fallback otherwise (quick-calculator mode has no
 * elevation profile to target). Also returns the sip-reminder frequency
 * (`getHydrationIntervalMinutes`) as a standalone recurring interval, since
 * "drink every N minutes" isn't a single point in time the way solid/gel/
 * caffeine milestones are.
 */
export function generateTimingTimeline({
  selection,
  durationHours,
  distanceKm,
  fluidLossMlPerHour,
  peakFraction = null,
}: {
  selection: PocketFoodSelection;
  durationHours: number;
  distanceKm: number | null;
  fluidLossMlPerHour: number;
  peakFraction?: number | null;
}): TimingTimeline {
  const { customCarbsG, ...items } = selection;
  const solidTypes = new Set<PocketFoodItemType>(["banana", "energy_bar", "rice_cake", "dates"]);
  const gelTypes = new Set<PocketFoodItemType>(["gel_small", "gel_standard", "gel_high"]);

  const solidLabels: string[] = [];
  const gelLabels: string[] = [];
  for (const [type, qty] of Object.entries(items) as [PocketFoodItemType, number][]) {
    const bucket = solidTypes.has(type) ? solidLabels : gelTypes.has(type) ? gelLabels : null;
    if (!bucket) continue;
    for (let i = 0; i < Math.max(0, qty ?? 0); i++) bucket.push(`Comer ${pocketFoodLabels[type]}`);
  }
  if (customCarbsG != null && customCarbsG > 0) {
    solidLabels.push(`Comer ración personalizada (${Math.round(customCarbsG)}g HC)`);
  }

  const entries: TimingTimelineEntry[] = [];

  solidLabels.forEach((label, i) => {
    const fraction = (SOLID_FOOD_MAX_FRACTION * (i + 1)) / (solidLabels.length + 1);
    entries.push(makeTimingEntry("solid", label, fraction, durationHours, distanceKm));
  });

  gelLabels.forEach((label, i) => {
    const fraction = 0.5 + (0.45 * (i + 1)) / (gelLabels.length + 1);
    entries.push(makeTimingEntry("gel", label, fraction, durationHours, distanceKm));
  });

  if (durationHours >= CAFFEINE_MIN_DURATION_HOURS) {
    const hasLateClimb = peakFraction != null && peakFraction >= LATE_CLIMB_MIN_FRACTION;
    const leadFraction = CAFFEINE_LEAD_MINUTES / 60 / durationHours;
    // Never earlier than the window's start, regardless of where the climb
    // sits — a late climb can only push caffeine later than the default
    // midpoint, never earlier than 65% of the ride.
    const fraction = hasLateClimb
      ? Math.max(CAFFEINE_WINDOW_START_FRACTION, peakFraction - leadFraction)
      : (CAFFEINE_WINDOW_START_FRACTION + CAFFEINE_WINDOW_END_FRACTION) / 2;
    entries.push(
      makeTimingEntry("caffeine", "Toma de cafeína (~100-200mg)", fraction, durationHours, distanceKm)
    );
  }

  entries.sort((a, b) => a.atMinutes - b.atMinutes);

  return {
    hydrationIntervalMinutes: getHydrationIntervalMinutes(fluidLossMlPerHour),
    entries,
  };
}

export type HomeLabRecipe = {
  maltodextrinG: number;
  fructoseG: number;
  sodiumMg: number;
  waterMl: number;
  totalCarbsG: number;
};

/**
 * Below ~45g/h, a single glucose-polymer transporter (SGLT1) isn't
 * saturated yet, so there's no absorption-ceiling benefit to adding
 * fructose — pure maltodextrin. From 45-75g/h a 2:1 maltodextrin:fructose
 * split starts recruiting the fructose-specific GLUT5 transporter to lift
 * that ceiling. Above 75g/h — where SGLT1 alone is genuinely maxed out —
 * the ratio shifts to 1:0.8, the split most dual-transporter research
 * settles on for near-maximal (~90g/h+) combined oxidation rates.
 */
export const HIGH_CARB_RATE_THRESHOLD_G_PER_HOUR = 75;
export const MODERATE_CARB_RATE_THRESHOLD_G_PER_HOUR = 45;

function getMaltodextrinFraction(carbsGPerHour: number, forceHighCarbRatio = false): number {
  if (forceHighCarbRatio) return 1 / 1.8;
  if (carbsGPerHour < MODERATE_CARB_RATE_THRESHOLD_G_PER_HOUR) return 1;
  if (carbsGPerHour <= HIGH_CARB_RATE_THRESHOLD_G_PER_HOUR) return 2 / 3;
  return 1 / 1.8;
}

/**
 * "Contextualización Científica" — the plain-language *why* behind the
 * maltodextrin:fructose ratio `getMaltodextrinFraction` just picked, for a
 * tooltip next to the g/h readout rather than expecting the athlete to know
 * the SGLT1/GLUT5 transporter research behind the numbers.
 */
export function getCarbRatioContextNote(carbsGPerHour: number): string {
  if (carbsGPerHour > HIGH_CARB_RATE_THRESHOLD_G_PER_HOUR) {
    return "Ratio 1:0.8 aplicado para activar los transportadores GLUT5 y SGLT1 simultáneamente.";
  }
  if (carbsGPerHour < MODERATE_CARB_RATE_THRESHOLD_G_PER_HOUR) {
    return "Ratio 100% maltodextrina aplicado; no requiere fructosa para esta tasa de oxidación.";
  }
  return "Ratio 2:1 maltodextrina:fructosa aplicado para empezar a reclutar el transportador GLUT5.";
}

/**
 * "Receta de Laboratorio Casero" — a maltodextrin:fructose mix whose ratio
 * scales with the ride's own carb rate (see `getMaltodextrinFraction`
 * above), dissolved in the rider's own fluid-loss target so one bottle
 * covers both carbs and hydration. `pocketFoodCarbsG` (from the hybrid
 * nutrition module above) is subtracted from the ride's carb target first —
 * solid food eaten from the jersey pocket means less needs to go in the
 * bottles, not an additional carb allowance on top. `forceHighCarbRatio`
 * (set from the planner's "Ruta objetivo / Competición" checkbox) skips the
 * rate-based ratio bands entirely and always applies the 1:0.8 near-maximal
 * dual-transporter split — a target event is exactly the scenario where
 * squeezing out the last few g/h of absorption is worth it even if the
 * ride's own carb rate wouldn't otherwise have crossed the 75g/h threshold.
 */
export function getHomeLabRecipe({
  carbsGPerHour,
  sodiumMgPerHour,
  fluidLossMlPerHour,
  durationHours,
  pocketFoodCarbsG = 0,
  forceHighCarbRatio = false,
}: {
  carbsGPerHour: number;
  sodiumMgPerHour: number;
  fluidLossMlPerHour: number;
  durationHours: number;
  pocketFoodCarbsG?: number;
  forceHighCarbRatio?: boolean;
}): HomeLabRecipe {
  const totalCarbsG = Math.max(0, carbsGPerHour * durationHours - pocketFoodCarbsG);
  const maltodextrinG = totalCarbsG * getMaltodextrinFraction(carbsGPerHour, forceHighCarbRatio);
  const fructoseG = totalCarbsG - maltodextrinG;

  return {
    maltodextrinG: Math.round(maltodextrinG),
    fructoseG: Math.round(fructoseG),
    sodiumMg: Math.round(sodiumMgPerHour * durationHours),
    waterMl: Math.round(fluidLossMlPerHour * durationHours),
    totalCarbsG: Math.round(totalCarbsG),
  };
}

/** Total carbs burned across a whole ride — the oxidation rate integrated
 * over its duration, used for the post-ride "glycogen quemado" readout. */
export function getGlycogenBurnedGrams(
  relativeIntensity: number,
  movingTimeSeconds: number,
  athleteType: AthleteType = "balanced"
): number {
  const hours = movingTimeSeconds / 3600;
  return Math.round(getPersonalizedCarbOxidationRateGPerHour(relativeIntensity, athleteType) * hours);
}

/**
 * Rides with no power meter at all (Strava's `device_watts: false`) still
 * often have a heart-rate strap — %HRmax doesn't map onto %FTP one-to-one
 * (a threshold effort tends to sit a few points lower on %HRmax than on
 * %FTP), but as a same-order-of-magnitude fallback it's far better than
 * guessing, and reusing it as a direct proxy for `relativeIntensity` lets
 * this feed the exact same oxidation-rate bands every other estimate in
 * this file is built from — no separate HR-specific table to keep in sync.
 * Guards against a zero/missing `maxHeartrate` so this can never divide by
 * zero and return `NaN` up into the Post-Ride Analysis view.
 */
export function getRelativeIntensityFromHeartRate(
  averageHeartrate: number,
  maxHeartrate: number
): number {
  if (!(maxHeartrate > 0) || !Number.isFinite(averageHeartrate)) return 0;
  return Math.max(0, Math.min(1.2, averageHeartrate / maxHeartrate));
}

/** Heart-rate-based fallback for `getGlycogenBurnedGrams` — see
 * `getRelativeIntensityFromHeartRate` above for the %HRmax proxy this is
 * built on. */
export function getGlycogenBurnedFromHeartRate(
  averageHeartrate: number,
  maxHeartrate: number,
  movingTimeSeconds: number,
  athleteType: AthleteType = "balanced"
): number {
  const relativeIntensity = getRelativeIntensityFromHeartRate(averageHeartrate, maxHeartrate);
  return getGlycogenBurnedGrams(relativeIntensity, movingTimeSeconds, athleteType);
}

export type MacroRecoveryTarget = {
  carbsG: number;
  proteinG: number;
  fatLimitG: number;
  fluidMl: number;
  sodiumMg: number;
};

// Protein dose past which extra muscle protein synthesis stimulation
// plateaus, and below which a genuine anabolic dose isn't reached — the
// scaled figure is clamped into this window regardless of body weight.
const MIN_RECOVERY_PROTEIN_G = 22;
const MAX_RECOVERY_PROTEIN_G = 35;
// A moderate fat ceiling, not zero — fat itself isn't harmful post-ride, but
// a high-fat meal slows gastric emptying and delays the carbs/fluid that
// actually matter in this window from reaching the gut.
const MIN_RECOVERY_FAT_LIMIT_G = 10;
const MAX_RECOVERY_FAT_LIMIT_G = 20;
// Post-exercise rehydration guidance (ACSM et al.) targets ~125-150% of the
// estimated fluid deficit, not a 1:1 replacement — sweat losses during
// exercise are rarely fully offset by in-ride drinking, so simply matching
// the deficit under-hydrates.
const POST_RIDE_FLUID_REPLACEMENT_FACTOR = 1.2;

export type RecoveryDebt = {
  carbsDebtG: number;
  /** `fluidLossMl` scaled by the post-exercise replacement factor, before
   * subtracting what was drunk — exposed so callers can render the "GASTADO"
   * side of the equation without duplicating the 120% figure themselves. */
  fluidTargetMl: number;
  fluidDebtMl: number;
  sodiumDebtMg: number;
};

/**
 * "Deuda Neta de Recuperación" — nets the ride's estimated burn/loss against
 * whatever the rider says they actually consumed *during* the ride itself
 * (bottles, gels, electrolyte tabs), rather than assuming zero in-ride
 * intake the way a first-pass estimate has to. Each metric is floored at 0:
 * a rider who drank more than they sweat out doesn't have a "negative"
 * fluid debt, they just don't have one. Fluid loss is scaled by the same
 * ~120% post-exercise rehydration factor before netting against what was
 * drunk, since the deficit itself (not just the raw sweat figure) is what
 * needs replacing.
 */
export function getRecoveryDebt({
  carbsBurnedG,
  carbsConsumedG,
  fluidLossMl,
  fluidConsumedMl,
  sodiumLossMg,
  sodiumConsumedMg,
}: {
  carbsBurnedG: number;
  carbsConsumedG: number;
  fluidLossMl: number;
  fluidConsumedMl: number;
  sodiumLossMg: number;
  sodiumConsumedMg: number;
}): RecoveryDebt {
  const fluidTargetMl = Math.round(fluidLossMl * POST_RIDE_FLUID_REPLACEMENT_FACTOR);
  return {
    carbsDebtG: Math.max(0, Math.round(carbsBurnedG - carbsConsumedG)),
    fluidTargetMl,
    fluidDebtMl: Math.max(0, Math.round(fluidTargetMl - fluidConsumedMl)),
    sodiumDebtMg: Math.max(0, Math.round(sodiumLossMg - sodiumConsumedMg)),
  };
}

/**
 * "Objetivo de Recuperación por Macronutrientes" — replaces a fixed
 * carbs/protein pair with the full macro picture the first 2-4 post-ride
 * hours actually call for, built exclusively from the *net* recovery debt
 * (see `getRecoveryDebt` above) rather than the ride's raw burn/loss:
 * - **Carbs**: capped at the lower of the net carb debt or a ~1.2g/kg
 *   ceiling — replacing more than was actually burned doesn't speed
 *   glycogen resynthesis, it's just extra calories, and the ceiling still
 *   applies even when in-ride intake was zero.
 * - **Protein**: ~0.35g/kg, clamped to the 22-35g effective dose window —
 *   unaffected by in-ride intake, since it's about muscle repair, not
 *   replacing a specific deficit.
 * - **Fat**: a soft ~0.15g/kg limit (clamped 10-20g), to keep gastric
 *   emptying fast for this window rather than to restrict fat generally.
 * - **Fluid** and **Sodium**: the net debt figures directly.
 */
export function getMacroRecoveryTarget({
  weightKg,
  recoveryDebt,
}: {
  weightKg: number;
  recoveryDebt: RecoveryDebt;
}): MacroRecoveryTarget {
  return {
    carbsG: Math.round(Math.min(recoveryDebt.carbsDebtG, weightKg * 1.2)),
    proteinG: Math.min(
      MAX_RECOVERY_PROTEIN_G,
      Math.max(MIN_RECOVERY_PROTEIN_G, Math.round(weightKg * 0.35))
    ),
    fatLimitG: Math.min(
      MAX_RECOVERY_FAT_LIMIT_G,
      Math.max(MIN_RECOVERY_FAT_LIMIT_G, Math.round(weightKg * 0.15))
    ),
    fluidMl: recoveryDebt.fluidDebtMl,
    sodiumMg: recoveryDebt.sodiumDebtMg,
  };
}

// The first ~30-45 post-exercise minutes are the only window where muscle
// glucose uptake happens largely through insulin-independent GLUT-4
// translocation (exercise-induced, not diet-induced) — a fast liquid carb
// source (a shake, juice, fruit) capitalizes on that window before it
// closes, rather than waiting for a solid meal's slower digestion. The
// remainder is deliberately left for the solid meal ~1.5-2h out, alongside
// the protein target, since gastric comfort right after a hard effort
// favors a smaller liquid dose first over front-loading everything at once.
const RECOVERY_PHASE_1_CARB_FRACTION = 0.35;

export type BiphasicRecoveryTarget = {
  phase1: {
    carbsG: number;
    windowLabel: string;
  };
  phase2: {
    carbsG: number;
    proteinG: number;
    windowLabel: string;
  };
};

/**
 * "Ventana de Recuperación Bifásica" — splits `recoveryTarget.carbsG` (the
 * net carb debt, see `getMacroRecoveryTarget` above) across the two windows
 * that actually matter physiologically, rather than handing over one lump
 * figure the athlete has to decide when to eat. Protein is untouched by
 * this split (see `getMacroRecoveryTarget`'s own rationale — it's about
 * muscle repair, not the carb debt) and rides entirely in phase 2, since
 * spreading protein across an all-liquid phase 1 dose isn't standard
 * post-exercise practice the way fast carbs are.
 */
export function getBiphasicRecoveryTarget(
  recoveryTarget: MacroRecoveryTarget
): BiphasicRecoveryTarget {
  const phase1CarbsG = Math.round(recoveryTarget.carbsG * RECOVERY_PHASE_1_CARB_FRACTION);
  return {
    phase1: {
      carbsG: phase1CarbsG,
      windowLabel: "0-45 min · inmediata",
    },
    phase2: {
      carbsG: recoveryTarget.carbsG - phase1CarbsG,
      proteinG: recoveryTarget.proteinG,
      windowLabel: "1.5-2 h · comida principal",
    },
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
  ftp: number,
  athleteType: AthleteType = "balanced"
): number {
  if (ftp <= 0) return 0;
  let totalGrams = 0;
  for (const bucket of buckets) {
    if (bucket.time <= 0) continue;
    const midpointWatts = bucket.max > 0 ? (bucket.min + bucket.max) / 2 : bucket.min;
    const relativeIntensity = getRelativeIntensity(midpointWatts, ftp);
    const hours = bucket.time / 3600;
    totalGrams += getPersonalizedCarbOxidationRateGPerHour(relativeIntensity, athleteType) * hours;
  }
  return Math.round(totalGrams);
}


export type NetCarbDeficit = {
  /** The body's real (phenotype-adjusted, uncapped) carb burn over the
   * whole ride — what the athlete actually spends, independent of what the
   * gut can absorb. */
  estimatedBurnG: number;
  /** The recipe's recommended (gut-capped) intake over the whole ride —
   * what the plan actually tells the athlete to consume. */
  plannedIntakeG: number;
  /** `estimatedBurnG - plannedIntakeG` — positive means the plan doesn't
   * fully cover the ride's real demand (a genuine deficit, most common on
   * long/hard rides where the gut-training cap sits below the true burn
   * rate); negative or zero means the planned intake covers or exceeds it. */
  netDeficitG: number;
};

/**
 * "Déficit Neto de Carbohidratos" — an auditable, physiologically direct
 * alternative to a "glycogen battery %" gauge: rather than model total body
 * glycogen stores (an estimate on top of an estimate), this simply compares
 * the ride's real carb expenditure against what the plan actually delivers,
 * in grams. A positive `netDeficitG` is not itself a "bonk" — it just means
 * the recommended (gut-capped) intake alone won't fully replace what's
 * burned, which is expected and fine as long as it's within what the body's
 * own glycogen/fat reserves can cover.
 */
export function getNetCarbDeficit({
  burnRateGPerHour,
  intakeGPerHour,
  durationHours,
}: {
  burnRateGPerHour: number;
  intakeGPerHour: number;
  durationHours: number;
}): NetCarbDeficit {
  const estimatedBurnG = Math.round(burnRateGPerHour * durationHours);
  const plannedIntakeG = Math.round(intakeGPerHour * durationHours);
  return {
    estimatedBurnG,
    plannedIntakeG,
    netDeficitG: estimatedBurnG - plannedIntakeG,
  };
}

export type BottlePlan = {
  bottleSizeMl: number;
  fuelBottles: {
    count: number;
    maltodextrinGPerBottle: number;
    fructoseGPerBottle: number;
    sodiumMgPerBottle: number;
    // Achieved carb concentration, computed independently of the caps this
    // function already applies above — a transparent readout an athlete (or
    // the UI's hypertonic-solution warning) can check without trusting the
    // engine's own internal capping silently, see `HYPERTONIC_THRESHOLD_PCT`.
    concentrationPct: number;
  };
  waterBottles: {
    count: number;
  };
  totalBottles: number;
};

/** Widely-cited threshold above which a sports-drink concentration is
 * considered hypertonic enough to slow gastric emptying and risk GI
 * distress — independent of (and looser than) `MAX_BOTTLE_CARB_CONCENTRATION`
 * above, which already keeps every generated recipe well under this in
 * practice; this constant exists so the UI can surface the *actual* number
 * and warn explicitly rather than relying on that cap being invisible and
 * assumed. */
export const HYPERTONIC_THRESHOLD_PCT = 12;

// Fallback bottle size when the athlete hasn't configured their real
// equipment yet — matches `athlete_profiles.bottle_capacity_ml`'s own
// column default, kept as a literal here so this file has no dependency on
// the DB schema.
const DEFAULT_BOTTLE_SIZE_ML = 750;
// 8% carb concentration keeps a comfortable margin below the ~10-12%
// threshold widely cited for hypertonic-solution gastric distress/delayed
// emptying — a safety-first cap, not the maximum theoretically tolerable.
const MAX_BOTTLE_CARB_CONCENTRATION = 0.08;
// Independent of gut comfort, plain maltodextrin/fructose powder simply
// stops fully dissolving in cold water above roughly this concentration —
// a hard physical ceiling, not a preference. Always less restrictive than
// the GI-comfort cap above at every supported bottle size, but enforced as
// its own explicit check anyway: a future change to the GI cap alone
// shouldn't be able to silently produce an undissolvable bottle.
const MAX_SOLUBILITY_G_PER_L = 140;

/**
 * "Arquitectura de Bidones" — splits the recipe's total carbs across as
 * many concentrated "fuel" bottles as needed to keep each one at or below
 * both `MAX_BOTTLE_CARB_CONCENTRATION` and the physical `MAX_SOLUBILITY_G_PER_L`
 * dissolution ceiling (whichever is stricter), then covers any remaining
 * fluid target with plain water/electrolyte bottles. On a long ride this
 * often implies refilling the same one or two bottles multiple times from a
 * support car/musette rather than literally carrying every bottle at once.
 * `bottleSizeMl` is the athlete's own real bottle capacity (500/600/750/950ml
 * — configured on their profile), not a fixed assumption. Whenever this
 * pushes `totalBottles` above the athlete's real bottle-cage count,
 * `getReloadStrategy` below automatically forces the Ziploc reload plan —
 * so a recipe that wouldn't fully dissolve in what's actually on the bike
 * never gets recommended at full concentration.
 */
export function getBottlePlan(
  recipe: HomeLabRecipe,
  bottleSizeMl: number = DEFAULT_BOTTLE_SIZE_ML
): BottlePlan {
  const giComfortCapG = bottleSizeMl * MAX_BOTTLE_CARB_CONCENTRATION;
  const solubilityCapG = (bottleSizeMl / 1000) * MAX_SOLUBILITY_G_PER_L;
  const maxCarbsPerBottle = Math.min(giComfortCapG, solubilityCapG);
  // Zero only when pocket food already covers the whole carb target — no
  // fuel bottle needed at all in that case, just plain water/electrolytes.
  const fuelBottleCount =
    recipe.totalCarbsG > 0 ? Math.max(1, Math.ceil(recipe.totalCarbsG / maxCarbsPerBottle)) : 0;
  const totalBottles = Math.max(fuelBottleCount, Math.ceil(recipe.waterMl / bottleSizeMl));
  const waterBottleCount = Math.max(0, totalBottles - fuelBottleCount);
  const maltodextrinGPerBottle =
    fuelBottleCount > 0 ? Math.round(recipe.maltodextrinG / fuelBottleCount) : 0;
  const fructoseGPerBottle =
    fuelBottleCount > 0 ? Math.round(recipe.fructoseG / fuelBottleCount) : 0;

  return {
    bottleSizeMl,
    fuelBottles: {
      count: fuelBottleCount,
      maltodextrinGPerBottle,
      fructoseGPerBottle,
      sodiumMgPerBottle: fuelBottleCount > 0 ? Math.round(recipe.sodiumMg / fuelBottleCount) : 0,
      concentrationPct:
        fuelBottleCount > 0
          ? Math.round(
              ((maltodextrinGPerBottle + fructoseGPerBottle) / bottleSizeMl) * 100 * 10
            ) / 10
          : 0,
    },
    waterBottles: {
      count: waterBottleCount,
    },
    totalBottles,
  };
}

// Fallback cage count — matches `athlete_profiles.bottle_count`'s own
// column default (a standard road bike carries 2 bottle cages).
const DEFAULT_MAX_BOTTLES_ON_BIKE = 2;

export type ReloadStrategy = {
  startingBottleCount: number;
  ziplocBagsCount: number;
  ziplocDose: {
    maltodextrinG: number;
    fructoseG: number;
    sodiumMg: number;
  };
  reloadAtKm: number | null;
  reloadAtHours: number;
  /** More Ziploc sachets than a jersey pocket can reasonably carry and mix
   * on the fly one at a time — see `MAX_PRACTICAL_ZIPLOC_BAGS` below. The
   * math itself is still correct (a small bottle really does need this many
   * refills to carry this much dissolved carb), this just flags that the
   * *plan*, not the arithmetic, needs rethinking. */
  isImpractical: boolean;
};

// Past this many sachets, "mix one in at a stop" stops being a realistic
// mid-ride action regardless of how correct the underlying math is — a
// jersey pocket carrying 5+ pre-measured bags and stopping that many times
// isn't a plan a rider would actually follow. This doesn't cap or hide the
// real number (the athlete still sees exactly how many bottles their
// target genuinely requires), it only flags when the *plan* itself needs
// rethinking (bigger bottles, or shifting more carbs to solid food/gels)
// rather than silently presenting an unworkable reload schedule as normal.
const MAX_PRACTICAL_ZIPLOC_BAGS = 4;

/**
 * "Estrategia de Recarga en Ruta" — whenever the bottle plan needs more
 * bottles than the athlete's real bottle-cage count (`totalBottles` above
 * `maxBottlesOnBike`, from `athlete_profiles.bottle_count` — 1 or 2), the
 * athlete needs a mid-ride stop to refill water and dissolve a pre-measured
 * powder sachet rather than literally carrying every bottle from the
 * start. The reload dose reuses the same per-bottle fuel-bottle figures
 * from `getBottlePlan` (already capped at the safe 8% concentration), so
 * the sachet mixes into a fresh bottle exactly like the ones prepared at
 * the start. The reload point is estimated as the moment the starting
 * bottles would run dry, assuming roughly even consumption across the ride.
 */
export function getReloadStrategy({
  bottlePlan,
  durationHours,
  distanceKm,
  maxBottlesOnBike = DEFAULT_MAX_BOTTLES_ON_BIKE,
}: {
  bottlePlan: BottlePlan;
  durationHours: number;
  distanceKm: number | null;
  maxBottlesOnBike?: number;
}): ReloadStrategy | null {
  if (bottlePlan.totalBottles <= maxBottlesOnBike) return null;

  const extraBottles = bottlePlan.totalBottles - maxBottlesOnBike;
  const reloadAtFraction = maxBottlesOnBike / bottlePlan.totalBottles;

  return {
    startingBottleCount: maxBottlesOnBike,
    ziplocBagsCount: extraBottles,
    ziplocDose: {
      maltodextrinG: bottlePlan.fuelBottles.maltodextrinGPerBottle,
      fructoseG: bottlePlan.fuelBottles.fructoseGPerBottle,
      sodiumMg: bottlePlan.fuelBottles.sodiumMgPerBottle,
    },
    reloadAtKm: distanceKm != null ? Math.round(distanceKm * reloadAtFraction * 10) / 10 : null,
    reloadAtHours: Math.round(durationHours * reloadAtFraction * 100) / 100,
    isImpractical: extraBottles > MAX_PRACTICAL_ZIPLOC_BAGS,
  };
}

export type CarbLoadingPlan = {
  minCarbsG: number;
  maxCarbsG: number;
  guidelines: string[];
};

/** Fixed day-before-event guidance — low-fiber, low-fat/protein choices
 * that maximize carb density without adding gastrointestinal weight or
 * slow-digesting bulk before a big effort. */
const CARB_LOADING_GUIDELINES = [
  "Prioriza arroz blanco, pasta refinada, pan blanco y patata — evita legumbres e integrales, que aportan fibra innecesaria el día antes.",
  "Reduce grasas y proteínas en las comidas principales para dejar sitio a los carbohidratos sin sentirte pesado.",
  "Reparte la carga en 4-5 tomas a lo largo del día en vez de 1-2 comidas copiosas.",
];

/**
 * "Protocolo de Carga de Hidratos Pre-Evento (Día -1)" — the classic
 * 8-10g/kg carb-loading target for the day before a long/target event,
 * maximizing muscle glycogen stores going into the ride.
 */
export function getCarbLoadingTarget(weightKg: number): CarbLoadingPlan {
  return {
    minCarbsG: Math.round(weightKg * 8),
    maxCarbsG: Math.round(weightKg * 10),
    guidelines: CARB_LOADING_GUIDELINES,
  };
}

// Plain-text summary for the "Copiar Receta" button — pasteable as-is into
// WhatsApp, Notes, or read straight off the phone at the kitchen counter,
// so it spells out exact per-bottle grams rather than just totals.
export function formatRecipeForSharing({
  durationHours,
  carbsGPerHour,
  sodiumMgPerHour,
  recipe,
  bottlePlan,
}: {
  durationHours: number;
  carbsGPerHour: number;
  sodiumMgPerHour: number;
  recipe: HomeLabRecipe;
  bottlePlan: Pick<BottlePlan, "fuelBottles" | "waterBottles">;
}): string {
  const lines = [
    "🚴 RECETA DIY — MOTOR METABÓLICO",
    `Duración: ${durationHours}h · ${carbsGPerHour}g/h HC · ${sodiumMgPerHour}mg/h sodio`,
    "",
  ];
  if (bottlePlan.fuelBottles.count > 0) {
    lines.push(
      `🧪 ${bottlePlan.fuelBottles.count > 1 ? "Bidones" : "Bidón"} Fuel Concentrado × ${bottlePlan.fuelBottles.count}`,
      `   ${bottlePlan.fuelBottles.maltodextrinGPerBottle}g maltodextrina · ${bottlePlan.fuelBottles.fructoseGPerBottle}g fructosa · ${getTableSaltGrams(bottlePlan.fuelBottles.sodiumMgPerBottle)}g sal común (${bottlePlan.fuelBottles.sodiumMgPerBottle}mg sodio) / bidón`
    );
  }
  if (bottlePlan.waterBottles.count > 0) {
    lines.push(
      "",
      `💧 ${bottlePlan.waterBottles.count > 1 ? "Bidones" : "Bidón"} Agua / Electrolitos × ${bottlePlan.waterBottles.count}`,
      "   A demanda para completar la hidratación"
    );
  }
  lines.push(
    "",
    `Total: ${recipe.maltodextrinG}g maltodextrina + ${recipe.fructoseG}g fructosa + ${getTableSaltGrams(recipe.sodiumMg)}g sal común (aporta ${recipe.sodiumMg}mg sodio puro) + ${recipe.waterMl}ml agua`
  );
  return lines.join("\n");
}

/**
 * "Ficha técnica" for the "Exportar a Garmin / Wahoo / Strava" button —
 * plain text meant to be pasted into a route description or a
 * head-unit/computer's course notes field, so the reminders stay visible
 * mid-ride instead of only at planning time on the phone.
 */
export function formatGarminExportText({
  carbsGPerHour,
  sodiumMgPerHour,
  milestones,
  reloadStrategy,
}: {
  carbsGPerHour: number;
  sodiumMgPerHour: number;
  milestones: NutritionMilestone[];
  reloadStrategy: ReloadStrategy | null;
}): string {
  const lines = [
    "📟 FICHA DE NUTRICIÓN — MOTOR METABÓLICO",
    "",
    "⏰ ALERTA DE FRECUENCIA",
    "Configura una alarma cada 15 min: 3 sorbos de Fuel + 1 sorbo de agua.",
    "",
    "🔋 OBJETIVO FISIOLÓGICO",
    `${carbsGPerHour} g/h de carbohidratos · ${sodiumMgPerHour} mg/h de sodio.`,
  ];

  const milestoneLines = milestones.map((milestone) => {
    const where = milestone.atKm != null ? `Km ${milestone.atKm}` : `Hora ${milestone.atHours}`;
    return `${where}: ${milestone.label}`;
  });
  if (reloadStrategy) {
    const where =
      reloadStrategy.reloadAtKm != null
        ? `Km ${reloadStrategy.reloadAtKm}`
        : `Hora ${reloadStrategy.reloadAtHours}`;
    milestoneLines.push(`${where}: Parada Ziploc / rellenar bidón`);
  }

  if (milestoneLines.length > 0) {
    lines.push("", "📍 HITOS DE NUTRICIÓN", ...milestoneLines);
  }

  return lines.join("\n");
}

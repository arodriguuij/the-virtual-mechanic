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

export type ExperienceMode = "standard" | "advanced";
export type PreRideGlycogenLoad = "normal" | "high" | "fasted";
export type LastMealTiming = "more_than_3h" | "1_2h" | "less_than_30m";

export type SweatRate = "low" | "medium" | "high";

// "competition" added alongside the original 5 bands so the Fueling
// Planner's unified "Intensidad Objetivo" selector (Ruta/GPX and Entreno
// Manual both now share the exact same 6-option list) has a real, distinct
// value for "Competición / Carrera" rather than silently reusing `vo2max`'s
// own value under a second label — a race's "variabilidad alta y máximo
// vaciado metabólico" is functionally indistinguishable from `vo2max` once
// `getCarbOxidationRateGPerHour`'s own bands are applied (both sit at/above
// the 1.1 relative-intensity threshold that already caps out at the 100g/h
// gut-absorption ceiling), so this doesn't change any computed figure in
// practice — it exists so two dropdown options never collide on one
// underlying value (which would make a native `<select>` unable to tell
// them apart on re-render).
export type IntensityLevel = "recovery" | "endurance" | "tempo" | "threshold" | "vo2max" | "competition";

export const intensityLabels: Record<IntensityLevel, string> = {
  recovery: "Recuperación",
  endurance: "Fondo",
  tempo: "Tempo",
  threshold: "Umbral",
  vo2max: "VO2 Max",
  competition: "Competición",
};

/** Assumed %FTP for each named intensity — used by the pre-ride planner,
 * which doesn't have real power data yet. */
const INTENSITY_RELATIVE_FTP: Record<IntensityLevel, number> = {
  recovery: 0.55,
  endurance: 0.7,
  tempo: 0.85,
  threshold: 0.98,
  vo2max: 1.15,
  competition: 1.2,
};

export function getRelativeIntensityFromLevel(level: IntensityLevel): number {
  return INTENSITY_RELATIVE_FTP[level];
}

export function getRelativeIntensity(averageWatts: number, ftp: number): number {
  if (ftp <= 0) return 0;
  return averageWatts / ftp;
}

/** A typical road bike + bottles/accessories — used only to convert the
 * athlete's own bodyweight into a total-system W/kg for the VAM estimate
 * below. Not a real per-athlete field yet (no bike-weight column exists on
 * `athlete_profiles`); a fixed assumption is close enough given every other
 * input here (average climb gradient, descent speed) is already a fixed
 * assumption too. */
const ESTIMATED_BIKE_WEIGHT_KG = 8;
/** Average gradient assumed for the climbing portion of a route, used only
 * to split total distance into climb/descent/flat segments — real routes
 * vary, but ~6% is a reasonable stand-in for a mountain-pass-style climb. */
const AVG_CLIMB_GRADIENT = 0.06;
/** Fixed average descent speed (km/h) — a real descent's safe speed depends
 * heavily on technical difficulty/visibility/traffic, none of which this
 * app has data for, so a single conservative-but-realistic figure stands in
 * for the whole descent segment. */
const DESCENT_SPEED_KMH = 42;
/** Flat +3% covers junctions, traffic lights, and brief braking/regrouping
 * that a pure moving-time physics model doesn't otherwise account for. */
const STOPPAGE_MARGIN = 1.03;

/**
 * Estimated ride moving time from distance + elevation + the rider's own
 * FTP-derived target power — decomposes the route into climb/descent/flat
 * segments (via `AVG_CLIMB_GRADIENT`, mirroring the climb distance for the
 * descent, a reasonable stand-in for a circular/out-and-back ride) rather
 * than one blended distance-plus-elevation-bonus figure, since a ride's
 * intensity (selected `IntensityLevel`, hence target watts) genuinely
 * changes total duration by tens of minutes depending on whether it's an
 * easy Z2 spin or a full-gas group ride at the same FTP — sizing bottles/
 * grams off a stale distance-only or historical-average-speed estimate
 * would silently under- or over-fuel the athlete. Climb time comes from an
 * estimated VAM (vertical meters/hour) scaling with total-system W/kg
 * (rider + `ESTIMATED_BIKE_WEIGHT_KG`); flat time comes from a simplified
 * aerodynamic power law (`v ∝ P^(1/3)`, calibrated so ~200W lands around
 * ~30km/h flat — roughly matching a CdA≈0.3-0.4 flat-road estimate at that
 * power); descent time uses the fixed `DESCENT_SPEED_KMH`. Used to size the
 * fueling window for a saved Strava route (or an uploaded GPX track), which
 * has no real moving-time data of its own yet.
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
  const totalWeightKg = weightKg + ESTIMATED_BIKE_WEIGHT_KG;
  const wPerKg = totalWeightKg > 0 ? targetWatts / totalWeightKg : 0;

  // ~700-800 vertical meters/hour at 2.5 W/kg, scaling with W/kg, clamped
  // between a gentle spin and a pro-level sustained climb.
  const vamMPerHour = Math.min(1800, Math.max(300, wPerKg * 285));
  const climbTimeHours = elevationGainM / vamMPerHour;

  // Split total distance into climb/descent/flat via the average climb
  // gradient assumption, each side capped at half the total distance so a
  // short, very steep route can't imply a climb longer than the ride itself.
  const climbDistanceKm = Math.min(distanceKm / 2, elevationGainM / (AVG_CLIMB_GRADIENT * 1000));
  const descentDistanceKm = climbDistanceKm;
  const flatDistanceKm = Math.max(0, distanceKm - climbDistanceKm - descentDistanceKm);

  const flatSpeedKmh = Math.min(50, Math.max(15, 24 * Math.pow(Math.max(targetWatts, 1) / 100, 0.33)));
  const flatTimeHours = flatDistanceKm / flatSpeedKmh;
  const descentTimeHours = descentDistanceKm / DESCENT_SPEED_KMH;

  const rawTotalHours = climbTimeHours + flatTimeHours + descentTimeHours;
  return rawTotalHours * STOPPAGE_MARGIN;
}

export type ManualTerrain = "flat" | "medium_mountain" | "high_mountain";
export type ManualCalcMode = "time" | "distance";

export interface ManualTerrainOption {
  id: ManualTerrain;
  label: string;
  sublabel: string;
  elevationMPerKm: number;
}

export const MANUAL_TERRAIN_OPTIONS: ManualTerrainOption[] = [
  {
    id: "flat",
    label: "Llano / Rodador",
    sublabel: "~300m D+ / 100km",
    elevationMPerKm: 3,
  },
  {
    id: "medium_mountain",
    label: "Media Montaña",
    sublabel: "~1000m D+ / 100km",
    elevationMPerKm: 10,
  },
  {
    id: "high_mountain",
    label: "Gran Montaña",
    sublabel: ">1800m D+ / 100km",
    elevationMPerKm: 18,
  },
];

export function getProjectedSpeedKmh({
  ftp,
  weightKg,
  intensity = "endurance",
  terrain = "medium_mountain",
}: {
  ftp: number;
  weightKg: number;
  intensity?: IntensityLevel | "";
  terrain?: ManualTerrain;
}): number {
  const terrainOpt = MANUAL_TERRAIN_OPTIONS.find((t) => t.id === terrain) ?? MANUAL_TERRAIN_OPTIONS[1];
  const refDistanceKm = 100;
  const refElevationGainM = refDistanceKm * terrainOpt.elevationMPerKm;
  const effectiveIntensity: IntensityLevel = intensity || "endurance";
  const refDurationHours = estimateRideDurationHours({
    distanceKm: refDistanceKm,
    elevationGainM: refElevationGainM,
    ftp: ftp || 200,
    weightKg: weightKg || 70,
    intensity: effectiveIntensity,
  });
  return refDurationHours > 0 ? Math.round((refDistanceKm / refDurationHours) * 10) / 10 : 25;
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
  balanced: "Balanceado / Neutro",
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

/** Plain-language "which level am I" cue for `/perfil`'s selector cards —
 * what kind of real fueling behavior each range actually corresponds to,
 * since the g/h range alone doesn't tell an athlete which one describes
 * them. */
export const gutTrainingLevelDescriptions: Record<GutTrainingLevel, string> = {
  beginner: "Geles u orígenes ocasionales. Poco entrenamiento digestivo previo.",
  intermediate: "Habituado a ingerir carbohidratos en salidas >2h sin molestias.",
  advanced: "Buena tolerancia entrenada — sostiene mezclas concentradas en rutas largas.",
  pro: "Gut Training activo. Alta tolerancia a mezclas concentradas 1:0.8.",
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
// "Modo Eficiencia Metabólica" (Train Low / entrenamiento en ayunas) — a
// deliberate low-carb-availability session (fat-adaptation, mitochondrial
// biogenesis signaling) needs a *floor*, not the usual intensity-driven
// target: enough carbs to protect immune function/electrolyte balance on a
// long fasted ride, never enough to blunt the metabolic stress the session
// is actually for. Fluid/sodium targets are untouched — dehydration risk
// doesn't care whether the athlete is fueling carbs or not.
export const TRAIN_LOW_TARGET_G_PER_HOUR = 15;
export const TRAIN_LOW_MAX_G_PER_HOUR = 25;

/**
 * Caps the recommended carb intake to Train Low's 0-25g/h electrolyte-only
 * band, overriding whatever the ride's own intensity/gut-cap would otherwise
 * call for — the whole point of the session is restricted carb availability,
 * so a normal recommendation would defeat it.
 */
export function getTrainLowCarbTargetGPerHour(): number {
  return TRAIN_LOW_TARGET_G_PER_HOUR;
}

// Below this, the body's own peripheral vasoconstriction plus low sweat
// output means the usual bottle-concentration ceiling stops being the
// binding constraint — carrying most of the carb load as solid food/gels
// instead avoids forcing down a large volume of cold liquid the athlete
// doesn't feel thirsty enough to want, and avoids "sobrecarga hídrica en
// vejiga" (needing to stop and empty a full bladder) from bottles sized for
// a much higher fluid-loss rate than a cold ride actually produces.
export const EXTREME_COLD_THRESHOLD_C = 8;
// Above this, sweat/sodium loss accelerates past what the ordinary
// heat-humidity slope in `getHeatHumidityMultiplier` already models —
// sodium replacement needs to run at the top of the physiological range,
// and gastric comfort needs a plain-water bottle in reserve for
// termorregulación/aclarado bucal, not just concentrate.
export const EXTREME_HEAT_THRESHOLD_C = 32;
// Floor sodium concentration once heat is genuinely extreme — regardless of
// whether the athlete is also a self-reported salty sweater (whose own
// 1200mg/L figure already sits above this floor and is left untouched).
export const EXTREME_HEAT_MIN_SODIUM_CONCENTRATION_MG_PER_L = 900;

export type ThermalAdaptation = {
  isExtremeCold: boolean;
  isExtremeHeat: boolean;
};

export function getThermalAdaptation(temperatureC: number): ThermalAdaptation {
  return {
    isExtremeCold: temperatureC < EXTREME_COLD_THRESHOLD_C,
    isExtremeHeat: temperatureC > EXTREME_HEAT_THRESHOLD_C,
  };
}

export function getIntakeRecommendationNote(
  avgIntakeGPerHour: number | null,
  gutTrainingLevel: GutTrainingLevel | null
): string {
  if (gutTrainingLevel == null) {
    return "Configura tu nivel de Adaptación Digestiva en el Perfil Fisiológico para desbloquear una recomendación personalizada.";
  }
  const capGPerHour = getGutTrainingCapGPerHour(gutTrainingLevel);
  if (avgIntakeGPerHour == null) {
    return "Todavía no hay suficientes datos de consumo real — registra tu ingesta tras cada salida para desbloquear una recomendación personalizada.";
  }
  if (avgIntakeGPerHour > capGPerHour) {
    return `Tu ingesta real (${avgIntakeGPerHour} g/h) ya supera el techo de tu nivel actual (${capGPerHour} g/h) — es una señal de que tu intestino podría estar listo para subir de nivel de capacidad digestiva.`;
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

/** Plain-language "which one am I" cue for `/perfil`'s sweat-rate selector
 * cards — the same self-reported, visible-evidence framing
 * `is_salty_sweater`'s own checkbox copy already uses ("cercos blancos en
 * el maillot"), so an athlete without a real sweat test can still place
 * themselves confidently. */
export const sweatRateDescriptions: Record<SweatRate, string> = {
  low: "Poca sudoración. Sin marcas de sal en la ropa tras entrenar.",
  medium: "Sudoración estándar. Marcas salinas ligeras en días calurosos.",
  high: "Sudoración abundante o muy salada. Marcas blancas evidentes en maillot y cintas del casco.",
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

/** "Techo Práctico de Reposición de Sodio" — real sweat-sodium concentration
 * varies wildly (400-1500+ mg/L) and scales with fluid volume in a way that
 * a straight concentration × volume model can recommend practically
 * impossible hourly targets on a long, hot ride for a genuine salty
 * sweater (e.g. >2000mg/h, >8000mg over a whole route — far more sodium
 * than the gut can absorb, or than any real dosing schedule could actually
 * deliver). Mainstream cycling-nutrition guidance caps *recommended
 * intake* at a sustainable 400-800mg Na+/h regardless of the athlete's own
 * exact sweat concentration — this is the practical band the
 * concentration-based estimate below gets clamped into, rather than a flat
 * number disconnected from the ride's real conditions. */
export const SODIUM_TARGET_MIN_MG_PER_HOUR = 400;
export const SODIUM_TARGET_MAX_MG_PER_HOUR = 800;

export function getSodiumLossMgPerHour(
  fluidLossMlPerHour: number,
  isSaltySweater: boolean = false,
  // "Adaptación Térmica Extrema" — above `EXTREME_HEAT_THRESHOLD_C`, sodium
  // replacement is floored at `EXTREME_HEAT_MIN_SODIUM_CONCENTRATION_MG_PER_L`
  // regardless of the athlete's own sweater category — a genuine salty
  // sweater's 1200mg/L already sits above that floor and is unaffected;
  // a non-salty-sweater's usual 700mg/L is bumped up to it.
  extremeHeat: boolean = false
): number {
  let concentration = isSaltySweater
    ? SALTY_SWEATER_SODIUM_CONCENTRATION_MG_PER_L
    : SODIUM_CONCENTRATION_MG_PER_L;
  if (extremeHeat) {
    concentration = Math.max(concentration, EXTREME_HEAT_MIN_SODIUM_CONCENTRATION_MG_PER_L);
  }
  const physiologicalEstimateMgPerHour = (fluidLossMlPerHour / 1000) * concentration;
  return Math.round(
    Math.min(
      SODIUM_TARGET_MAX_MG_PER_HOUR,
      Math.max(SODIUM_TARGET_MIN_MG_PER_HOUR, physiologicalEstimateMgPerHour)
    )
  );
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
  | "soda"
  | "pastry"
  | "banana"
  | "milk_bread"
  | "energy_bar"
  | "rice_cake"
  | "dates"
  | "gummies"
  | "gel_small"
  | "gel_standard"
  | "gel_high"
  | "gel_ultra";

export const pocketFoodLabels: Record<PocketFoodItemType, string> = {
  // "Refresco"/"Bollería" — the two most common real-world café/gasolinera
  // stop purchases (Coca-Cola/Fanta, a croissant/donut/napolitana), added
  // alongside the carried-from-pocket catalog above so a stop's actual
  // purchase counts toward CUBIERTO the same way any other catalog item
  // does — same "illustrative fixed dose, not a real nutrition database"
  // convention as every other entry here.
  soda: "🥤 Refresco / Lata",
  pastry: "🥐 Bollería",
  banana: "🍌 Plátano",
  // "Logística de Salida (Carga desde Casa)" — a plain-carb bakery item
  // (a milk roll, membrillo/quince paste on bread), the third of the 3
  // real-food items Card 04 shows by default alongside Plátano/Refresco —
  // see `POCKET_FOOD_TYPES`/`DEFAULT_VISIBLE_POCKET_FOOD_TYPES` in
  // `components/fueling-planner.tsx`.
  milk_bread: "🥛 Pan de leche / Membrillo",
  energy_bar: "🍫 Barrita energética",
  rice_cake: "🍙 Bollo de arroz / Rice cake",
  dates: "🌴 Dátiles / Fruta desecada",
  gummies: "🍬 Gominolas / Haribo (bolsita)",
  gel_small: "🧃 Gel pequeño",
  gel_standard: "🧃 Gel estándar",
  gel_high: "🧃 Gel alta carga / Hydro",
  // "Productos Comerciales de Alta Densidad" — a full commercial sachet
  // (Maurten 320 / SiS Beta Fuel, etc.), dissolved directly into a bottle
  // rather than eaten from the pocket the way the smaller gel tiers above
  // are — same fast-absorption "gel" bucket for timing-timeline purposes
  // (see `generateTimingTimeline`), just at a much higher single dose.
  gel_ultra: "🧃 Sobre comercial 80g HC (Maurten / Beta Fuel)",
};

export const pocketFoodCarbsG: Record<PocketFoodItemType, number> = {
  soda: 35,
  pastry: 35,
  banana: 22,
  milk_bread: 25,
  energy_bar: 30,
  rice_cake: 25,
  dates: 20,
  gummies: 20,
  gel_small: 25,
  gel_standard: 30,
  gel_high: 45,
  gel_ultra: 80,
};

/** `customCarbsG` covers anything outside the fixed catalog — a rider's own
 * homemade snack, a brand not listed, etc. — entered as a free grams value
 * rather than forced through one of the preset items. `includeCaffeine` is
 * a plain modifier on whatever gel(s) are selected, not a fourth gel-catalog
 * entry — "no duplicar ítems de geles en el catálogo": a rider ticks it once
 * to say at least one of their selected gels/food carries caffeine, and
 * `generateTimingTimeline` below only schedules a caffeine milestone at all
 * when this is `true`. */
export type PocketFoodSelection = Partial<Record<PocketFoodItemType, number>> & {
  customCarbsG?: number;
  includeCaffeine?: boolean;
};

export function getPocketFoodTotalCarbsG(selection: PocketFoodSelection): number {
  // `includeCaffeine` is a boolean modifier, not a catalog item — pulled out
  // here (alongside `customCarbsG`) purely so it can't leak into `items`
  // below as a bogus `pocketFoodCarbsG["includeCaffeine"] * true` term,
  // which would otherwise poison `catalogTotal` into `NaN`.
  const { customCarbsG, includeCaffeine, ...items } = selection;
  void includeCaffeine;
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
  // Same `includeCaffeine` exclusion as `getPocketFoodTotalCarbsG` above —
  // not a catalog item, must never fall into `selectedItems` below.
  const { customCarbsG, includeCaffeine, ...selectedItems } = selection;
  void includeCaffeine;
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

/** A "drink a small sip" reminder is easy to lose track of mid-ride — a
 * rider thinks in whole bottles, not milliliters, so the pacing guidance is
 * framed around finishing one full bottle rather than a vague sip count.
 * `bottleMl` is the athlete's own real `athlete_profiles.bottle_capacity_ml`
 * (550/750/950), not a fixed reference size — a rider running 950ml
 * bottles genuinely needs longer between refills than one running 550ml
 * bottles at the same sweat rate, so hardcoding a single reference size
 * would silently mismatch the "1 bidón" the UI actually shows next to it.
 * `DEFAULT_HYDRATION_BOTTLE_ML` is only a fallback for a caller with no real
 * bottle size on hand. Floored at a sane minimum so a pathologically high
 * fluid-loss rate can't collapse the interval to an unreadable "every
 * 1 min." */
const DEFAULT_HYDRATION_BOTTLE_ML = 550;
const HYDRATION_INTERVAL_MIN_MINUTES = 5;

/**
 * "Frecuencia Hídrica" — how often (in minutes) to finish one full bottle
 * (`bottleMl`, the athlete's real bottle capacity), scaled inversely to the
 * athlete's actual fluid-loss rate: `(bottleMl / mlPerHour) × 60`. A higher
 * sweat rate means that same bottle needs to go faster, not that the
 * athlete should switch to smaller, more frequent sips.
 */
export function getHydrationIntervalMinutes(
  fluidLossMlPerHour: number,
  bottleMl: number = DEFAULT_HYDRATION_BOTTLE_ML
): number {
  // Never reachable in practice (every sweat-rate baseline is >= 500ml/h
  // before any heat/humidity multiplier is even applied — see
  // `SWEAT_RATE_BASE_ML_PER_HOUR`), but a defensive floor against a
  // genuinely zero/negative rate rather than a `1 / 0` blow-up.
  if (fluidLossMlPerHour <= 0) return 60;
  return Math.max(HYDRATION_INTERVAL_MIN_MINUTES, Math.round((bottleMl / fluidLossMlPerHour) * 60));
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
// bug this floor fixes: a route whose elevation peak sits near the start,
// e.g. a climb straight out of the departure point, used to time caffeine as
// early as km 5 / minute 12, which defeats the point of a late-ride alertness
// boost) is never allowed. Absent a real late climb to time against, the
// suggestion lands 45 minutes before the ride's own finish instead (see
// `CAFFEINE_LEAD_MINUTES`), still never earlier than this floor.
const CAFFEINE_WINDOW_START_FRACTION = 0.65;
// A route's real elevation peak only overrides the fixed window when it
// falls in the second half of the ride — a genuine late climb is worth
// timing caffeine against directly; an early one is not a reason to move
// caffeine earlier than the window above.
const LATE_CLIMB_MIN_FRACTION = 0.5;

// "Sensibilidad a Cafeína e Horario Nocturno" — a caffeine hit landing after
// this local hour risks disrupting the athlete's night sleep, which matters
// more than the marginal late-ride alertness boost it would otherwise give.
export const CAFFEINE_CURFEW_HOUR = 18;
export const CAFFEINE_CURFEW_MINUTE = 30;

/**
 * Whether the ride's estimated arrival time falls at/after the caffeine
 * curfew (18:30 local) — when `true`, callers should drop every caffeine
 * milestone regardless of what the pocket-food selection or route profile
 * would otherwise schedule.
 */
export function isPastCaffeineCurfew(arrivalDate: Date): boolean {
  const hours = arrivalDate.getHours();
  const minutes = arrivalDate.getMinutes();
  return hours > CAFFEINE_CURFEW_HOUR || (hours === CAFFEINE_CURFEW_HOUR && minutes >= CAFFEINE_CURFEW_MINUTE);
}

// "Rutas Multipuerto de Alta Montaña" — a real mountain pass, not just a
// rolling bump: at least this much cumulative climb since the last valley...
const MOUNTAIN_PASS_MIN_GAIN_M = 350;
// ...confirmed by at least this much subsequent descent off the summit,
// so a brief false plateau mid-climb doesn't get counted as its own
// separate pass.
const MOUNTAIN_PASS_MIN_DESCENT_CONFIRM_M = 250;
// Caffeine is only fractioned across multiple passes on a ride long enough
// for two separate hard efforts to plausibly need it — matches the
// carb-loading module's own "long/target ride" threshold.
export const MULTI_PASS_CAFFEINE_MIN_DURATION_HOURS = 3.5;

export type MountainPass = {
  distanceFraction: number;
  elevationM: number;
  /** Cumulative climb (m) from the preceding valley/base to this summit. */
  gainM: number;
};

/**
 * Scans an elevation profile (ordered by distance along the route) for
 * genuine mountain passes — a real climb-then-descend cycle of at least
 * `MOUNTAIN_PASS_MIN_GAIN_M` gained and `MOUNTAIN_PASS_MIN_DESCENT_CONFIRM_M`
 * subsequently lost, not every local wiggle in the trace. Heuristic, same
 * "not a full topographic analysis" convention as the rest of this file —
 * good enough to tell "this route has multiple real summits" from "this
 * route has one," which is all `generateTimingTimeline`'s caffeine-splitting
 * logic below needs.
 */
export function detectMountainPasses(
  profile: { distanceFraction: number; elevationM: number }[]
): MountainPass[] {
  if (profile.length < 3) return [];
  const passes: MountainPass[] = [];

  let baseElevation = profile[0].elevationM;
  let peakElevation = profile[0].elevationM;
  let peakIndex = 0;

  for (let i = 1; i < profile.length; i++) {
    const elevationM = profile[i].elevationM;
    if (elevationM > peakElevation) {
      peakElevation = elevationM;
      peakIndex = i;
      continue;
    }
    if (peakElevation - elevationM >= MOUNTAIN_PASS_MIN_DESCENT_CONFIRM_M) {
      if (peakElevation - baseElevation >= MOUNTAIN_PASS_MIN_GAIN_M) {
        passes.push({
          distanceFraction: profile[peakIndex].distanceFraction,
          elevationM: Math.round(peakElevation),
          gainM: Math.round(peakElevation - baseElevation),
        });
      }
      // Start tracking the next climb from this newly-confirmed descent.
      baseElevation = elevationM;
      peakElevation = elevationM;
      peakIndex = i;
    } else if (elevationM < baseElevation) {
      baseElevation = elevationM;
    }
  }

  return passes;
}

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
  bottleCapacityMl = DEFAULT_HYDRATION_BOTTLE_ML,
  mountainPasses = null,
}: {
  selection: PocketFoodSelection;
  durationHours: number;
  distanceKm: number | null;
  fluidLossMlPerHour: number;
  peakFraction?: number | null;
  /** The athlete's real `athlete_profiles.bottle_capacity_ml` — what the
   * hydration-pacing line actually paces against, see
   * `getHydrationIntervalMinutes` above. */
  bottleCapacityMl?: number;
  /** "Rutas Multipuerto de Alta Montaña" — when at least 2 real summits were
   * detected (`detectMountainPasses`) and the ride is long enough
   * (`MULTI_PASS_CAFFEINE_MIN_DURATION_HOURS`), caffeine is fractioned into
   * two ~100mg doses (before the first pass, before the final pass) instead
   * of the usual single late-ride dose. */
  mountainPasses?: MountainPass[] | null;
}): TimingTimeline {
  const { customCarbsG, includeCaffeine, ...items } = selection;
  const solidTypes = new Set<PocketFoodItemType>([
    "soda",
    "pastry",
    "banana",
    "milk_bread",
    "energy_bar",
    "rice_cake",
    "dates",
    "gummies",
  ]);
  const gelTypes = new Set<PocketFoodItemType>(["gel_small", "gel_standard", "gel_high", "gel_ultra"]);

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

  // Caffeine is never scheduled on its own — it's a modifier on whatever
  // gel/food the athlete actually ticked "Incluye cafeína" for (see
  // `PocketFoodSelection.includeCaffeine`), not an automatic milestone tied
  // to duration alone. No caffeine item selected → no milestone, regardless
  // of how long the ride is.
  if (includeCaffeine && durationHours >= CAFFEINE_MIN_DURATION_HOURS) {
    const leadFraction = CAFFEINE_LEAD_MINUTES / 60 / durationHours;
    const hasMultiplePasses =
      (mountainPasses?.length ?? 0) >= 2 && durationHours > MULTI_PASS_CAFFEINE_MIN_DURATION_HOURS;

    if (hasMultiplePasses && mountainPasses) {
      // "Cafeína Fraccionada" — one ~100mg dose ahead of the first summit,
      // a second ~100mg dose ahead of the final one, instead of one bigger
      // dose late in the ride. Each still respects the same 65% window floor
      // as the single-dose case below (a first pass early in a long ride
      // shouldn't push its own dose earlier than that).
      const firstPass = mountainPasses[0];
      const lastPass = mountainPasses[mountainPasses.length - 1];
      entries.push(
        makeTimingEntry(
          "caffeine",
          "Cafeína (~100mg) — antes del Puerto 1",
          Math.max(0.05, firstPass.distanceFraction - leadFraction),
          durationHours,
          distanceKm
        )
      );
      entries.push(
        makeTimingEntry(
          "caffeine",
          "Cafeína (~100mg) — antes del puerto final",
          Math.max(CAFFEINE_WINDOW_START_FRACTION, lastPass.distanceFraction - leadFraction),
          durationHours,
          distanceKm
        )
      );
    } else {
      const hasLateClimb = peakFraction != null && peakFraction >= LATE_CLIMB_MIN_FRACTION;
      // Mountain routes: 45 minutes before the real elevation peak. Flat
      // routes/Entreno Manual (no late climb to target): 45 minutes before the
      // ride's own finish instead — either way never earlier than the 65%
      // floor, which protects a short ride (or an early climb) from placing
      // caffeine too soon and defeating the point of a late-ride alertness
      // boost.
      const fraction = hasLateClimb
        ? Math.max(CAFFEINE_WINDOW_START_FRACTION, peakFraction - leadFraction)
        : Math.max(CAFFEINE_WINDOW_START_FRACTION, 1 - leadFraction);
      entries.push(
        makeTimingEntry("caffeine", "Toma de cafeína (~100-200mg)", fraction, durationHours, distanceKm)
      );
    }
  }

  entries.sort((a, b) => a.atMinutes - b.atMinutes);

  return {
    hydrationIntervalMinutes: getHydrationIntervalMinutes(fluidLossMlPerHour, bottleCapacityMl),
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
  const totalCarbsGRounded = Math.round(totalCarbsG);
  // Rounding `maltodextrinG`/`fructoseG` independently doesn't guarantee
  // they sum back to `totalCarbsGRounded` (e.g. 0.5g total split ~0.33/0.17
  // rounds to 0g + 0g, silently losing the whole gram) — deriving the
  // fructose share by subtracting the rounded maltodextrin from the
  // *already-rounded* total instead guarantees the two always sum exactly
  // to the recipe's own `totalCarbsG`, matching what the athlete actually
  // measures out. `getMaltodextrinFraction` always returns a fraction ≤ 1,
  // so `maltodextrinGRounded` can never exceed `totalCarbsGRounded` (round
  // is monotonic), meaning `fructoseGRounded` can never go negative.
  const maltodextrinGRounded = Math.round(
    totalCarbsG * getMaltodextrinFraction(carbsGPerHour, forceHighCarbRatio)
  );
  const fructoseGRounded = totalCarbsGRounded - maltodextrinGRounded;

  return {
    maltodextrinG: maltodextrinGRounded,
    fructoseG: fructoseGRounded,
    sodiumMg: Math.round(sodiumMgPerHour * durationHours),
    waterMl: Math.round(fluidLossMlPerHour * durationHours),
    totalCarbsG: totalCarbsGRounded,
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
 * "Ventana de Recuperación Bifásica" — splits the athlete's *full* net carb
 * debt (`RecoveryDebt.carbsDebtG`, before `getMacroRecoveryTarget`'s own
 * 1.2g/kg calorie-ceiling cap) across the two windows that actually matter
 * physiologically, rather than handing over one lump figure the athlete has
 * to decide when to eat. Deliberately the *uncapped* debt, not
 * `recoveryTarget.carbsG` — an earlier version split the capped figure,
 * which meant phase1+phase2 could silently sum to less than the "Deuda Neta
 * a Reponer" figure already shown in the Balance Neto section above it
 * whenever the cap actually bound (a big debt on a small athlete), reading
 * as if the two sections disagreed about the same number. Protein is
 * untouched by this split (see `getMacroRecoveryTarget`'s own rationale —
 * it's about muscle repair, not the carb debt) and rides entirely in phase
 * 2, since spreading protein across an all-liquid phase 1 dose isn't
 * standard post-exercise practice the way fast carbs are.
 */
export function getBiphasicRecoveryTarget({
  carbsDebtG,
  proteinG,
}: {
  carbsDebtG: number;
  proteinG: number;
}): BiphasicRecoveryTarget {
  const phase1CarbsG = Math.round(carbsDebtG * RECOVERY_PHASE_1_CARB_FRACTION);
  return {
    phase1: {
      carbsG: phase1CarbsG,
      windowLabel: "0-45 min · inmediata",
    },
    phase2: {
      carbsG: carbsDebtG - phase1CarbsG,
      proteinG,
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
 * distress — independent of (and looser than) `getBaseBottleRecipe`'s own
 * fixed 8% concentration below, which already keeps every generated recipe
 * well under this in practice; this constant exists so the UI can surface
 * the *actual* number and warn explicitly rather than relying on that being
 * invisible and assumed. */
export const HYPERTONIC_THRESHOLD_PCT = 12;

// Fallback bottle size when the athlete hasn't configured their real
// equipment yet — matches `athlete_profiles.bottle_capacity_ml`'s own
// column default, kept as a literal here so this file has no dependency on
// the DB schema.
const DEFAULT_BOTTLE_SIZE_ML = 750;

// "Receta Base Dual" — the one reference DIY mix concentration this app
// recommends for a single fuel bottle: 44g HC per 550ml (24g maltodextrin +
// 20g fructose, a fixed 1.2:1 ratio), an 8% carbohydrate concentration
// (44/550 = 0.08 g HC/ml) comfortably under the ~10-12% threshold widely
// cited for hypertonic-solution GI distress (`HYPERTONIC_THRESHOLD_PCT`
// above) and well under the point where maltodextrin/fructose powder stops
// fully dissolving in cold water. Deliberately a *fixed* ratio, not the
// ride's own intensity-tiered `getMaltodextrinFraction` split — this is
// what one physically pre-measured bottle/Ziploc dose always contains once
// mixed, independent of how hard the ride is; the ride's own carb rate only
// ever decides *how many* of these standard doses are needed, never what's
// in each one.
const BASE_BOTTLE_ML = 550;
const BASE_BOTTLE_MALTODEXTRIN_G = 24;
const BASE_BOTTLE_FRUCTOSE_G = 20;

export type BaseBottleRecipe = {
  maltodextrinG: number;
  fructoseG: number;
  totalCarbsG: number;
};

/** Scales the base 44g/550ml dual recipe linearly to any real bottle
 * capacity — `athlete_profiles.bottle_capacity_ml` (550/750/950ml, see
 * "Estandarización Unificada de Bidones") or a one-off custom volume. Each
 * component is rounded independently to 1 decimal place (matching the
 * reference table this was specified against exactly: 750ml → 32.7g malto
 * + 27.3g fructose = 60g HC; 950ml → 41.5g malto + 34.5g fructose = 76g HC,
 * not a rounding of the total split 1.2:1 afterward), so `totalCarbsG` is
 * always `maltodextrinG + fructoseG`, never a separately-rounded third
 * figure that could drift from the other two. Whole-gram rounding was the
 * original precision here; 1-decimal is what the current reference table
 * asks for, and matters for 750/950ml specifically — at 550ml (scale = 1)
 * both roundings agree (24g/20g exactly). */
// "Adaptación Térmica Extrema — Frío" — below `EXTREME_COLD_THRESHOLD_C`,
// the mandatory bottle concentration is reduced by this fraction (more of
// the ride's carb target has to come from pocket food/gels instead), rather
// than forcing down the usual full-strength mix in cold weather.
export const COLD_WEATHER_CONCENTRATION_SCALE = 0.6;

export function getBaseBottleRecipe(
  bottleSizeMl: number,
  concentrationScale: number = 1
): BaseBottleRecipe {
  const scale = (bottleSizeMl / BASE_BOTTLE_ML) * concentrationScale;
  const maltodextrinG = Math.round(BASE_BOTTLE_MALTODEXTRIN_G * scale * 10) / 10;
  const fructoseG = Math.round(BASE_BOTTLE_FRUCTOSE_G * scale * 10) / 10;
  return { maltodextrinG, fructoseG, totalCarbsG: Math.round((maltodextrinG + fructoseG) * 10) / 10 };
}

/**
 * "Arquitectura de Bidones" — splits the recipe's total carbs across as
 * many standard "fuel" bottles as needed, each one always dosed at the
 * *fixed* `getBaseBottleRecipe` concentration for the athlete's real
 * bottle size (never a proportional share of the ride's own total — see
 * that function's own doc comment), then covers any remaining fluid target
 * with plain water/electrolyte bottles. On a long ride this often implies
 * refilling the same one or two bottles multiple times from a support car/
 * musette rather than literally carrying every bottle at once.
 * `bottleSizeMl` is the athlete's own real bottle capacity (550/750/950ml —
 * configured on their profile), not a fixed assumption. Whenever
 * this pushes `totalBottles` above the athlete's real bottle-cage count,
 * `getReloadStrategy` below automatically forces the Ziploc reload plan.
 * Sodium is the one figure still derived from the *ride's own* target
 * (`recipe.sodiumMg`, itself driven by the athlete's real sweat rate/
 * salty-sweater flag — see `getSodiumLossMgPerHour`) divided evenly across
 * however many bottles this now computes, rather than a fixed per-bottle
 * salt figure — sodium loss is genuinely athlete- and duration-specific in
 * a way the carb dose intentionally isn't.
 */
export function getBottlePlan(
  recipe: HomeLabRecipe,
  bottleSizeMl: number = DEFAULT_BOTTLE_SIZE_ML,
  options: {
    /** "Adaptación Térmica Extrema — Frío": scales every fuel bottle's
     * concentration down (`COLD_WEATHER_CONCENTRATION_SCALE`), which in turn
     * needs more (weaker) bottles for the same total carb target — pushing
     * more of the ride's carbs toward pocket food/gels instead of a fully
     * concentrated bottle in cold weather. */
    coldWeatherReduction?: boolean;
    /** "Adaptación Térmica Extrema — Calor": guarantees at least this many
     * of the resulting bottles are plain water, even when the recipe's own
     * fuel-bottle count alone would already cover the fluid target — a
     * genuinely hot ride needs a pure-water bottle in reserve for
     * termorregulación/aclarado bucal, not just concentrate. */
    minWaterBottles?: number;
  } = {}
): BottlePlan {
  const { coldWeatherReduction = false, minWaterBottles = 0 } = options;
  const baseRecipe = getBaseBottleRecipe(
    bottleSizeMl,
    coldWeatherReduction ? COLD_WEATHER_CONCENTRATION_SCALE : 1
  );
  // Zero only when pocket food already covers the whole carb target — no
  // fuel bottle needed at all in that case, just plain water/electrolytes.
  const fuelBottleCount =
    recipe.totalCarbsG > 0 ? Math.max(1, Math.ceil(recipe.totalCarbsG / baseRecipe.totalCarbsG)) : 0;
  let totalBottles = Math.max(fuelBottleCount, Math.ceil(recipe.waterMl / bottleSizeMl));
  let waterBottleCount = Math.max(0, totalBottles - fuelBottleCount);
  if (waterBottleCount < minWaterBottles) {
    waterBottleCount = minWaterBottles;
    totalBottles = fuelBottleCount + waterBottleCount;
  }

  return {
    bottleSizeMl,
    fuelBottles: {
      count: fuelBottleCount,
      maltodextrinGPerBottle: fuelBottleCount > 0 ? baseRecipe.maltodextrinG : 0,
      fructoseGPerBottle: fuelBottleCount > 0 ? baseRecipe.fructoseG : 0,
      sodiumMgPerBottle: fuelBottleCount > 0 ? Math.round(recipe.sodiumMg / fuelBottleCount) : 0,
      concentrationPct:
        fuelBottleCount > 0 ? Math.round((baseRecipe.totalCarbsG / bottleSizeMl) * 100 * 10) / 10 : 0,
    },
    waterBottles: {
      count: waterBottleCount,
    },
    totalBottles,
  };
}

export type ElectrolyteRecommendation = {
  type: "estandar" | "calor";
  label: "Mix Estándar" | "Mix Calor";
  saltGrams: number;
  sodiumMg: number;
};

/**
 * Cálculo de Concentración de Electrolitos por Tamaño de Bidón (Mix Estándar vs Mix Calor).
 * - isHotWeather === false (<25°C & sudor normal): (bottleCapacityMl / 550) * 2.0g sales (~500mg Na+ / 550ml).
 * - isHotWeather === true (≥25°C o tasa de sudoración alta): (bottleCapacityMl / 550) * 4.5g sales (~1125mg Na+ / 550ml).
 */
export function getElectrolyteRecommendation(
  bottleCapacityMl: number,
  isHotWeather: boolean
): ElectrolyteRecommendation {
  const ratio = bottleCapacityMl / 550;
  if (isHotWeather) {
    const saltGrams = Math.round(ratio * 4.5 * 10) / 10;
    const sodiumMg = Math.round(saltGrams * 250);
    return {
      type: "calor",
      label: "Mix Calor",
      saltGrams,
      sodiumMg,
    };
  }
  const saltGrams = Math.round(ratio * 2.0 * 10) / 10;
  const sodiumMg = Math.round(saltGrams * 250);
  return {
    type: "estandar",
    label: "Mix Estándar",
    saltGrams,
    sodiumMg,
  };
}

// Fallback cage count — matches `athlete_profiles.bottle_count`'s own
// column default (a standard road bike carries 2 bottle cages).
const DEFAULT_MAX_BOTTLES_ON_BIKE = 2;

export type ReloadStrategy = {
  /** Fuel/mix bottles carried from the start — capped at the athlete's real
   * cage count, prioritized over plain water since concentrate can't be
   * replicated at a roadside fountain. */
  startingFuelBottleCount: number;
  /** Plain water bottles carried from the start, filling whatever cage
   * slots the fuel bottles above didn't already use. */
  startingWaterBottleCount: number;
  /** `startingFuelBottleCount + startingWaterBottleCount` — always equal to
   * the athlete's real cage count whenever a reload strategy exists at all.
   * Kept for callers that only care about the total, not the split. */
  startingBottleCount: number;
  /** Extra *fuel* bottles beyond what the cages can carry — the only thing
   * that genuinely needs a pre-measured Ziploc powder sachet, since
   * maltodextrin/fructose/sodium concentrate isn't available at a fountain.
   * Deliberately independent of any extra plain-water need (see
   * `waterRefillCount` below) — carrying more water than fits on the bike
   * is a fountain stop, not a reason to mix more powder. */
  ziplocBagsCount: number;
  ziplocDose: {
    maltodextrinG: number;
    fructoseG: number;
    sodiumMg: number;
  };
  /** Extra plain-water bottles beyond what the cages can carry — refillable
   * at any fountain/water point along the route, no pre-measured sachet
   * needed at all. */
  waterRefillCount: number;
  /** Approximate liters implied by `waterRefillCount`, for a plain-language
   * "~X L de agua" readout. */
  waterRefillLiters: number;
  reloadAtKm: number | null;
  reloadAtHours: number;
  /** More Ziploc *powder* sachets than a jersey pocket can reasonably carry
   * and mix on the fly one at a time — see `MAX_PRACTICAL_ZIPLOC_BAGS`
   * below. Driven only by `ziplocBagsCount`, never by `waterRefillCount` —
   * stopping at a fountain several times is a normal, practical plan on its
   * own. The math itself is still correct (a small bottle really does need
   * this many refills to carry this much dissolved carb), this just flags
   * that the *plan*, not the arithmetic, needs rethinking. */
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
 * overflow splits into two physiologically distinct cases that used to be
 * conflated into one undifferentiated "extra bottle" count: overflow *fuel*
 * bottles genuinely need a mid-ride stop to dissolve a pre-measured Ziploc
 * powder sachet (concentrate isn't available at a fountain), while overflow
 * *plain water* bottles just need a fountain/water-point refill — no powder
 * at all. Fuel bottles get priority for the limited cage slots (they carry
 * something a fountain can't replace); any slots left over go to water.
 * The reload dose reuses the same per-bottle fuel-bottle figures from
 * `getBottlePlan` (already capped at the safe concentration), so the
 * sachet mixes into a fresh bottle exactly like the ones prepared at the
 * start. The reload point is estimated as the moment the starting bottles
 * — every cage slot mounted at departure, fuel and water alike, since both
 * carry drinkable liquid — would actually run dry at the athlete's real
 * fluid consumption rate.
 */
export function getReloadStrategy({
  bottlePlan,
  durationHours,
  distanceKm,
  fluidLossMlPerHour,
  maxBottlesOnBike = DEFAULT_MAX_BOTTLES_ON_BIKE,
}: {
  bottlePlan: BottlePlan;
  durationHours: number;
  distanceKm: number | null;
  /** The athlete's real fluid-loss rate (ml/h) — what actually paces the
   * starting bottles running dry, see the `reloadAtKm`/`reloadAtHours`
   * bug-fix note below. */
  fluidLossMlPerHour: number;
  maxBottlesOnBike?: number;
}): ReloadStrategy | null {
  if (bottlePlan.totalBottles <= maxBottlesOnBike) return null;

  const startingFuelBottleCount = Math.min(bottlePlan.fuelBottles.count, maxBottlesOnBike);
  const extraFuelBottles = bottlePlan.fuelBottles.count - startingFuelBottleCount;
  const remainingCageSlots = maxBottlesOnBike - startingFuelBottleCount;
  const startingWaterBottleCount = Math.min(bottlePlan.waterBottles.count, remainingCageSlots);
  const extraWaterBottles = bottlePlan.waterBottles.count - startingWaterBottleCount;

  // Bug fix: the reload point used to be estimated as
  // `maxBottlesOnBike / bottlePlan.totalBottles` of the ride's duration/
  // distance — a fraction of *bottle count*, which conflates concentrated
  // fuel bottles (sized by carb concentration, not fluid volume) with plain
  // water bottles and silently skews the estimate whenever the recipe needs
  // many small fuel bottles (e.g. a 500ml bottle at a high carb target).
  // Verified live: a 108km ride on 2×500ml starting bottles at a real
  // ~0.99L/h sweat rate flagged a reload at ~Km 26 under the old formula —
  // less than a third of the way to when 2 full 500ml bottles (1.0L) would
  // actually run dry at that rate. Fixed to size the reload point off the
  // real total liquid volume mounted at departure (every starting cage,
  // whether it holds mix or plain water) against the athlete's actual
  // fluid-loss rate, exactly like `getHydrationIntervalMinutes` already
  // paces a single-bottle sip reminder the same way.
  const startingCapacityMl = maxBottlesOnBike * bottlePlan.bottleSizeMl;
  const hoursUntilBottlesEmpty =
    fluidLossMlPerHour > 0 ? startingCapacityMl / fluidLossMlPerHour : durationHours;
  const reloadAtHoursClamped = Math.min(durationHours, hoursUntilBottlesEmpty);
  const avgSpeedKmh = distanceKm != null && durationHours > 0 ? distanceKm / durationHours : null;

  return {
    startingFuelBottleCount,
    startingWaterBottleCount,
    startingBottleCount: startingFuelBottleCount + startingWaterBottleCount,
    ziplocBagsCount: extraFuelBottles,
    ziplocDose: {
      maltodextrinG: extraFuelBottles > 0 ? bottlePlan.fuelBottles.maltodextrinGPerBottle : 0,
      fructoseG: extraFuelBottles > 0 ? bottlePlan.fuelBottles.fructoseGPerBottle : 0,
      sodiumMg: extraFuelBottles > 0 ? bottlePlan.fuelBottles.sodiumMgPerBottle : 0,
    },
    waterRefillCount: extraWaterBottles,
    waterRefillLiters: Math.round(((extraWaterBottles * bottlePlan.bottleSizeMl) / 1000) * 10) / 10,
    reloadAtKm: avgSpeedKmh != null ? Math.round(reloadAtHoursClamped * avgSpeedKmh * 10) / 10 : null,
    reloadAtHours: Math.round(reloadAtHoursClamped * 100) / 100,
    isImpractical: extraFuelBottles > MAX_PRACTICAL_ZIPLOC_BAGS,
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
    "📟 FICHA DE NUTRICIÓN — RATIO",
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

export type WkgCategory = {
  label: string;
  percentile: string;
};

/**
 * FTP/weight ratio performance banding — the standard TrainerRoad/Coggan
 * power-profile chart, not a RATIO-specific formula. Purely illustrative
 * (same "heuristic, not clinical" convention as the rest of this file): a
 * real power-profile chart also varies by duration (5s/1min/5min/20min) and
 * sex, neither of which this app collects, so this single-number banding is
 * a rough placement, not a precise percentile. Used only to label the
 * Physiological Profile form's own read-only W/kg pill — never fed into any
 * fueling/recovery calculation elsewhere in this file.
 */
export function getWkgCategory(wkg: number): WkgCategory {
  if (wkg < 2.0) return { label: "Principiante", percentile: "Top 90%" };
  if (wkg < 2.8) return { label: "Recreacional", percentile: "Top 70%" };
  if (wkg < 3.5) return { label: "Intermedio", percentile: "Top 50%" };
  if (wkg < 4.2) return { label: "Avanzado", percentile: "Top 25%" };
  if (wkg < 5.0) return { label: "Competitivo / Elite", percentile: "Top 8%" };
  return { label: "Pro / Excepcional", percentile: "Top 2%" };
}

const WKG_BAR_MIN = 1.5;
const WKG_BAR_MAX = 5.5;

/**
 * Position (0-100) along the same 1.5-5.5 W/kg spectrum `getWkgCategory`
 * bands into labels — feeds the Physiological Profile form's own
 * micro-graduated scale bar. Clamped at both ends so a genuinely
 * out-of-range value (a very light athlete with a very low FTP, or a
 * world-tour outlier) still renders a sane in-bounds marker rather than
 * overflowing the bar. Purely illustrative positioning, same "heuristic,
 * not clinical" convention as `getWkgCategory` itself — never fed into any
 * fueling/recovery calculation.
 */
export function getWkgBarPercentage(wkg: number): number {
  const raw = ((wkg - WKG_BAR_MIN) / (WKG_BAR_MAX - WKG_BAR_MIN)) * 100;
  return Math.min(Math.max(raw, 0), 100);
}

/**
 * Collapses `getWkgCategory`'s 6 named bands into the 4 color levels the
 * Physiological Profile form's scale bar renders (Bajo/Medio-Bajo/
 * Medio-Alto/Élite-Máximo, gray-to-bronze) — reuses that function's own
 * real thresholds (2.8/3.5/4.2 W/kg) rather than inventing new round-number
 * cutoffs, so "Competitivo / Elite" and "Pro / Excepcional" (both ≥4.2)
 * land in the same top level, and the bar/label/value readout can never
 * disagree about which W/kg band the athlete is actually in.
 */
export function getWkgLevelIndex(wkg: number): 0 | 1 | 2 | 3 {
  if (wkg < 2.8) return 0;
  if (wkg < 3.5) return 1;
  if (wkg < 4.2) return 2;
  return 3;
}

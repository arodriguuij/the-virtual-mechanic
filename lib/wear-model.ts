/**
 * Heuristic formulas for turning ride + weather data into the dashboard's
 * "impuesto de vatios" and drivetrain wear numbers. These are simple,
 * documented rules of thumb — not a physical simulation — tuned for a
 * coastal-riding scenario (salt residue and grit sticking to a wet or humid
 * drivetrain increases chain friction, and a stretched chain rides high on
 * cassette and chainring teeth, wearing them out faster too). Replace with a
 * better model once there's real before/after power-meter data to calibrate
 * against.
 */

export function estimateWattsLost({
  averageWatts,
  humidityAvg,
  rainMm,
}: {
  averageWatts: number | null;
  humidityAvg: number;
  rainMm: number;
}): number {
  const baseline = averageWatts != null ? averageWatts * 0.02 : 2; // ~2% baseline drivetrain loss
  const humidityLoss = Math.max(0, humidityAvg - 50) * 0.15; // extra drag above 50% humidity
  const rainLoss = rainMm * 3; // wet chain + rolling resistance, ~3W per mm of rain

  const total = baseline + humidityLoss + rainLoss;
  const cap = averageWatts != null ? averageWatts * 0.3 : 60; // never claim more than a 30% loss
  return Math.round(Math.min(total, cap));
}

/**
 * The chain is the only part directly exposed to road spray and grit, so
 * it's the only one whose own wear rate is weather-multiplied. 1.0 = no
 * humidity/rain effect (dry, ≤50% humidity).
 */
export function getWeatherWearMultiplier(humidityAvg: number, rainMm: number): number {
  const humidityFactor = 1 + Math.max(0, humidityAvg - 50) / 200; // up to +25% at 100% humidity
  const rainFactor = 1 + Math.min(rainMm, 10) * 0.03; // up to +30%, capped past 10mm
  return humidityFactor * rainFactor;
}

/**
 * Cascade rule: a chain worn past a threshold has stretched enough to ride
 * high on the cassette's teeth, accelerating its wear disproportionately to
 * distance alone. Multiplier applies to *this ride's* cassette wear delta.
 */
export function getCassetteCascadeMultiplier(chainWearBeforeRide: number): number {
  if (chainWearBeforeRide > 85) return 2.5;
  if (chainWearBeforeRide > 60) return 1.5;
  return 1;
}

/** Same cascade idea as the cassette, smaller effect — chainring teeth are
 * larger and see less of the chain's stretch. */
export function getChainringCascadeMultiplier(chainWearBeforeRide: number): number {
  return chainWearBeforeRide > 75 ? 1.3 : 1;
}

/**
 * Material tradeoffs by tier: Dura-Ace/Red lean on titanium/lighter alloys
 * that shave weight but don't last as long; 105/Rival's steel is heavier but
 * more durable. Only the cassette has a tier effect modeled today — chain
 * and chainring pass through unchanged (modifier 1) regardless of tier.
 */
const TIER_MODIFIERS: Record<string, Record<string, number>> = {
  cassette: {
    "Dura-Ace": 0.9,
    Red: 0.9,
    Ultegra: 1.0,
    Force: 1.0,
    "105": 1.1,
    Rival: 1.1,
  },
};

export function getEffectiveMaxKm(
  componentType: string,
  tier: string | null,
  baseMaxKm: number
): number {
  const modifier = tier ? (TIER_MODIFIERS[componentType]?.[tier] ?? 1) : 1;
  return Math.round(baseMaxKm * modifier);
}

/** One decimal place of wear, clamped so it never reports past 100%. */
export function applyDistanceToWear(
  currentWearPercentage: number,
  effectiveMaxKm: number,
  rideKm: number,
  multiplier: number = 1
): number {
  if (effectiveMaxKm <= 0) return currentWearPercentage;
  const next = currentWearPercentage + (rideKm / effectiveMaxKm) * 100 * multiplier;
  return Math.min(100, Math.round(next * 10) / 10);
}

export type DrivetrainComponent = {
  id: string;
  type: string;
  tier: string | null;
  max_km: number;
  current_wear_percentage: number;
};

export type DrivetrainWearUpdate = {
  id: string;
  newWearPercentage: number;
};

/**
 * The whole "Triángulo de la Transmisión" for one ride. The chain's wear
 * *before* this ride is read once and used to derive the cassette's and
 * chainring's cascade multipliers, so a chain that was already stretched
 * coming into the ride deforms the other two faster — independent of how
 * much further the chain itself stretches during this same ride.
 */
export function applyRideToDrivetrain(
  components: DrivetrainComponent[],
  rideKm: number,
  weather: { humidityAvg: number; rainMm: number }
): DrivetrainWearUpdate[] {
  const chain = components.find((c) => c.type === "chain");
  const chainWearBeforeRide = chain?.current_wear_percentage ?? 0;
  const weatherMultiplier = getWeatherWearMultiplier(weather.humidityAvg, weather.rainMm);

  return components.map((component) => {
    const effectiveMaxKm = getEffectiveMaxKm(component.type, component.tier, component.max_km);

    let multiplier = 1;
    if (component.type === "chain") {
      multiplier = weatherMultiplier;
    } else if (component.type === "cassette") {
      multiplier = getCassetteCascadeMultiplier(chainWearBeforeRide);
    } else if (component.type === "chainring") {
      multiplier = getChainringCascadeMultiplier(chainWearBeforeRide);
    }

    return {
      id: component.id,
      newWearPercentage: applyDistanceToWear(
        component.current_wear_percentage,
        effectiveMaxKm,
        rideKm,
        multiplier
      ),
    };
  });
}

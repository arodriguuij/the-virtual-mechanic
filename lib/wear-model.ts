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
 * Braking module — disc and rim setups both wear from rain (grit turns into
 * a grinding paste on the pad) and, for rotors specifically, from sustained
 * heat on long descents. Rim brakes are modeled even though nothing seeded
 * today uses them, so a future rim-brake bike is a data change, not a code
 * change.
 */
export function getDiscPadRainMultiplier(rainMm: number): number {
  return rainMm > 0 ? 3.5 : 1;
}

/** Elevation gain (m) over 1,000 in one ride implies sustained braking on
 * descents — rotors run hot for long enough to accelerate wear. */
export function getDiscRotorThermalMultiplier(elevationGainM: number): number {
  return elevationGainM > 1000 ? 1.8 : 1;
}

/** Rim pads wear faster than disc pads in the wet — no thermal mass to shed
 * water, and they're the ones doing the grinding against the rim itself. */
export function getRimPadRainMultiplier(rainMm: number): number {
  return rainMm > 0 ? 4.0 : 1;
}

/** The rim's braking track wears too — the wet pad acts like sandpaper on
 * the aluminum or carbon surface. */
export function getWheelRimRainMultiplier(rainMm: number): number {
  return rainMm > 0 ? 2.5 : 1;
}

/**
 * The rear tire carries 60-65% of the rider's weight and takes all of the
 * drivetrain's torque, so it wears faster than the front on every ride
 * regardless of conditions — a flat multiplier, not a weather/cascade one.
 * The front tire is the model's baseline (multiplier 1).
 */
export const REAR_TIRE_TRACTION_MULTIPLIER = 1.3;

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

export type LubricantType = "oil" | "liquid_wax" | "hot_wax";

/**
 * Km before the chain's current lubricant needs reapplying — oil attracts
 * grit and needs refreshing most often, liquid wax lasts longer since it
 * doesn't hold onto dirt, and hot wax's baked-in paraffin/PTFE coating lasts
 * longest of all.
 */
export const LUBRICANT_LIMIT_KM: Record<LubricantType, number> = {
  oil: 150,
  liquid_wax: 200,
  hot_wax: 400,
};

/**
 * Baseline wear multiplier while the lubricant is still within its window —
 * oil attracts grit and forms an abrasive paste (1.2x), liquid wax is the
 * clean baseline (1.0x), hot wax's baked-in coating cuts friction further
 * (0.75x).
 */
const LUBRICANT_BASE_MULTIPLIERS: Record<LubricantType, number> = {
  oil: 1.2,
  liquid_wax: 1.0,
  hot_wax: 0.75,
};

/** Metal-on-metal penalty once the chain has gone past its lubricant's
 * window — either through ordinary accumulated km or a rain wash-out (see
 * `getNextKmsSinceLastLube`) — overrides the lubricant type's own
 * multiplier entirely until the rider logs a re-lube. */
const WASHED_OUT_MULTIPLIER = 2.0;

/**
 * Applied to the whole drivetrain triangle (chain/cassette/chainring), not
 * just the chain itself — a dry or gritty chain grinds down whatever it
 * rides on. Reads `kmsSinceLastLubeBeforeRide` (never this ride's own
 * accumulated value), same pre-ride convention as the chain-wear cascade
 * multipliers below.
 */
export function getLubricantWearMultiplier(
  lubricantType: LubricantType | null,
  kmsSinceLastLubeBeforeRide: number
): number {
  const type = lubricantType ?? "oil";
  if (kmsSinceLastLubeBeforeRide >= LUBRICANT_LIMIT_KM[type]) return WASHED_OUT_MULTIPLIER;
  return LUBRICANT_BASE_MULTIPLIERS[type];
}

/**
 * Rain doesn't just add this ride's distance to the tally — it chemically
 * strips the lubricant off the chain, so an outdoor ride with any rain
 * jumps the counter straight to its lubricant's degradation limit (arming
 * the 2.0x "washed out" multiplier for the *next* ride) instead of
 * accumulating normally. `Math.max` keeps this monotonic — a wash-out never
 * lowers a counter that had already climbed past the limit on its own.
 * Indoor rides never have real rain to react to.
 */
export function getNextKmsSinceLastLube(
  lubricantType: LubricantType | null,
  kmsSinceLastLubeBeforeRide: number,
  rideKm: number,
  isIndoor: boolean,
  rainMm: number
): number {
  const type = lubricantType ?? "oil";
  const accumulated = kmsSinceLastLubeBeforeRide + rideKm;
  if (!isIndoor && rainMm > 0) {
    return Math.max(accumulated, LUBRICANT_LIMIT_KM[type]);
  }
  return accumulated;
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

export type WearableComponent = {
  id: string;
  type: string;
  tier: string | null;
  max_km: number;
  current_wear_percentage: number;
  lubricant_type: LubricantType | null;
  kms_since_last_lube: number | null;
};

export type ComponentWearUpdate = {
  id: string;
  newWearPercentage: number;
  /** Only set for the chain — the one component that tracks lubrication. */
  newKmsSinceLastLube?: number;
};

/** Road-contact parts an indoor/virtual ride can't wear at all — no real
 * road surface, no rain, no descents to brake for. */
const INDOOR_ZERO_WEAR_TYPES = new Set([
  "disc_pad",
  "disc_rotor",
  "rim_pad",
  "wheel_rim",
  "tire_front",
  "tire_rear",
]);

/**
 * Every wearable part on the bike for one ride — drivetrain triangle
 * (chain/cassette/chainring), the braking module (disc or rim), and the two
 * tires. The chain's wear *before* this ride is read once and used to
 * derive the cassette's and chainring's cascade multipliers, so a chain
 * that was already stretched coming into the ride deforms the other two
 * faster — independent of how much further the chain itself stretches
 * during this same ride. Braking parts and tires don't cascade off
 * anything; each reacts directly to this ride's own rain/elevation, or —
 * for the rear tire — a flat traction multiplier.
 *
 * `ride.isIndoor` (a trainer/Zwift/Rouvy ride) zeroes this ride's wear
 * contribution for every road-contact part (brakes, tires) — the drivetrain
 * still wears by distance, but with no weather multiplier on the chain,
 * since there's no real rain or humidity to have queried in the first place.
 */
export function applyRideToComponents(
  components: WearableComponent[],
  ride: {
    km: number;
    elevationGainM: number;
    weather: { humidityAvg: number; rainMm: number };
    isIndoor?: boolean;
  }
): ComponentWearUpdate[] {
  const { km: rideKm, elevationGainM, weather, isIndoor = false } = ride;
  const chain = components.find((c) => c.type === "chain");
  const chainWearBeforeRide = chain?.current_wear_percentage ?? 0;
  const chainLubricantType = chain?.lubricant_type ?? null;
  const kmsSinceLastLubeBeforeRide = chain?.kms_since_last_lube ?? 0;
  const weatherMultiplier = isIndoor
    ? 1
    : getWeatherWearMultiplier(weather.humidityAvg, weather.rainMm);
  // Chemical wear from the chain's lubricant condition — dry or gritty
  // lubricant grinds down the whole drivetrain triangle, not just the chain
  // itself, so this multiplier is reused below for cassette/chainring too.
  const lubricantMultiplier = getLubricantWearMultiplier(
    chainLubricantType,
    kmsSinceLastLubeBeforeRide
  );

  return components.map((component) => {
    if (isIndoor && INDOOR_ZERO_WEAR_TYPES.has(component.type)) {
      return { id: component.id, newWearPercentage: component.current_wear_percentage };
    }

    const effectiveMaxKm = getEffectiveMaxKm(component.type, component.tier, component.max_km);

    let multiplier = 1;
    switch (component.type) {
      case "chain":
        multiplier = weatherMultiplier * lubricantMultiplier;
        break;
      case "cassette":
        multiplier = getCassetteCascadeMultiplier(chainWearBeforeRide) * lubricantMultiplier;
        break;
      case "chainring":
        multiplier = getChainringCascadeMultiplier(chainWearBeforeRide) * lubricantMultiplier;
        break;
      case "disc_pad":
        multiplier = getDiscPadRainMultiplier(weather.rainMm);
        break;
      case "disc_rotor":
        multiplier = getDiscRotorThermalMultiplier(elevationGainM);
        break;
      case "rim_pad":
        multiplier = getRimPadRainMultiplier(weather.rainMm);
        break;
      case "wheel_rim":
        multiplier = getWheelRimRainMultiplier(weather.rainMm);
        break;
      case "tire_front":
        multiplier = 1;
        break;
      case "tire_rear":
        multiplier = REAR_TIRE_TRACTION_MULTIPLIER;
        break;
      default:
        multiplier = 1;
    }

    const newWearPercentage = applyDistanceToWear(
      component.current_wear_percentage,
      effectiveMaxKm,
      rideKm,
      multiplier
    );

    if (component.type === "chain") {
      return {
        id: component.id,
        newWearPercentage,
        newKmsSinceLastLube: getNextKmsSinceLastLube(
          chainLubricantType,
          kmsSinceLastLubeBeforeRide,
          rideKm,
          isIndoor,
          weather.rainMm
        ),
      };
    }

    return { id: component.id, newWearPercentage };
  });
}

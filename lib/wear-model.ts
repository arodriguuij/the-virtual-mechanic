/**
 * Heuristic formulas for turning ride + weather data into the dashboard's
 * "impuesto de vatios" and component wear numbers. These are simple,
 * documented rules of thumb — not a physical simulation — tuned for a
 * coastal-riding scenario (salt residue and grit sticking to a wet or humid
 * drivetrain increases chain friction). Replace with a better model once
 * there's real before/after power-meter data to calibrate against.
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

/** One decimal place of wear, clamped so it never reports past 100%. */
export function applyDistanceToWear(
  currentWearPercentage: number,
  maxKm: number,
  rideKm: number
): number {
  if (maxKm <= 0) return currentWearPercentage;
  const next = currentWearPercentage + (rideKm / maxKm) * 100;
  return Math.min(100, Math.round(next * 10) / 10);
}

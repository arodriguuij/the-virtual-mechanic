/**
 * "Algoritmo de Detección de Puertos/Valles por Prominencia" — a granular
 * hito list for Card 03's thermal-impact carousel, distinct from
 * `detectMountainPasses` (`lib/metabolic-engine.ts`), which only reports
 * summits (no valleys, no lat/lng) at a coarser 350m/250m threshold tuned
 * for caffeine-dose timing. This module exists purely to feed *weather*
 * milestones — a real but smaller col (150m+) still deserves its own
 * Temp/Viento/Humedad sample, since a route's single blended reading
 * silently averages away a genuinely different microclimate at altitude.
 * Pure, no I/O — safe to call from either a Route Handler (a Strava route's
 * server-fetched streams) or client-side GPX parsing.
 */

export type ElevationMilestoneType = "start" | "peak" | "valley" | "end";

export type ElevationMilestone = {
  type: ElevationMilestoneType;
  lat: number;
  lng: number;
  distanceFraction: number;
  distanceKm: number;
  elevationM: number;
};

export type ElevationProfilePoint = { distanceFraction: number; elevationM: number };

type ProfilePoint = { lat: number; lng: number; distanceFraction: number; elevationM: number };

// A real climb-then-descend cycle of at least this much gain...
const MILESTONE_MIN_PROMINENCE_M = 150;
// ...confirmed by at least this much subsequent descent off the summit, so a
// brief false plateau mid-climb doesn't register as its own separate peak.
const MILESTONE_MIN_DESCENT_CONFIRM_M = 150;
// Two candidate summits closer than this are almost always the same real
// climb registering twice — only the higher of the two survives.
const MILESTONE_MIN_SEPARATION_KM = 3;
// A valley/finish milestone essentially on top of the milestone right before
// it (a summit right at the finish line, or a valley a few hundred meters
// into a climb) adds nothing a rider would read as a distinct stop.
const MILESTONE_MIN_GAP_KM = 1;

/**
 * Scans an elevation profile (ordered by distance along the route, each
 * point carrying its own real coordinates) for every genuine summit and the
 * valley that precedes it, returning an ordered Salida → [Valle → Cima]* →
 * Llegada list. A multi-pass mountain route (e.g. Andorra: Ordino → valley →
 * Arcalís → valley → Beixalís) naturally yields 5-7 milestones this way;
 * a flat or single-climb route yields as few as 2 (start/end only) or 3
 * (start/peak/end).
 */
export function detectElevationMilestones(
  points: ProfilePoint[],
  totalDistanceKm: number
): ElevationMilestone[] {
  if (points.length < 3 || totalDistanceKm <= 0) return [];

  type RawPeak = { index: number; elevationM: number; valleyIndex: number };
  const rawPeaks: RawPeak[] = [];

  let valleyIndex = 0;
  let valleyElevation = points[0].elevationM;
  let peakIndex = 0;
  let peakElevation = points[0].elevationM;

  for (let i = 1; i < points.length; i++) {
    const elevationM = points[i].elevationM;
    if (elevationM > peakElevation) {
      peakElevation = elevationM;
      peakIndex = i;
      continue;
    }
    if (peakElevation - elevationM >= MILESTONE_MIN_DESCENT_CONFIRM_M) {
      if (peakElevation - valleyElevation >= MILESTONE_MIN_PROMINENCE_M) {
        rawPeaks.push({ index: peakIndex, elevationM: peakElevation, valleyIndex });
      }
      valleyIndex = i;
      valleyElevation = elevationM;
      peakIndex = i;
      peakElevation = elevationM;
    } else if (elevationM < valleyElevation) {
      valleyIndex = i;
      valleyElevation = elevationM;
    }
  }

  if (rawPeaks.length === 0) return [];

  // Minimum-separation filter — keep only the higher of any two candidates
  // within `MILESTONE_MIN_SEPARATION_KM` of each other.
  const filteredPeaks: RawPeak[] = [];
  for (const candidate of rawPeaks) {
    const candidateKm = points[candidate.index].distanceFraction * totalDistanceKm;
    const clash = filteredPeaks.find(
      (accepted) =>
        Math.abs(candidateKm - points[accepted.index].distanceFraction * totalDistanceKm) <
        MILESTONE_MIN_SEPARATION_KM
    );
    if (!clash) {
      filteredPeaks.push(candidate);
    } else if (candidate.elevationM > clash.elevationM) {
      filteredPeaks[filteredPeaks.indexOf(clash)] = candidate;
    }
  }

  const toMilestone = (index: number, type: ElevationMilestoneType): ElevationMilestone => {
    const p = points[index];
    return {
      type,
      lat: p.lat,
      lng: p.lng,
      distanceFraction: p.distanceFraction,
      distanceKm: Math.round(p.distanceFraction * totalDistanceKm * 10) / 10,
      elevationM: Math.round(p.elevationM),
    };
  };

  const milestones: ElevationMilestone[] = [toMilestone(0, "start")];
  for (const peak of filteredPeaks) {
    const previousFraction = milestones[milestones.length - 1].distanceFraction;
    const valleyFraction = points[peak.valleyIndex].distanceFraction;
    const valleyGapKm = (valleyFraction - previousFraction) * totalDistanceKm;
    // The valley preceding this summit is only its own milestone when it's a
    // genuine dip distinct from the milestone already in the list —
    // otherwise the climb starts essentially from that same point, and a
    // near-duplicate "valley" reading right on top of it is just noise.
    if (peak.valleyIndex !== 0 && valleyGapKm >= MILESTONE_MIN_GAP_KM) {
      milestones.push(toMilestone(peak.valleyIndex, "valley"));
    }
    milestones.push(toMilestone(peak.index, "peak"));
  }

  const lastIndex = points.length - 1;
  const lastMilestone = milestones[milestones.length - 1];
  const finishGapKm = (points[lastIndex].distanceFraction - lastMilestone.distanceFraction) * totalDistanceKm;
  if (finishGapKm >= MILESTONE_MIN_GAP_KM) {
    milestones.push(toMilestone(lastIndex, "end"));
  } else {
    // A summit essentially at the finish line still needs an explicit
    // "Llegada" milestone — relabel the last entry's type rather than
    // dropping the real finish point (and its coordinates) entirely.
    milestones[milestones.length - 1] = { ...lastMilestone, type: "end" };
  }

  return milestones;
}

/**
 * Thins a full per-point elevation profile down to a payload-friendly point
 * count for the client-side SVG curve — a real Strava streams response can
 * carry several hundred points, far more than a ~300px-wide sparkline needs
 * to read as a smooth silhouette. Always keeps the very first and last
 * point so the curve's true start/end elevation is never lost to rounding.
 */
export function downsampleElevationProfile(
  points: ElevationProfilePoint[],
  maxPoints = 150
): ElevationProfilePoint[] {
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  const sampled: ElevationProfilePoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(points[Math.min(points.length - 1, Math.floor(i * step))]);
  }
  const last = points[points.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
}

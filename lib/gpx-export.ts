/**
 * Builds a downloadable GPX course file carrying the ride's own track plus
 * waypoints at each nutrition milestone/reload stop — both Garmin Edge and
 * Wahoo ELEMNT surface named waypoints attached to an imported course as
 * on-screen (and, depending on the device's own alert settings, audible)
 * proximity alerts, which is what makes "eat here" actionable mid-ride
 * instead of only visible at planning time. Pure string building, no I/O —
 * safe to import from a Route Handler.
 */

export type GpxWaypoint = {
  /** Kept short and plain (no emoji/markdown) for maximum compatibility with
   * older head-unit firmware, which sometimes renders non-ASCII glyphs as
   * empty boxes. */
  name: string;
  atKm: number;
};

// Matches most common pictographic ranges (emoji, dingbats, symbols) so
// waypoint names stay plain ASCII/Latin text for head-unit compatibility,
// without having to hand-maintain a separate "plain" copy of every label.
const EMOJI_PATTERN =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu;

export function stripEmoji(text: string): string {
  return text.replace(EMOJI_PATTERN, "").replace(/\s+/g, " ").trim();
}

/**
 * The decoded polyline's points are assumed roughly evenly spaced along the
 * real route distance (same simplification `getRouteSamplePoints` already
 * makes elsewhere in this codebase) — so a point at km fraction `f` of the
 * ride is approximated as the coordinate at index `round(f * (n - 1))`,
 * rather than walking a real cumulative-distance calculation.
 */
export function getPointAtFraction(
  coordinates: [number, number][],
  fraction: number
): [number, number] {
  const clamped = Math.min(1, Math.max(0, fraction));
  const index = Math.round(clamped * (coordinates.length - 1));
  return coordinates[index];
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildNutritionGpx({
  routeName,
  coordinates,
  distanceKm,
  waypoints,
}: {
  routeName: string;
  coordinates: [number, number][];
  distanceKm: number;
  waypoints: GpxWaypoint[];
}): string {
  const trackPoints = coordinates
    .map(([lat, lng]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`)
    .join("\n");

  const wptElements = waypoints
    .map((wpt) => {
      const [lat, lng] = getPointAtFraction(coordinates, distanceKm > 0 ? wpt.atKm / distanceKm : 0);
      const name = escapeXml(stripEmoji(wpt.name));
      return `  <wpt lat="${lat}" lon="${lng}">\n    <name>${name}</name>\n    <sym>Flag, Blue</sym>\n  </wpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Motor Metabolico" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(stripEmoji(routeName))} - Nutricion</name>
  </metadata>
${wptElements}
  <trk>
    <name>${escapeXml(stripEmoji(routeName))}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>
`;
}

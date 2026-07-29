/**
 * Builds a downloadable GPX course file carrying the ride's own track — kept
 * 100% dedicated to navigation (no injected waypoints/turns of any kind), so
 * it's exactly the file a Garmin/Wahoo head unit expects for course
 * following. Nutrition timing is handled entirely by the head unit's own
 * native repeating alerts (see the in-app recommendation next to the
 * download button) rather than by waypoints baked into the route file
 * itself — a waypoint fires once at a fixed point along the course, which
 * doesn't match how nutrition actually needs to be timed (a recurring
 * interval, not a single GPS location). Pure string building, no I/O — safe
 * to import from a Route Handler.
 */

// Matches most common pictographic ranges (emoji, dingbats, symbols) so
// exported text stays plain ASCII/Latin, without having to hand-maintain a
// separate "plain" copy of every label — used by the clipboard-based
// nutrition export text as well as this file's own route metadata.
const EMOJI_PATTERN =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu;

export function stripEmoji(text: string): string {
  return text.replace(EMOJI_PATTERN, "").replace(/\s+/g, " ").trim();
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildRouteGpx({
  routeName,
  coordinates,
}: {
  routeName: string;
  coordinates: [number, number][];
}): string {
  const trackPoints = coordinates
    .map(([lat, lng]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RATIO" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(stripEmoji(routeName))}</name>
  </metadata>
  <trk>
    <name>${escapeXml(stripEmoji(routeName))}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>
`;
}

/**
 * Pure Strava/Google-encoded-polyline decoding — no I/O, no `"server-only"`
 * marker, since `components/route-map-preview.tsx` (a client component)
 * needs this too and `lib/strava.ts` (where this used to live) is marked
 * `"server-only"`. `lib/strava.ts` re-exports this same function so every
 * existing server-side import (`lib/strava-routes.ts`,
 * `app/api/fueling/gpx/route.ts`) keeps working unchanged.
 * See https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push([lat / 1e5, lng / 1e5]);
  }

  return coordinates;
}

import "server-only";

import type { RouteSamplePoint } from "@/lib/strava";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

// The near-real-time forecast endpoint only serves a rolling window of
// recent days reliably; anything older leans on the archive (reanalysis)
// endpoint instead, which lags a few days behind "today" but covers years
// back. 5 days is a safe split between the two for our purposes.
const ARCHIVE_THRESHOLD_DAYS = 5;

// Below this, a hourly rain reading is treated as measurement noise rather
// than a real "it rained here" signal for the ride.
const WET_THRESHOLD_MM = 0.1;

export type RouteWeather = {
  humidityAvg: number;
  rainMm: number;
  isWet: boolean;
};

type OpenMeteoHourlyResponse = {
  hourly?: {
    time: string[];
    relative_humidity_2m: (number | null)[];
    rain: (number | null)[];
  };
};

type PointSample = {
  humidity: number;
  rainMm: number;
};

/** Single-hour reading at one geographic point — the nearest hourly entry
 * Open-Meteo has to that point's estimated pass-through time. */
async function getWeatherAtPoint(point: RouteSamplePoint): Promise<PointSample | null> {
  const daysAgo = (Date.now() - point.atDate.getTime()) / (1000 * 60 * 60 * 24);
  const baseUrl = daysAgo > ARCHIVE_THRESHOLD_DAYS ? ARCHIVE_URL : FORECAST_URL;
  const dateStr = point.atDate.toISOString().slice(0, 10);

  const url = new URL(baseUrl);
  url.searchParams.set("latitude", String(point.lat));
  url.searchParams.set("longitude", String(point.lng));
  url.searchParams.set("start_date", dateStr);
  url.searchParams.set("end_date", dateStr);
  url.searchParams.set("hourly", "relative_humidity_2m,rain");
  url.searchParams.set("timezone", "UTC");

  const res = await fetch(url);
  if (!res.ok) {
    console.error(
      `Open-Meteo request failed for point (${point.lat}, ${point.lng}): ${res.status} ${await res.text()}`
    );
    return null;
  }

  const data: OpenMeteoHourlyResponse = await res.json();
  const hourly = data.hourly;
  if (!hourly || hourly.time.length === 0) return null;

  let closestIndex = 0;
  let closestDiffMs = Infinity;
  hourly.time.forEach((isoHour, i) => {
    const diff = Math.abs(new Date(`${isoHour}:00Z`).getTime() - point.atDate.getTime());
    if (diff < closestDiffMs) {
      closestDiffMs = diff;
      closestIndex = i;
    }
  });

  const humidity = hourly.relative_humidity_2m[closestIndex];
  const rain = hourly.rain[closestIndex];
  if (humidity == null && rain == null) return null;

  return { humidity: humidity ?? 50, rainMm: rain ?? 0 };
}

/**
 * Samples weather at every geographic control point along the route, each
 * at its own estimated pass-through time, in parallel — a single
 * start-coordinate lookup can completely miss a localized storm the rider
 * actually rode through further down the route. Any one point reading above
 * `WET_THRESHOLD_MM` marks the whole ride "wet" (a microclimate rain cell
 * was crossed somewhere on the route) and drives `rainMm` from that point's
 * reading, even if every other sampled point was dry — this is what feeds
 * the chain's rain wash-out in `lib/wear-model.ts`. Returns null (rather
 * than throwing) when there are no points to sample or every request
 * failed — callers should fall back to a placeholder.
 */
export async function getWeatherForRoute(
  points: RouteSamplePoint[]
): Promise<RouteWeather | null> {
  if (points.length === 0) return null;

  const results = await Promise.all(points.map(getWeatherAtPoint));
  const samples = results.filter((sample): sample is PointSample => sample != null);
  if (samples.length === 0) return null;

  const humidityAvg = samples.reduce((sum, s) => sum + s.humidity, 0) / samples.length;
  const maxRain = Math.max(...samples.map((s) => s.rainMm));
  const isWet = maxRain > WET_THRESHOLD_MM;

  return {
    humidityAvg,
    rainMm: isWet ? maxRain : 0,
    isWet,
  };
}

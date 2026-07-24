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
  temperatureAvgC: number;
  rainMm: number;
  isWet: boolean;
};

type OpenMeteoHourlyResponse = {
  hourly?: {
    time: string[];
    relative_humidity_2m: (number | null)[];
    temperature_2m: (number | null)[];
    rain: (number | null)[];
  };
};

type PointSample = {
  humidity: number;
  temperatureC: number;
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
  url.searchParams.set("hourly", "relative_humidity_2m,temperature_2m,rain");
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
  const temperature = hourly.temperature_2m[closestIndex];
  const rain = hourly.rain[closestIndex];
  if (humidity == null && temperature == null && rain == null) return null;

  return { humidity: humidity ?? 50, temperatureC: temperature ?? 18, rainMm: rain ?? 0 };
}

/**
 * Samples weather at every geographic control point along the route, each
 * at its own estimated pass-through time, in parallel — a single
 * start-coordinate lookup can completely miss a localized storm (or a hot
 * valley climb) the rider actually rode through further down the route.
 * `humidityAvg`/`temperatureAvgC` are the mean across points (both feed the
 * metabolic engine's fluid/sodium loss estimate); any one point reading
 * above `WET_THRESHOLD_MM` marks the whole ride "wet" and drives `rainMm`
 * from that point's reading, even if every other sampled point was dry.
 * Returns null (rather than throwing) when there are no points to sample or
 * every request failed — callers should fall back to a placeholder.
 */
export async function getWeatherForRoute(
  points: RouteSamplePoint[]
): Promise<RouteWeather | null> {
  if (points.length === 0) return null;

  const results = await Promise.all(points.map(getWeatherAtPoint));
  const samples = results.filter((sample): sample is PointSample => sample != null);
  if (samples.length === 0) return null;

  const humidityAvg = samples.reduce((sum, s) => sum + s.humidity, 0) / samples.length;
  const temperatureAvgC = samples.reduce((sum, s) => sum + s.temperatureC, 0) / samples.length;
  const maxRain = Math.max(...samples.map((s) => s.rainMm));
  const isWet = maxRain > WET_THRESHOLD_MM;

  return {
    humidityAvg,
    temperatureAvgC,
    rainMm: isWet ? maxRain : 0,
    isWet,
  };
}

export type DepartureWeather = {
  temperatureAvgC: number;
  humidityAvg: number;
};

/**
 * Averages the hourly forecast at one point across the exact hours a
 * planned ride will be in progress — a ride leaving at 08:00 and lasting 3h
 * averages the 08:00/09:00/10:00 readings (the hour block *during* the
 * ride, not the arrival hour). Always the forecast endpoint (never the
 * archive one) since this is exclusively for planning a future departure.
 * Returns `null` if Open-Meteo has no data for that window — callers
 * should fall back to a placeholder.
 */
export async function getWeatherForDeparture(
  lat: number,
  lng: number,
  departureIso: string,
  durationHours: number
): Promise<DepartureWeather | null> {
  const start = new Date(departureIso);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);

  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("start_date", start.toISOString().slice(0, 10));
  url.searchParams.set("end_date", end.toISOString().slice(0, 10));
  url.searchParams.set("hourly", "temperature_2m,relative_humidity_2m");
  url.searchParams.set("timezone", "UTC");

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Open-Meteo forecast request failed: ${res.status} ${await res.text()}`);
    return null;
  }

  const data: OpenMeteoHourlyResponse = await res.json();
  const hourly = data.hourly;
  if (!hourly) return null;

  const temps: number[] = [];
  const humidities: number[] = [];
  hourly.time.forEach((isoHour, i) => {
    const hourDate = new Date(`${isoHour}:00Z`);
    if (hourDate >= start && hourDate < end) {
      const t = hourly.temperature_2m[i];
      const h = hourly.relative_humidity_2m[i];
      if (t != null) temps.push(t);
      if (h != null) humidities.push(h);
    }
  });
  if (temps.length === 0 && humidities.length === 0) return null;

  return {
    temperatureAvgC: temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : 18,
    humidityAvg: humidities.length > 0 ? humidities.reduce((a, b) => a + b, 0) / humidities.length : 50,
  };
}

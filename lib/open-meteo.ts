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

// Open-Meteo's forecast endpoint only reliably covers roughly the next two
// weeks — a departure planned further out than this (an event or trip
// planned weeks/months ahead) has no real forecast to query yet, so this is
// the switch point for falling back to `getSeasonalAverageWeather` below
// instead of firing a forecast request that has nothing to return.
export const FORECAST_RANGE_DAYS = 14;

export function isBeyondForecastRange(departureIso: string): boolean {
  const daysAhead = (new Date(departureIso).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return daysAhead > FORECAST_RANGE_DAYS;
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export type RouteWeather = {
  humidityAvg: number;
  temperatureAvgC: number;
  // The hottest single sampled point — a whole-ride average can mask a
  // genuinely dangerous few minutes at a low valley or exposed summit;
  // sweat-rate sizing should still be driven by the average (a peak
  // reading only applies briefly, not for the whole ride), but the peak is
  // worth surfacing to the rider as its own figure.
  temperatureMaxC: number;
  rainMm: number;
  isWet: boolean;
  // Mean wind speed (km/h, Open-Meteo's default unit) across the sampled
  // points — informational only, doesn't feed the fluid/sodium loss model,
  // but is a real factor in perceived effort/thermal comfort the rider sees
  // in the weather badge.
  windSpeedKmhAvg: number;
};

type OpenMeteoHourlyResponse = {
  hourly?: {
    time: string[];
    relative_humidity_2m: (number | null)[];
    temperature_2m: (number | null)[];
    rain: (number | null)[];
    wind_speed_10m?: (number | null)[];
  };
};

type PointSample = {
  humidity: number;
  temperatureC: number;
  rainMm: number;
  windSpeedKmh: number;
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
  url.searchParams.set("hourly", "relative_humidity_2m,temperature_2m,rain,wind_speed_10m");
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
  const windSpeed = hourly.wind_speed_10m?.[closestIndex];
  if (humidity == null && temperature == null && rain == null) return null;

  return {
    humidity: humidity ?? 50,
    temperatureC: temperature ?? 18,
    rainMm: rain ?? 0,
    windSpeedKmh: windSpeed ?? 0,
  };
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
  const temperatureMaxC = Math.max(...samples.map((s) => s.temperatureC));
  const maxRain = Math.max(...samples.map((s) => s.rainMm));
  const isWet = maxRain > WET_THRESHOLD_MM;
  const windSpeedKmhAvg = samples.reduce((sum, s) => sum + s.windSpeedKmh, 0) / samples.length;

  return {
    humidityAvg,
    temperatureAvgC,
    temperatureMaxC,
    rainMm: isWet ? maxRain : 0,
    isWet,
    windSpeedKmhAvg,
  };
}

export type DepartureWeather = {
  temperatureAvgC: number;
  humidityAvg: number;
  windSpeedKmhAvg: number;
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
  url.searchParams.set("hourly", "temperature_2m,relative_humidity_2m,wind_speed_10m");
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
  const windSpeeds: number[] = [];
  hourly.time.forEach((isoHour, i) => {
    const hourDate = new Date(`${isoHour}:00Z`);
    if (hourDate >= start && hourDate < end) {
      const t = hourly.temperature_2m[i];
      const h = hourly.relative_humidity_2m[i];
      const w = hourly.wind_speed_10m?.[i];
      if (t != null) temps.push(t);
      if (h != null) humidities.push(h);
      if (w != null) windSpeeds.push(w);
    }
  });
  if (temps.length === 0 && humidities.length === 0) return null;

  return {
    temperatureAvgC: temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : 18,
    humidityAvg: humidities.length > 0 ? humidities.reduce((a, b) => a + b, 0) / humidities.length : 50,
    windSpeedKmhAvg:
      windSpeeds.length > 0 ? windSpeeds.reduce((a, b) => a + b, 0) / windSpeeds.length : 0,
  };
}

// How many past years' readings to average into a "climate normal" for a
// given calendar day — enough to smooth out one unusually hot/cold/wet year
// without needing decades of data.
const SEASONAL_AVERAGE_YEARS_BACK = 5;

type SeasonalDaySample = { temperatureC: number; humidity: number; windSpeedKmh: number };

/** Every hourly reading for one full calendar day, from the archive
 * (reanalysis) endpoint — used to build one year's data point for the
 * seasonal average below, never for a real forecast. */
async function getArchiveDayAverage(
  lat: number,
  lng: number,
  dateStr: string
): Promise<SeasonalDaySample | null> {
  const url = new URL(ARCHIVE_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("start_date", dateStr);
  url.searchParams.set("end_date", dateStr);
  url.searchParams.set("hourly", "relative_humidity_2m,temperature_2m,wind_speed_10m");
  url.searchParams.set("timezone", "UTC");

  const res = await fetch(url);
  if (!res.ok) return null;

  const data: OpenMeteoHourlyResponse = await res.json();
  const hourly = data.hourly;
  if (!hourly || hourly.time.length === 0) return null;

  const temps = hourly.temperature_2m.filter((v): v is number => v != null);
  const humidities = hourly.relative_humidity_2m.filter((v): v is number => v != null);
  const windSpeeds = (hourly.wind_speed_10m ?? []).filter((v): v is number => v != null);
  if (temps.length === 0) return null;

  return {
    temperatureC: average(temps),
    humidity: humidities.length > 0 ? average(humidities) : 50,
    windSpeedKmh: windSpeeds.length > 0 ? average(windSpeeds) : 0,
  };
}

/**
 * "Clima estimado mediante medias históricas estacionales" — for a departure
 * planned further out than Open-Meteo's forecast horizon (`FORECAST_RANGE_DAYS`),
 * there's no real forecast to query yet, so this builds a "climate normal"
 * instead: the same calendar day (month/day) across the last
 * `SEASONAL_AVERAGE_YEARS_BACK` years, averaged. A single representative
 * point (the route's start) rather than a multi-point sample — a day-level
 * historical average isn't precise enough for point-by-point geographic
 * sampling to add real signal the way it does for a genuine forecast. Rain
 * isn't part of this estimate (a historical day's rain is far too noisy a
 * signal to average meaningfully across years) — callers should treat this
 * as dry. Returns `null` only if every year's request failed.
 */
export async function getSeasonalAverageWeather(
  lat: number,
  lng: number,
  referenceDate: Date
): Promise<DepartureWeather | null> {
  const month = referenceDate.getUTCMonth() + 1;
  const day = referenceDate.getUTCDate();
  const currentYear = referenceDate.getUTCFullYear();
  const pad = (n: number) => String(n).padStart(2, "0");

  const dateStrs = Array.from(
    { length: SEASONAL_AVERAGE_YEARS_BACK },
    (_, i) => `${currentYear - 1 - i}-${pad(month)}-${pad(day)}`
  );

  const results = await Promise.all(dateStrs.map((d) => getArchiveDayAverage(lat, lng, d)));
  const samples = results.filter((s): s is SeasonalDaySample => s != null);
  if (samples.length === 0) return null;

  return {
    temperatureAvgC: average(samples.map((s) => s.temperatureC)),
    humidityAvg: average(samples.map((s) => s.humidity)),
    windSpeedKmhAvg: average(samples.map((s) => s.windSpeedKmh)),
  };
}

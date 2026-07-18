import "server-only";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

// The near-real-time forecast endpoint only serves a rolling window of
// recent days reliably; anything older leans on the archive (reanalysis)
// endpoint instead, which lags a few days behind "today" but covers years
// back. 5 days is a safe split between the two for our purposes.
const ARCHIVE_THRESHOLD_DAYS = 5;

export type WeatherWindow = {
  humidityAvg: number;
  rainMm: number;
};

type OpenMeteoHourlyResponse = {
  hourly?: {
    time: string[];
    relative_humidity_2m: (number | null)[];
    rain: (number | null)[];
  };
};

/**
 * Averages humidity and sums rainfall across the hours a ride covers, using
 * its start coordinates. Returns null (rather than throwing) whenever the
 * ride has no coordinates (indoor trainer, privacy zone) or Open-Meteo has
 * no data for that window — callers should fall back to a placeholder.
 */
export async function getWeatherForRide(
  latlng: [number, number] | null | undefined,
  startDateIso: string,
  movingTimeSeconds: number
): Promise<WeatherWindow | null> {
  if (!latlng || latlng.length !== 2) return null;
  const [latitude, longitude] = latlng;

  const start = new Date(startDateIso);
  const end = new Date(start.getTime() + movingTimeSeconds * 1000);
  const daysAgo = (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24);
  const baseUrl = daysAgo > ARCHIVE_THRESHOLD_DAYS ? ARCHIVE_URL : FORECAST_URL;

  const url = new URL(baseUrl);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("start_date", start.toISOString().slice(0, 10));
  url.searchParams.set("end_date", end.toISOString().slice(0, 10));
  url.searchParams.set("hourly", "relative_humidity_2m,rain");
  url.searchParams.set("timezone", "UTC");

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Open-Meteo request failed: ${res.status} ${await res.text()}`);
    return null;
  }

  const data: OpenMeteoHourlyResponse = await res.json();
  const hourly = data.hourly;
  if (!hourly) return null;

  const humidities: number[] = [];
  const rains: number[] = [];

  hourly.time.forEach((isoHour, i) => {
    const hourDate = new Date(`${isoHour}:00Z`);
    if (hourDate >= start && hourDate <= end) {
      const humidity = hourly.relative_humidity_2m[i];
      const rain = hourly.rain[i];
      if (humidity != null) humidities.push(humidity);
      if (rain != null) rains.push(rain);
    }
  });

  if (humidities.length === 0) return null;

  return {
    humidityAvg: humidities.reduce((a, b) => a + b, 0) / humidities.length,
    rainMm: rains.reduce((a, b) => a + b, 0),
  };
}

import "server-only";

import { cache } from "react";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import type { AthleteType, GutTrainingLevel, SweatRate } from "@/lib/metabolic-engine";
import { getValidStravaAccessToken } from "@/lib/strava-session";
import { fetchAthleteRoutes, type StravaRoute } from "@/lib/strava-routes";

export type AthleteProfile = {
  id: string;
  ftp: number;
  weight_kg: number;
  sweat_rate: SweatRate;
  gut_training_level: GutTrainingLevel;
  athlete_type: AthleteType;
};

export type FuelingTotals = {
  totalMoneySaved: number;
  totalGlycogenKg: number;
  totalFluidL: number;
  totalSodiumG: number;
};

export type Activity = {
  id: string;
  name: string;
  distance: number; // metros
  total_elevation_gain: number | null;
  moving_time: number; // segundos
  average_watts: number | null;
  rain_mm: number;
  humidity_avg: number;
  temperature_avg: number | null;
  carbs_burned_g: number | null;
  fluid_loss_ml: number | null;
  sodium_loss_mg: number | null;
  activity_date: string;
};

export type Profile = {
  id: string;
  strava_athlete_id: string | null;
};

export const getAthleteProfile = cache(async (): Promise<AthleteProfile | null> => {
  const supabase = await getAuthenticatedSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("athlete_profiles")
    .select("id, ftp, weight_kg, sweat_rate, gut_training_level, athlete_type")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
});

/**
 * Lifetime totals across every fueling plan this athlete has ever
 * generated — both pre-ride plans (`POST /api/fueling/plan`) and post-ride
 * analyses (`POST /api/post-ride/analysis`) log a row to `fueling_logs`,
 * so this is a simple SUM over their own rows.
 */
export const getFuelingTotals = cache(async (): Promise<FuelingTotals> => {
  const supabase = await getAuthenticatedSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) {
    return { totalMoneySaved: 0, totalGlycogenKg: 0, totalFluidL: 0, totalSodiumG: 0 };
  }

  const { data, error } = await supabase
    .from("fueling_logs")
    .select("total_carbs_g, fluid_ml, sodium_mg, money_saved")
    .eq("profile_id", userId);
  if (error) throw error;

  const rows = data ?? [];
  const sum = (pick: (row: (typeof rows)[number]) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);

  return {
    totalMoneySaved: Math.round(sum((r) => r.money_saved) * 100) / 100,
    totalGlycogenKg: Math.round(sum((r) => r.total_carbs_g) / 10) / 100,
    totalFluidL: Math.round(sum((r) => r.fluid_ml) / 10) / 100,
    totalSodiumG: Math.round(sum((r) => r.sodium_mg) / 10) / 100,
  };
});

/**
 * Shared by every component that needs ride history — the Recovery card and
 * the ride lookbook both call this with the same `limit` so React's
 * `cache()` dedupes them into one Supabase query per request.
 */
export const getRecentActivities = cache(
  async (limit: number = 10): Promise<Activity[]> => {
    const supabase = await getAuthenticatedSupabaseClient();

    const { data, error } = await supabase
      .from("activities")
      .select(
        "id, name, distance, total_elevation_gain, moving_time, average_watts, rain_mm, humidity_avg, temperature_avg, carbs_burned_g, fluid_loss_ml, sodium_loss_mg, activity_date"
      )
      .order("activity_date", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data ?? [];
  }
);

/**
 * The athlete's saved/starred Strava cycling routes, for the fueling
 * planner's route selector. `[]` (not an error) whenever Strava isn't
 * connected or the API call fails — the planner just falls back to its
 * manual quick-calculator mode.
 */
export const getStravaRoutes = cache(async (): Promise<StravaRoute[]> => {
  const supabase = await getAuthenticatedSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) return [];

  const accessToken = await getValidStravaAccessToken(supabase, userId);
  if (!accessToken) return [];

  return fetchAthleteRoutes(accessToken);
});

export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await getAuthenticatedSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, strava_athlete_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
});

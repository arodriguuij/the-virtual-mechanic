import "server-only";

import { cache } from "react";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import type { SweatRate } from "@/lib/metabolic-engine";
import { getValidStravaAccessToken } from "@/lib/strava-session";
import { fetchAthleteRoutes, type StravaRoute } from "@/lib/strava-routes";

export type AthleteProfile = {
  id: string;
  ftp: number;
  weight_kg: number;
  sweat_rate: SweatRate;
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
    .select("id, ftp, weight_kg, sweat_rate")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
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

import "server-only";

import { cache } from "react";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import type { LubricantType } from "@/lib/wear-model";
import { ensureDefaultWheelset, getWheelsets, type Wheelset } from "@/lib/wheelsets";

export type StatusType = "estimated" | "certified";
export type CalibrationMethod = "new" | "km" | "gauge";
export type { Wheelset };

export type BikeWithComponents = {
  id: string;
  brand: string;
  model: string;
  weight: number | null;
  wheelsets: Wheelset[];
  activeWheelsetId: string | null;
  components: {
    id: string;
    name: string;
    type: string;
    tier: string | null;
    max_km: number;
    current_wear_percentage: number;
    status_type: StatusType;
    lubricant_type: LubricantType | null;
    kms_since_last_lube: number | null;
    /** Null until the user runs a calibration (any method) — distinguishes
     * a genuinely calibrated component from seed/migration defaults for the
     * Digital Twin fidelity score. */
    calibration_method: CalibrationMethod | null;
    /** True only once the user has explicitly saved a lubricant choice via
     * the calibration dialog — `lubricant_type` itself is non-null on every
     * component from a migration default, so it can't be used as this
     * signal on its own. */
    lubricant_set_by_user: boolean;
    /** Null for frame-level parts (chain, chainring) that wear regardless
     * of which wheelset is mounted. Non-null components only wear while
     * their wheelset matches `activeWheelsetId` — see "Multi-wheelset
     * kits" in CLAUDE.md. */
    wheelset_id: string | null;
  }[];
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
  watts_lost: number;
  activity_date: string;
};

export type Profile = {
  id: string;
  strava_athlete_id: string | null;
};

export const getPrimaryBike = cache(async (): Promise<BikeWithComponents | null> => {
  const supabase = await getAuthenticatedSupabaseClient();

  const { data, error } = await supabase
    .from("bikes")
    .select(
      "id, brand, model, weight, components(id, name, type, tier, max_km, current_wear_percentage, status_type, lubricant_type, kms_since_last_lube, calibration_method, lubricant_set_by_user, wheelset_id)"
    )
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // Lazy graceful upgrade — a no-op SELECT once the bike has any wheelset.
  const justMigrated = await ensureDefaultWheelset(supabase, data.id);
  const wheelsets = await getWheelsets(supabase, data.id);
  const activeWheelsetId = wheelsets.find((w) => w.is_active)?.id ?? null;

  // The backfill above just assigned wheelset_id to components read
  // *before* it ran — re-fetch so the returned shape is consistent.
  if (justMigrated) {
    const { data: refetched, error: refetchError } = await supabase
      .from("bikes")
      .select(
        "id, brand, model, weight, components(id, name, type, tier, max_km, current_wear_percentage, status_type, lubricant_type, kms_since_last_lube, calibration_method, lubricant_set_by_user, wheelset_id)"
      )
      .eq("id", data.id)
      .maybeSingle();
    if (refetchError) throw refetchError;
    return refetched ? { ...refetched, wheelsets, activeWheelsetId } : null;
  }

  return { ...data, wheelsets, activeWheelsetId };
});

/**
 * Shared by every component that needs ride history — the Dashboard's "latest
 * activity" stat and the ride lookbook both call this with the same `limit`
 * so React's `cache()` dedupes them into one Supabase query per request.
 */
export const getRecentActivities = cache(
  async (limit: number = 10): Promise<Activity[]> => {
    const supabase = await getAuthenticatedSupabaseClient();

    const { data, error } = await supabase
      .from("activities")
      .select(
        "id, name, distance, total_elevation_gain, moving_time, average_watts, rain_mm, humidity_avg, watts_lost, activity_date"
      )
      .order("activity_date", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data ?? [];
  }
);

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

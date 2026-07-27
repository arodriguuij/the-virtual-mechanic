import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type FuelingLogKind = "pre_ride" | "post_ride";

/**
 * Appends one row to the append-only `fueling_logs` table —
 * `getWeeklyPerformance()` (`lib/dashboard-data.ts`) reads the last 7 days
 * of these for the Dashboard's Weekly Performance Panel. Pre-ride plans log
 * unconditionally on every calculation (each one represents a genuine
 * planned ride); post-ride analyses pass `activityId` so the caller can
 * dedupe — re-viewing the same past ride's analysis shouldn't double-count
 * it.
 */
export async function logFuelingPlan(
  supabase: SupabaseClient,
  params: {
    profileId: string;
    kind: FuelingLogKind;
    activityId?: string | null;
    totalCarbsG: number;
    fluidMl: number;
    sodiumMg: number;
    moneySaved: number;
  }
): Promise<void> {
  const { error } = await supabase.from("fueling_logs").insert({
    profile_id: params.profileId,
    kind: params.kind,
    activity_id: params.activityId ?? null,
    total_carbs_g: params.totalCarbsG,
    fluid_ml: params.fluidMl,
    sodium_mg: params.sodiumMg,
    money_saved: params.moneySaved,
  });
  if (error) throw error;
}

/** True if a `post_ride` log already exists for this activity — used to
 * avoid double-counting the same ride's analysis in the lifetime totals. */
export async function hasPostRideLog(
  supabase: SupabaseClient,
  profileId: string,
  activityId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("fueling_logs")
    .select("id")
    .eq("profile_id", profileId)
    .eq("kind", "post_ride")
    .eq("activity_id", activityId)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

/**
 * Persists what the athlete says they *actually* consumed during a ride —
 * `logFuelingPlan()`'s post-ride row only ever logs the raw burned/lost
 * figures (an append-only physiological record, written once), so this is a
 * separate `UPDATE` on that same row, called whenever the athlete edits the
 * "¿Qué consumiste realmente?" inputs in `components/post-ride-analysis.tsx`.
 * Requires an UPDATE RLS policy on `fueling_logs` (`auth.uid() = profile_id`)
 * — without it this silently matches zero rows, same gotcha as every other
 * write in this app that isn't a plain SELECT/INSERT. Returns whether a row
 * was actually updated so the caller can surface that instead of pretending
 * the save succeeded.
 */
export async function saveConsumedAmounts(
  supabase: SupabaseClient,
  params: {
    profileId: string;
    activityId: string;
    carbsConsumedG: number;
    fluidConsumedMl: number;
    sodiumConsumedMg: number;
  }
): Promise<boolean> {
  const { data, error } = await supabase
    .from("fueling_logs")
    .update({
      carbs_consumed_g: params.carbsConsumedG,
      fluid_consumed_ml: params.fluidConsumedMl,
      sodium_consumed_mg: params.sodiumConsumedMg,
    })
    .eq("profile_id", params.profileId)
    .eq("kind", "post_ride")
    .eq("activity_id", params.activityId)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

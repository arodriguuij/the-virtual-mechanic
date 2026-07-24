import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type FuelingLogKind = "pre_ride" | "post_ride";

/**
 * Appends one row to the lifetime `fueling_logs` accumulator —
 * `getFuelingTotals()` (`lib/dashboard-data.ts`) just sums these. Pre-ride
 * plans log unconditionally on every calculation (each one represents a
 * genuine planned ride); post-ride analyses pass `activityId` so the
 * caller can dedupe — re-viewing the same past ride's analysis shouldn't
 * inflate the totals every time.
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

import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import type { AthleteType, GutTrainingLevel, SweatRate } from "@/lib/metabolic-engine";

const VALID_SWEAT_RATES = new Set<SweatRate>(["low", "medium", "high"]);
const VALID_GUT_TRAINING_LEVELS = new Set<GutTrainingLevel>([
  "beginner",
  "intermediate",
  "advanced",
  "pro",
]);
const VALID_ATHLETE_TYPES = new Set<AthleteType>(["diesel", "balanced", "explosive"]);
const VALID_BOTTLE_COUNTS = new Set([1, 2]);
const VALID_BOTTLE_CAPACITIES_ML = new Set([500, 600, 750, 950]);

export async function POST(request: NextRequest) {
  const redirectWithError = (code: string) =>
    NextResponse.redirect(new URL(`/perfil?profile_error=${code}`, request.url), { status: 303 });

  const formData = await request.formData();
  const weightKg = Number(formData.get("weight_kg"));
  const ftp = Number(formData.get("ftp"));
  const sweatRate = formData.get("sweat_rate")?.toString();
  const gutTrainingLevel = formData.get("gut_training_level")?.toString();
  const athleteType = formData.get("athlete_type")?.toString();
  const bottleCount = Number(formData.get("bottle_count"));
  const bottleCapacityMl = Number(formData.get("bottle_capacity_ml"));
  // Unchecked checkboxes simply aren't present in FormData at all — this is
  // "checked or not", never invalid input, so there's no validation branch.
  const isSaltySweater = formData.get("is_salty_sweater") != null;

  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    return redirectWithError("invalid_weight");
  }
  if (!Number.isFinite(ftp) || ftp <= 0) {
    return redirectWithError("invalid_ftp");
  }
  if (!sweatRate || !VALID_SWEAT_RATES.has(sweatRate as SweatRate)) {
    return redirectWithError("invalid_sweat_rate");
  }
  if (!gutTrainingLevel || !VALID_GUT_TRAINING_LEVELS.has(gutTrainingLevel as GutTrainingLevel)) {
    return redirectWithError("invalid_gut_training_level");
  }
  if (!athleteType || !VALID_ATHLETE_TYPES.has(athleteType as AthleteType)) {
    return redirectWithError("invalid_athlete_type");
  }
  if (!VALID_BOTTLE_COUNTS.has(bottleCount)) {
    return redirectWithError("invalid_bottle_count");
  }
  if (!VALID_BOTTLE_CAPACITIES_ML.has(bottleCapacityMl)) {
    return redirectWithError("invalid_bottle_capacity_ml");
  }

  const supabase = await getAuthenticatedSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    return redirectWithError("no_session");
  }

  const { data: updated, error: upsertError } = await supabase
    .from("athlete_profiles")
    .upsert({
      id: userId,
      weight_kg: weightKg,
      ftp,
      sweat_rate: sweatRate,
      gut_training_level: gutTrainingLevel,
      athlete_type: athleteType,
      bottle_count: bottleCount,
      bottle_capacity_ml: bottleCapacityMl,
      is_salty_sweater: isSaltySweater,
    })
    .select("id")
    .maybeSingle();
  if (upsertError) throw upsertError;
  if (!updated) {
    // RLS silently matched zero rows instead of erroring — surface that
    // explicitly rather than redirecting as if the save succeeded.
    return redirectWithError("update_blocked_by_rls");
  }

  return NextResponse.redirect(new URL("/perfil?profile_saved=1", request.url), { status: 303 });
}

import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import type { SweatRate } from "@/lib/metabolic-engine";

const VALID_SWEAT_RATES = new Set<SweatRate>(["low", "medium", "high"]);

export async function POST(request: NextRequest) {
  const redirectWithError = (code: string) =>
    NextResponse.redirect(new URL(`/?profile_error=${code}`, request.url), { status: 303 });

  const formData = await request.formData();
  const weightKg = Number(formData.get("weight_kg"));
  const ftp = Number(formData.get("ftp"));
  const sweatRate = formData.get("sweat_rate")?.toString();

  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    return redirectWithError("invalid_weight");
  }
  if (!Number.isFinite(ftp) || ftp <= 0) {
    return redirectWithError("invalid_ftp");
  }
  if (!sweatRate || !VALID_SWEAT_RATES.has(sweatRate as SweatRate)) {
    return redirectWithError("invalid_sweat_rate");
  }

  const supabase = await getAuthenticatedSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    return redirectWithError("no_session");
  }

  const { data: updated, error: upsertError } = await supabase
    .from("athlete_profiles")
    .upsert({ id: userId, weight_kg: weightKg, ftp, sweat_rate: sweatRate })
    .select("id")
    .maybeSingle();
  if (upsertError) throw upsertError;
  if (!updated) {
    // RLS silently matched zero rows instead of erroring — surface that
    // explicitly rather than redirecting as if the save succeeded.
    return redirectWithError("update_blocked_by_rls");
  }

  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}

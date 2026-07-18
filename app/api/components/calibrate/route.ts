import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { getEffectiveMaxKm, REAR_TIRE_TRACTION_MULTIPLIER } from "@/lib/wear-model";

const VALID_GAUGE_READINGS = new Set([0.5, 0.75, 1.0]);

export async function POST(request: NextRequest) {
  const redirectWithError = (code: string) =>
    NextResponse.redirect(new URL(`/?calibration_error=${code}`, request.url), { status: 303 });

  const formData = await request.formData();
  const componentId = formData.get("componentId")?.toString();
  const method = formData.get("method")?.toString();

  if (!componentId || !method) {
    return redirectWithError("missing_fields");
  }

  const supabase = await getAuthenticatedSupabaseClient();

  const { data: component, error: fetchError } = await supabase
    .from("components")
    .select("id, type, tier, max_km")
    .eq("id", componentId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!component) {
    return redirectWithError("not_found");
  }

  let wearPercentage: number;
  let statusType: "estimated" | "certified";

  if (method === "new") {
    wearPercentage = 0;
    statusType = "certified";
  } else if (method === "km") {
    const kmValue = Number(formData.get("km"));
    if (!Number.isFinite(kmValue) || kmValue < 0) {
      return redirectWithError("invalid_km");
    }
    const effectiveMaxKm = getEffectiveMaxKm(component.type, component.tier, component.max_km);
    // Same asymmetry the ride sync applies: a manually-entered mileage still
    // means more accumulated stress on the rear tire, not less, just because
    // it came from a form instead of a Strava activity.
    const tractionMultiplier =
      component.type === "tire_rear" ? REAR_TIRE_TRACTION_MULTIPLIER : 1;
    wearPercentage =
      Math.min(100, Math.round((kmValue / effectiveMaxKm) * tractionMultiplier * 1000) / 10);
    statusType = "estimated";
  } else if (method === "gauge") {
    if (component.type !== "chain") {
      return redirectWithError("gauge_not_supported");
    }
    const gauge = Number(formData.get("gauge"));
    if (!VALID_GAUGE_READINGS.has(gauge)) {
      return redirectWithError("invalid_gauge");
    }
    wearPercentage = Math.round(gauge * 100 * 10) / 10;
    statusType = "estimated";
  } else {
    return redirectWithError("invalid_method");
  }

  const { data: updated, error: updateError } = await supabase
    .from("components")
    .update({ current_wear_percentage: wearPercentage, status_type: statusType })
    .eq("id", componentId)
    .select("id")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) {
    // RLS silently matched zero rows instead of erroring — surface that
    // explicitly rather than redirecting as if the save succeeded.
    return redirectWithError("update_blocked_by_rls");
  }

  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}

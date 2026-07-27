import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { saveConsumedAmounts } from "@/lib/fueling-logs";

/**
 * Saves the athlete's real in-ride consumption onto the already-logged
 * `post_ride` row for this activity (see `getRecoveryDebt`/the "¿Qué
 * consumiste realmente?" inputs in `components/post-ride-analysis.tsx`) —
 * this is what makes the Weekly Performance Panel's compliance/hydration
 * figures real measured data rather than an unmeasurable "did you follow
 * the plan" guess.
 */
export async function POST(request: NextRequest) {
  const supabase = await getAuthenticatedSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const activityId = typeof body?.activityId === "string" ? body.activityId : null;
  const carbsConsumedG = Number(body?.carbsConsumedG);
  const fluidConsumedMl = Number(body?.fluidConsumedMl);
  const sodiumConsumedMg = Number(body?.sodiumConsumedMg);
  if (
    !activityId ||
    !Number.isFinite(carbsConsumedG) ||
    !Number.isFinite(fluidConsumedMl) ||
    !Number.isFinite(sodiumConsumedMg)
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const saved = await saveConsumedAmounts(supabase, {
    profileId: userId,
    activityId,
    carbsConsumedG: Math.max(0, Math.round(carbsConsumedG)),
    fluidConsumedMl: Math.max(0, Math.round(fluidConsumedMl)),
    sodiumConsumedMg: Math.max(0, Math.round(sodiumConsumedMg)),
  });
  if (!saved) {
    // Either the RLS UPDATE policy is missing (matches zero rows silently)
    // or there's no post_ride log for this activity yet — either way, don't
    // pretend the save succeeded.
    return NextResponse.json({ error: "update_blocked_or_missing" }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}

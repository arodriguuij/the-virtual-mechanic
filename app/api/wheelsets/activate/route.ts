import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { activateWheelset } from "@/lib/wheelsets";

export async function POST(request: NextRequest) {
  const redirectWithError = (code: string) =>
    NextResponse.redirect(new URL(`/?wheelset_error=${code}`, request.url), { status: 303 });

  const formData = await request.formData();
  const wheelsetId = formData.get("wheelsetId")?.toString();
  if (!wheelsetId) {
    return redirectWithError("missing_fields");
  }

  const supabase = await getAuthenticatedSupabaseClient();

  const { data: wheelset, error: fetchError } = await supabase
    .from("wheelsets")
    .select("id, bike_id")
    .eq("id", wheelsetId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!wheelset) {
    return redirectWithError("not_found");
  }

  const activated = await activateWheelset(supabase, wheelset.bike_id, wheelset.id);
  if (!activated) {
    // RLS silently matched zero rows instead of erroring — surface that
    // explicitly rather than redirecting as if the save succeeded.
    return redirectWithError("update_blocked_by_rls");
  }

  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}

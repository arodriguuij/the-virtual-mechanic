import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  const redirectWithError = (code: string) =>
    NextResponse.redirect(new URL(`/?lube_error=${code}`, request.url), { status: 303 });

  const formData = await request.formData();
  const componentId = formData.get("componentId")?.toString();
  if (!componentId) {
    return redirectWithError("missing_fields");
  }

  const supabase = await getAuthenticatedSupabaseClient();

  const { data: component, error: fetchError } = await supabase
    .from("components")
    .select("id, type")
    .eq("id", componentId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!component) {
    return redirectWithError("not_found");
  }
  if (component.type !== "chain") {
    return redirectWithError("not_a_chain");
  }

  const { data: updated, error: updateError } = await supabase
    .from("components")
    .update({ kms_since_last_lube: 0 })
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

import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import type { LubricantType } from "@/lib/wear-model";

const VALID_LUBRICANT_TYPES = new Set<LubricantType>(["oil", "liquid_wax", "hot_wax"]);

export async function POST(request: NextRequest) {
  const redirectWithError = (code: string) =>
    NextResponse.redirect(new URL(`/?lube_error=${code}`, request.url), { status: 303 });

  const formData = await request.formData();
  const componentId = formData.get("componentId")?.toString();
  const lubricantType = formData.get("lubricantType")?.toString();

  if (!componentId || !lubricantType) {
    return redirectWithError("missing_fields");
  }
  if (!VALID_LUBRICANT_TYPES.has(lubricantType as LubricantType)) {
    return redirectWithError("invalid_lubricant_type");
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
    .update({
      lubricant_type: lubricantType,
      // `lubricant_type` itself is non-null everywhere from a migration
      // default, so this flag is what actually signals "the user chose
      // this" for the Digital Twin fidelity score.
      lubricant_set_by_user: true,
    })
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

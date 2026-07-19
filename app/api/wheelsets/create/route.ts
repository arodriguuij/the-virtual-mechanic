import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { createWheelset } from "@/lib/wheelsets";

export async function POST(request: NextRequest) {
  const redirectWithError = (code: string) =>
    NextResponse.redirect(new URL(`/?wheelset_error=${code}`, request.url), { status: 303 });

  const formData = await request.formData();
  const bikeId = formData.get("bikeId")?.toString();
  const name = formData.get("name")?.toString()?.trim();
  if (!bikeId || !name) {
    return redirectWithError("missing_fields");
  }

  const supabase = await getAuthenticatedSupabaseClient();
  await createWheelset(supabase, bikeId, name);

  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}

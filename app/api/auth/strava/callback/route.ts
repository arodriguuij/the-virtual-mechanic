import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { exchangeCodeForToken, getStravaRedirectUri } from "@/lib/strava";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const stravaError = request.nextUrl.searchParams.get("error");

  if (stravaError) {
    return NextResponse.redirect(
      new URL(`/?strava_error=${encodeURIComponent(stravaError)}`, request.url)
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?strava_error=missing_code", request.url));
  }

  let token;
  try {
    token = await exchangeCodeForToken(code, getStravaRedirectUri(request.url));
  } catch (error) {
    console.error("Strava token exchange failed:", error);
    return NextResponse.redirect(new URL("/?strava_error=token_exchange_failed", request.url));
  }

  const supabase = await getAuthenticatedSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    return NextResponse.redirect(new URL("/?strava_error=no_session", request.url));
  }

  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update({
      strava_athlete_id: token.athlete?.id != null ? String(token.athlete.id) : null,
      strava_access_token: token.access_token,
      strava_refresh_token: token.refresh_token,
      strava_expires_at: new Date(token.expires_at * 1000).toISOString(),
    })
    .eq("id", userId)
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("Failed to persist Strava tokens:", updateError);
    return NextResponse.redirect(new URL("/?strava_error=save_failed", request.url));
  }
  if (!updated) {
    // RLS silently matched zero rows (e.g. missing UPDATE policy) instead of
    // erroring — surface that explicitly rather than redirecting as if the
    // connection succeeded.
    return NextResponse.redirect(new URL("/?strava_error=update_blocked_by_rls", request.url));
  }

  return NextResponse.redirect(new URL("/", request.url));
}

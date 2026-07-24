import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { exchangeCodeForToken, fetchAthlete, getStravaRedirectUri } from "@/lib/strava";

// Placeholder physiological defaults for a brand-new athlete_profiles row —
// Strava only ever gives us weight, never FTP or sweat rate, so a first-time
// connection still needs *something* non-null to satisfy the table's
// NOT NULL columns until the athlete edits their real numbers.
const DEFAULT_FTP = 200;
const DEFAULT_SWEAT_RATE = "medium";

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

  // Zero-friction weight sync: pull it straight from the athlete's own
  // Strava profile instead of asking them to type it in. Best-effort — a
  // failure here shouldn't undo an otherwise-successful Strava connection.
  try {
    const athlete = await fetchAthlete(token.access_token);
    if (athlete.weight) {
      const { data: existingAthleteProfile } = await supabase
        .from("athlete_profiles")
        .select("id")
        .eq("id", userId)
        .maybeSingle();

      if (existingAthleteProfile) {
        await supabase
          .from("athlete_profiles")
          .update({ weight_kg: athlete.weight })
          .eq("id", userId);
      } else {
        await supabase.from("athlete_profiles").insert({
          id: userId,
          weight_kg: athlete.weight,
          ftp: DEFAULT_FTP,
          sweat_rate: DEFAULT_SWEAT_RATE,
        });
      }
    }
  } catch (error) {
    console.error("No se pudo sincronizar el peso del atleta desde Strava:", error);
  }

  return NextResponse.redirect(new URL("/", request.url));
}

import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { exchangeCodeForToken, fetchAthlete, getStravaRedirectUri } from "@/lib/strava";
import { fetchAthleteRoutes } from "@/lib/strava-routes";
import { syncLatestActivity } from "@/lib/strava-sync";
import { stravaRoutesCacheTag, STRAVA_ROUTES_REVALIDATE_SECONDS } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

// Placeholder physiological defaults for a brand-new athlete_profiles row —
// Strava only ever gives us weight, never FTP or sweat rate, so a first-time
// connection still needs *something* non-null to satisfy the table's
// NOT NULL columns until the athlete edits their real numbers.
const DEFAULT_FTP = 200;
const DEFAULT_SWEAT_RATE = "medium";

/** Strava isn't a supported Supabase Auth OAuth provider (it doesn't even
 * implement OpenID Connect, so it can't be bridged as a generic OIDC
 * provider either) — this domain never receives mail, it exists purely as
 * a stable, unique key so the same Strava athlete always maps back to the
 * same Supabase Auth user across logins. Safe to rename on a rebrand: an
 * existing account is only ever matched via `profiles.strava_athlete_id` →
 * `getUserById()` (see below), never by reconstructing this string from an
 * athlete id, so a domain change only affects brand-new signups going
 * forward — no already-created account's real stored email changes. */
function syntheticEmailFor(stravaAthleteId: number): string {
  return `strava-${stravaAthleteId}@strava.users.ratio.internal`;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const stravaError = request.nextUrl.searchParams.get("error");

  if (stravaError) {
    return NextResponse.redirect(
      new URL(`/login?strava_error=${encodeURIComponent(stravaError)}`, request.url)
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL("/login?strava_error=missing_code", request.url));
  }

  let token;
  try {
    token = await exchangeCodeForToken(code, getStravaRedirectUri(request.url));
  } catch (error) {
    console.error("Strava token exchange failed:", error);
    return NextResponse.redirect(new URL("/login?strava_error=token_exchange_failed", request.url));
  }

  const stravaAthleteId = token.athlete?.id;
  if (stravaAthleteId == null) {
    return NextResponse.redirect(new URL("/login?strava_error=missing_athlete_id", request.url));
  }

  // --- Strava→Supabase auth bridge ---
  // Strava isn't a native Supabase OAuth provider, so a real Supabase Auth
  // session for "this Strava athlete" has to be established server-side via
  // the Admin API: `generateLink` both provisions the Supabase Auth user
  // (first login) *and* locates the existing one (every login after) when
  // keyed by the same deterministic email, then `verifyOtp` on a
  // request-scoped client turns that link into an actual session, setting
  // real cookies on this response.
  const admin = getSupabaseAdminClient();

  // A `profiles` row for this exact Strava athlete may already exist from
  // before real auth existed (the dev/seed user this app used while it only
  // had one hardcoded account) — reuse *that* account's real email so this
  // login lands on their existing data instead of silently forking a new,
  // empty identity. Only athletes truly never seen before get the
  // synthetic, no-real-email account.
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("strava_athlete_id", String(stravaAthleteId))
    .maybeSingle();

  let email = syntheticEmailFor(stravaAthleteId);
  let isNewAccount = true;
  if (existingProfile) {
    const { data: existingUser } = await admin.auth.admin.getUserById(existingProfile.id);
    if (existingUser.user?.email) {
      email = existingUser.user.email;
      isNewAccount = false;
    }
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !linkData.properties?.hashed_token) {
    console.error("No se pudo generar el enlace de sesión de Supabase:", linkError);
    return NextResponse.redirect(new URL("/login?strava_error=auth_bridge_failed", request.url));
  }

  const supabase = await getAuthenticatedSupabaseClient();
  // Supabase's actual verification type differs by whether this Strava
  // athlete already had a Supabase Auth user: a brand-new one comes back as
  // "signup", a returning one as "magiclink" — `verifyOtp` rejects a
  // "signup" token if told to expect "magiclink" (verified against the real
  // API while building this), so the type must be read from the response,
  // never assumed.
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: linkData.properties.verification_type,
  });
  if (verifyError) {
    console.error("No se pudo verificar la sesión de Supabase:", verifyError);
    return NextResponse.redirect(new URL("/login?strava_error=auth_bridge_failed", request.url));
  }

  const userId = linkData.user.id;

  const { error: profileError } = await supabase.from("profiles").upsert({
    id: userId,
    // Only stamp the synthetic placeholder on a genuinely new account —
    // reusing an existing one must never overwrite whatever real email (or
    // prior synthetic one) is already on that row.
    ...(isNewAccount ? { email } : {}),
    strava_athlete_id: String(stravaAthleteId),
    strava_access_token: token.access_token,
    strava_refresh_token: token.refresh_token,
    strava_expires_at: new Date(token.expires_at * 1000).toISOString(),
  });
  if (profileError) {
    console.error("Failed to persist Strava tokens:", profileError);
    return NextResponse.redirect(new URL("/login?strava_error=save_failed", request.url));
  }

  // Zero-friction weight sync: pull it straight from the athlete's own
  // Strava profile instead of asking them to type it in. Best-effort — a
  // failure here shouldn't undo an otherwise-successful login.
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

  // First-login onboarding bootstrap: a brand-new athlete's Dashboard,
  // "Al llegar," and Historial would otherwise all sit empty until they
  // manually hit "Sincronizar Strava" for the first time — this pre-loads
  // their saved routes and their latest ride so those screens have real data
  // from the very first render. Only for `isNewAccount` (a Strava athlete
  // genuinely never seen before), never on a returning login, and each is
  // its own best-effort try/catch — a failure here must never undo an
  // otherwise-successful login/token save above.
  if (isNewAccount) {
    try {
      const warmRoutesCache = unstable_cache(
        async () => fetchAthleteRoutes(token.access_token),
        [stravaRoutesCacheTag(userId)],
        {
          revalidate: STRAVA_ROUTES_REVALIDATE_SECONDS,
          tags: [stravaRoutesCacheTag(userId)],
        }
      );
      await warmRoutesCache();
    } catch (error) {
      console.error("No se pudieron precargar las rutas guardadas de Strava:", error);
    }

    try {
      await syncLatestActivity(supabase, userId, token.access_token);
    } catch (error) {
      console.error("No se pudo sincronizar la última salida en el primer login:", error);
    }
  }

  return NextResponse.redirect(new URL("/", request.url));
}

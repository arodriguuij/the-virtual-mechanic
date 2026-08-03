import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { getValidStravaAccessToken } from "@/lib/strava-session";
import { fetchRouteElevationExtremes } from "@/lib/strava-routes";

// "Mini-Gráfico de Altimetría Universal" — a GPX upload already has its own
// per-point elevation locally, so `ElevationSparkline` can render for it in
// Step 01 with zero extra network cost (see that component's own doc
// comment). A saved Strava route has no equivalent client-side data — its
// full altitude stream is normally only fetched once, server-side, when
// the athlete actually clicks "Calcular estrategia" (`fetchRouteElevationExtremes`,
// deliberately never eager, to avoid passive Strava traffic on every route
// in the list). This endpoint is the one deliberate exception: fetched
// exactly once per *explicit* route selection (not per route in the list,
// not on every render) so the same sparkline can render immediately in
// Step 01 for a selected Strava route too, matching GPX mode. Requires
// only a valid session (not the athlete's own profile data), same as
// `POST /api/fueling/gpx`.
export async function GET(request: NextRequest) {
  const supabase = await getAuthenticatedSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const routeId = request.nextUrl.searchParams.get("routeId");
  if (!routeId) {
    return NextResponse.json({ error: "invalid_route" }, { status: 400 });
  }

  const accessToken = await getValidStravaAccessToken(supabase, userId);
  if (!accessToken) {
    return NextResponse.json({ error: "strava_not_connected" }, { status: 400 });
  }

  const extremes = await fetchRouteElevationExtremes(accessToken, routeId);
  return NextResponse.json({ elevationProfile: extremes?.elevationProfile ?? [] });
}

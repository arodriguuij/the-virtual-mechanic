import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { getPeakName } from "@/lib/overpass";

// A thin HTTP wrapper around `lib/overpass.ts`'s own `getPeakName()` — the
// actual fueling-plan calculation already resolves peak names server-side,
// directly inside `POST /api/fueling/plan` (never from the browser, so
// there's no CORS exposure to begin with), but this endpoint exists as a
// standalone, independently reachable/testable entry point into the same
// Overpass query, same "route wraps a lib function" convention every other
// route in this app already follows. Requires only a valid session (not the
// athlete's own profile data), same as `POST /api/fueling/gpx`.
export async function GET(request: NextRequest) {
  const supabase = await getAuthenticatedSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user?.id) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "invalid_coordinates" }, { status: 400 });
  }

  // Both optional — only used to build the fallback string
  // (`Cima Km {distanceKm} · {elevationM}m`) when OSM has nothing named at
  // this exact spot, not part of the Overpass query itself.
  const distanceKm = Number(searchParams.get("distanceKm")) || 0;
  const elevationM = Number(searchParams.get("elevationM")) || 0;

  const name = await getPeakName(lat, lon, distanceKm, elevationM);
  return NextResponse.json({ name });
}

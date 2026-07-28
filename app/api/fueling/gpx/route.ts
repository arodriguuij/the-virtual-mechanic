import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { decodePolyline } from "@/lib/strava";
import { buildRouteGpx } from "@/lib/gpx-export";

// ̀-ͯ is the Unicode "Combining Diacritical Marks" block —
// stripping it after NFD normalization turns "á" into a bare "a", giving a
// plain-ASCII filename regardless of accents in the route's own name.
const COMBINING_ACCENTS = /[̀-ͯ]/g;

function slugifyFilename(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(COMBINING_ACCENTS, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "ruta"
  );
}

// Deliberately just the route itself — no nutrition waypoints/milestones
// injected (see `lib/gpx-export.ts`'s own docs). Only requires a valid
// session (not the athlete's own profile data), same as every other route in
// this app — no anonymous/unauthenticated access.
export async function POST(request: NextRequest) {
  const supabase = await getAuthenticatedSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user?.id) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const routeName = typeof body?.routeName === "string" ? body.routeName : "Ruta";
  const summaryPolyline = typeof body?.summaryPolyline === "string" ? body.summaryPolyline : null;
  if (!summaryPolyline) {
    return NextResponse.json({ error: "invalid_route" }, { status: 400 });
  }

  const coordinates = decodePolyline(summaryPolyline);
  if (coordinates.length === 0) {
    return NextResponse.json({ error: "no_track" }, { status: 400 });
  }

  const gpx = buildRouteGpx({ routeName, coordinates });
  const filename = `${slugifyFilename(routeName)}.gpx`;

  return new NextResponse(gpx, {
    headers: {
      "Content-Type": "application/gpx+xml",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

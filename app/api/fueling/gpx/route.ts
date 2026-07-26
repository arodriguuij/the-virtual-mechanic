import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { decodePolyline } from "@/lib/strava";
import { buildNutritionGpx, type GpxWaypoint } from "@/lib/gpx-export";
import type { NutritionMilestone, ReloadStrategy } from "@/lib/metabolic-engine";

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

export async function POST(request: NextRequest) {
  // Only requires a valid session (not the athlete's own profile data), same
  // as every other route in this app — no anonymous/unauthenticated access.
  const supabase = await getAuthenticatedSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user?.id) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const routeName = typeof body?.routeName === "string" ? body.routeName : "Ruta";
  const summaryPolyline = typeof body?.summaryPolyline === "string" ? body.summaryPolyline : null;
  const distanceKm = typeof body?.distanceKm === "number" ? body.distanceKm : null;
  if (!summaryPolyline || !distanceKm || distanceKm <= 0) {
    return NextResponse.json({ error: "invalid_route" }, { status: 400 });
  }

  const milestones: NutritionMilestone[] = Array.isArray(body?.milestones) ? body.milestones : [];
  const reloadStrategy: ReloadStrategy | null = body?.reloadStrategy ?? null;

  const coordinates = decodePolyline(summaryPolyline);
  if (coordinates.length === 0) {
    return NextResponse.json({ error: "no_track" }, { status: 400 });
  }

  const waypoints: GpxWaypoint[] = milestones
    .filter((m) => m.atKm != null)
    .map((m) => ({ name: m.label, atKm: m.atKm as number }));
  if (reloadStrategy?.reloadAtKm != null) {
    waypoints.push({ name: "Parada Ziploc / rellenar bidon", atKm: reloadStrategy.reloadAtKm });
  }

  const gpx = buildNutritionGpx({ routeName, coordinates, distanceKm, waypoints });
  const filename = `${slugifyFilename(routeName)}-nutricion.gpx`;

  return new NextResponse(gpx, {
    headers: {
      "Content-Type": "application/gpx+xml",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

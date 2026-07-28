import { NextResponse } from "next/server";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { getValidStravaAccessToken } from "@/lib/strava-session";
import { syncLatestActivity } from "@/lib/strava-sync";

export async function POST() {
  const errorResponse = (code: string, status: number) =>
    NextResponse.json({ error: code }, { status });

  const supabase = await getAuthenticatedSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) return errorResponse("no_session", 401);

  const accessToken = await getValidStravaAccessToken(supabase, userId);
  if (!accessToken) {
    return errorResponse("not_connected", 400);
  }

  const result = await syncLatestActivity(supabase, userId, accessToken);
  if (result.status === "no_rides") {
    return errorResponse("no_rides", 404);
  }

  return NextResponse.json({
    success: true,
    activityName: result.activityName,
    isNew: result.isNew,
  });
}

"use server";

import { updateTag } from "next/cache";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import { stravaRoutesCacheTag } from "@/lib/dashboard-data";

/**
 * Manual "refresh routes" trigger for the fueling planner's route selector —
 * `getStravaRoutes()` caches the athlete's saved-routes list for 24h (see
 * `lib/dashboard-data.ts`) to cut Strava API traffic, so an athlete who just
 * starred a new route on Strava needs an explicit way to bypass that cache
 * rather than waiting up to a full day for it to naturally expire.
 * `updateTag` (not `revalidateTag`) is the deliberate choice here — this is a
 * Server Action, and clicking "Recargar" is a textbook read-your-own-writes
 * case: the athlete wants the *next* request (the `router.refresh()` right
 * after this action resolves) to wait for genuinely fresh data, not serve
 * one more round of stale-while-revalidate. A no-op (never throws) when
 * there's no session, matching this codebase's existing "degrade
 * gracefully" convention for auth-gated data fetches.
 */
export async function refreshStravaRoutes(): Promise<void> {
  const supabase = await getAuthenticatedSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) return;
  updateTag(stravaRoutesCacheTag(userId));
}

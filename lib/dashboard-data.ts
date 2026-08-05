import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import type { AthleteType, ExperienceMode, GutTrainingLevel, SweatRate } from "@/lib/metabolic-engine";
import { isProfileDataComplete } from "@/lib/profile-completeness";
import { fetchAthlete } from "@/lib/strava";
import { getValidStravaAccessToken } from "@/lib/strava-session";
import { fetchAthleteRoutes, type StravaRoute } from "@/lib/strava-routes";
import { syncLatestActivity } from "@/lib/strava-sync";

export type AthleteProfile = {
  id: string;
  ftp: number;
  weight_kg: number;
  sweat_rate: SweatRate;
  gut_training_level: GutTrainingLevel;
  athlete_type: AthleteType;
  bottle_count: number;
  bottle_capacity_ml: number;
  is_salty_sweater: boolean;
  experience_mode?: ExperienceMode;
};

export type Activity = {
  id: string;
  name: string;
  distance: number; // metros
  total_elevation_gain: number | null;
  moving_time: number; // segundos
  average_watts: number | null;
  rain_mm: number;
  humidity_avg: number;
  temperature_avg: number | null;
  carbs_burned_g: number | null;
  fluid_loss_ml: number | null;
  sodium_loss_mg: number | null;
  activity_date: string;
};

export type Profile = {
  id: string;
  strava_athlete_id: string | null;
};

/**
 * Whether this athlete has a usable Physiological Profile. Delegates to
 * `lib/profile-completeness.ts`'s `isProfileDataComplete` — the same
 * predicate `proxy.ts`'s Edge Middleware evaluates on every navigation to
 * enforce the mandatory-profile-completion redirect (see CLAUDE.md's
 * "Mandatory profile completion" section) — rather than duplicating the
 * four-field check here, so the two can never silently diverge on what
 * "complete" means.
 */
export function isProfileComplete(profile: AthleteProfile | null): boolean {
  return isProfileDataComplete(profile);
}

/**
 * Live Strava weight, for prefilling `/perfil`'s weight input only — never
 * written to the database on the athlete's behalf (see `app/api/auth/strava/
 * callback/route.ts`: the callback itself only ever *updates* an
 * already-existing `athlete_profiles` row's weight, it never fabricates a
 * brand-new row with a placeholder FTP/sweat rate to go with it anymore).
 * A brand-new athlete with no profile row yet still shouldn't have to
 * re-type a weight Strava already knows, so `PhysiologicalProfileCard`
 * calls this only when `getAthleteProfile()` returned `null`, and uses the
 * result purely as the form field's `defaultValue`. `null` on anything —
 * not connected to Strava, no weight on their Strava profile, an API
 * hiccup — same "best-effort, never blocks the page" convention as every
 * other Strava read in this file.
 */
export async function getStravaAthleteWeightKg(): Promise<number | null> {
  try {
    const supabase = await getAuthenticatedSupabaseClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) return null;

    const accessToken = await getValidStravaAccessToken(supabase, userId);
    if (!accessToken) return null;

    const athlete = await fetchAthlete(accessToken);
    return athlete.weight;
  } catch {
    return null;
  }
}

export const getAthleteProfile = cache(async (): Promise<AthleteProfile | null> => {
  const supabase = await getAuthenticatedSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("athlete_profiles")
    .select(
      "id, ftp, weight_kg, sweat_rate, gut_training_level, athlete_type, bottle_count, bottle_capacity_ml, is_salty_sweater"
    )
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
});

export type WeeklyPerformance = {
  ridesThisWeekCount: number;
  totalKmThisWeek: number;
  /** Average % of burned carbs actually replaced (capped at 100% per ride)
   * across this week's post-ride analyses that have real consumption data
   * logged — `null` when there's none yet, never a guessed/fabricated
   * number. */
  compliancePct: number | null;
  /** Average consumed-carbs rate across those same rides — real intake,
   * not the planned target. */
  avgIntakeGPerHour: number | null;
  /** `null` when there's no `athlete_profiles` row at all yet — never a
   * fabricated level standing in for one the athlete hasn't actually
   * chosen. */
  gutTrainingLevel: GutTrainingLevel | null;
  /** Average % of fluid+sodium loss actually replaced (capped at 100% per
   * ride, per metric), scaled to a /10 score — same real-data-only
   * convention as `compliancePct`. */
  hydrationScore: number | null;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Powers the Dashboard's "Panel de Rendimiento Semanal" — every figure here
 * is computed from real stored data (`activities` + `fueling_logs`'
 * `*_consumed_*` columns, populated by `POST /api/post-ride/consumption`
 * when the athlete fills in what they actually ate/drank), never a
 * plausible-looking placeholder. Rides/logs with no consumption data yet
 * simply don't contribute to `compliancePct`/`avgIntakeGPerHour`/
 * `hydrationScore` — those stay `null` (not 0, not a guess) until there's
 * at least one real data point, so the UI can show an honest "sin datos
 * todavía" empty state instead of a fabricated score.
 */
export const getWeeklyPerformance = cache(async (): Promise<WeeklyPerformance> => {
  const supabase = await getAuthenticatedSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  const emptyResult: WeeklyPerformance = {
    ridesThisWeekCount: 0,
    totalKmThisWeek: 0,
    compliancePct: null,
    avgIntakeGPerHour: null,
    gutTrainingLevel: null,
    hydrationScore: null,
  };
  if (!userId) return emptyResult;

  const sinceIso = new Date(Date.now() - WEEK_MS).toISOString();

  const [{ data: athleteProfile }, { data: activities, error: activitiesError }] =
    await Promise.all([
      supabase
        .from("athlete_profiles")
        .select("gut_training_level")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("activities")
        .select("id, distance, moving_time")
        .eq("profile_id", userId)
        .gte("activity_date", sinceIso),
    ]);
  if (activitiesError) throw activitiesError;

  const weekActivities = activities ?? [];
  const durationByActivityId = new Map(weekActivities.map((a) => [a.id, a.moving_time]));

  const { data: logs, error: logsError } = await supabase
    .from("fueling_logs")
    .select("activity_id, total_carbs_g, fluid_ml, sodium_mg, carbs_consumed_g, fluid_consumed_ml, sodium_consumed_mg")
    .eq("profile_id", userId)
    .eq("kind", "post_ride")
    .gte("created_at", sinceIso)
    .not("carbs_consumed_g", "is", null);
  if (logsError) throw logsError;

  const logsWithData = logs ?? [];

  const carbRatios = logsWithData
    .filter((l) => l.total_carbs_g > 0)
    .map((l) => Math.min(1, (l.carbs_consumed_g ?? 0) / l.total_carbs_g));

  const hydrationRatios = logsWithData.flatMap((l) => {
    const ratios: number[] = [];
    if (l.fluid_ml > 0) ratios.push(Math.min(1, (l.fluid_consumed_ml ?? 0) / l.fluid_ml));
    if (l.sodium_mg > 0) ratios.push(Math.min(1, (l.sodium_consumed_mg ?? 0) / l.sodium_mg));
    return ratios;
  });

  const intakeRatesGPerHour = logsWithData
    .map((l) => {
      const durationSeconds = l.activity_id ? durationByActivityId.get(l.activity_id) : null;
      if (!durationSeconds || durationSeconds <= 0) return null;
      return (l.carbs_consumed_g ?? 0) / (durationSeconds / 3600);
    })
    .filter((rate): rate is number => rate != null);

  const average = (values: number[]) =>
    values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

  const compliancePct = average(carbRatios);
  const hydrationRatioAvg = average(hydrationRatios);

  return {
    ridesThisWeekCount: weekActivities.length,
    totalKmThisWeek:
      Math.round(weekActivities.reduce((sum, a) => sum + a.distance, 0) / 100) / 10,
    compliancePct: compliancePct != null ? Math.round(compliancePct * 100) : null,
    avgIntakeGPerHour: average(intakeRatesGPerHour)
      ? Math.round(average(intakeRatesGPerHour)!)
      : null,
    gutTrainingLevel: athleteProfile?.gut_training_level ?? null,
    hydrationScore: hydrationRatioAvg != null ? Math.round(hydrationRatioAvg * 100) / 10 : null,
  };
});

/**
 * Shared by every component that needs ride history — the Recovery card and
 * the ride lookbook both call this with the same `limit` so React's
 * `cache()` dedupes them into one Supabase query per request.
 */
export const getRecentActivities = cache(
  async (limit: number = 10): Promise<Activity[]> => {
    const supabase = await getAuthenticatedSupabaseClient();

    const { data, error } = await supabase
      .from("activities")
      .select(
        "id, name, distance, total_elevation_gain, moving_time, average_watts, rain_mm, humidity_avg, temperature_avg, carbs_burned_g, fluid_loss_ml, sodium_loss_mg, activity_date"
      )
      .order("activity_date", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data ?? [];
  }
);

/**
 * Ensures the athlete's latest Strava ride is already synced into
 * `activities` before the Post-Ruta panel reads its ride list — without
 * this, a ride finished since the last visit only shows up once the athlete
 * remembers to click "Sincronizar" in the sidebar; this makes opening the
 * Post-Ruta tab itself the trigger. Wraps `syncLatestActivity()` — the exact
 * same pipeline `POST /api/strava/sync` and the first-login bootstrap
 * already use (`app/api/auth/strava/callback/route.ts`) — one Strava call
 * to find the latest cycling activity via `fetchLatestRideActivity()`
 * (`per_page=30`, sport-type filtered — deliberately not a literal
 * `per_page=1`, which would reintroduce the exact bug that lookback window
 * was widened to fix: a run/swim/gym session logged between rides pushing
 * the last real ride out of a 1-activity window), then a cheap `activities`
 * existence check. That existence check *is* the "already cached, do
 * nothing" fast path — an activity id that's already a row short-circuits
 * before any weather sampling or metabolic-engine work ever runs; only a
 * genuinely new ride pays for the full sync.
 *
 * Best-effort and silent on failure — same convention as the first-login
 * bootstrap's own sync call: a Strava hiccup here must never break the
 * whole Post-Ruta panel, it just means the ride list falls back to
 * whatever was already synced from a previous visit.
 */
export const ensureLatestActivitySynced = cache(async (): Promise<void> => {
  const supabase = await getAuthenticatedSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) return;

  const accessToken = await getValidStravaAccessToken(supabase, userId);
  if (!accessToken) return;

  try {
    await syncLatestActivity(supabase, userId, accessToken);
  } catch (error) {
    console.error("ensureLatestActivitySynced failed:", error);
  }
});

export type IntakeBreakdownEntry = {
  activityId: string;
  activityName: string;
  activityDate: string;
  targetCarbsG: number;
  consumedCarbsG: number;
};

/**
 * Powers `/estadisticas`' "Desglose de Ingesta" card — real consumed-vs-
 * target carbs per ride, for the most recent rides that actually have
 * consumption data logged (`POST /api/post-ride/consumption`). Two queries
 * joined client-side (same `Map`-join pattern as `getWeeklyPerformance`
 * above) rather than a PostgREST embedded-relation select, since this
 * codebase has no generated Supabase types yet to verify the FK's exact
 * constraint name against.
 */
export const getRecentIntakeBreakdown = cache(
  async (limit: number = 6): Promise<IntakeBreakdownEntry[]> => {
    const supabase = await getAuthenticatedSupabaseClient();

    const { data: logs, error: logsError } = await supabase
      .from("fueling_logs")
      .select("activity_id, total_carbs_g, carbs_consumed_g, created_at")
      .eq("kind", "post_ride")
      .not("activity_id", "is", null)
      .not("carbs_consumed_g", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (logsError) throw logsError;

    const entries = logs ?? [];
    if (entries.length === 0) return [];

    const activityIds = entries
      .map((l) => l.activity_id)
      .filter((id): id is string => id != null);
    const { data: activities, error: activitiesError } = await supabase
      .from("activities")
      .select("id, name, activity_date")
      .in("id", activityIds);
    if (activitiesError) throw activitiesError;

    const activityById = new Map((activities ?? []).map((a) => [a.id, a]));

    return entries
      .map((l): IntakeBreakdownEntry | null => {
        const activity = l.activity_id ? activityById.get(l.activity_id) : null;
        if (!activity) return null;
        return {
          activityId: activity.id,
          activityName: activity.name,
          activityDate: activity.activity_date,
          targetCarbsG: l.total_carbs_g,
          consumedCarbsG: l.carbs_consumed_g ?? 0,
        };
      })
      .filter((e): e is IntakeBreakdownEntry => e != null);
  }
);

export type NutritionDiaryEntry = {
  activityId: string;
  activityName: string;
  activityDate: string;
  distanceKm: number;
  /** False whenever this ride has no `post_ride` consumption logged yet —
   * the card renders a muted "sin datos" variant instead of fabricating a
   * compliance figure for a ride nobody ever analyzed. */
  hasConsumptionData: boolean;
  intakeGPerHour: number | null;
  fluidConsumedL: number | null;
  sodiumConsumedMg: number | null;
  /** Real consumed/target ratio as a percentage, uncapped (a ride can
   * genuinely show >100% if the athlete over-fueled) — only the *averaged*
   * summary figure below gets capped per-ride before averaging. */
  compliancePct: number | null;
};

export type GutTrainingTier = { level: 1 | 2 | 3; rangeLabel: string };

export type NutritionDiarySummary = {
  avgCompliancePct: number | null;
  totalCarbsConsumedG: number;
  gutTrainingTier: GutTrainingTier | null;
};

export type NutritionDiary = {
  entries: NutritionDiaryEntry[];
  summary: NutritionDiarySummary;
};

// Its own 3-tier scale, distinct from the 4-level self-reported
// `athlete_profiles.gut_training_level` (Principiante/Intermedio/Avanzado/
// Pro, which caps the *recommendation* — see `getGutTrainingCapGPerHour` in
// `lib/metabolic-engine.ts` — and is edited once on `/perfil`) — this one is
// derived from real logged intake across every ride and is the single
// source of truth for the "Nivel X" badge shown on both `/historial` and
// `/estadisticas`, so the two screens can never show conflicting figures for
// the same underlying data. Checked in descending order; the first match
// wins.
const GUT_TRAINING_TIERS: { minGPerHour: number; level: 1 | 2 | 3; rangeLabel: string }[] = [
  { minGPerHour: 80, level: 3, rangeLabel: "80-90+ g/h" },
  { minGPerHour: 50, level: 2, rangeLabel: "50-75 g/h" },
  { minGPerHour: 30, level: 1, rangeLabel: "30-45 g/h" },
];

/**
 * Real-intake-derived Gut Training tier — exported so `/estadisticas` can
 * compute the exact same "Nivel X" badge `/historial` already shows
 * (`getNutritionDiary` below), both fed by their own screen's real average
 * consumed-carbs-per-hour figure, rather than each screen deriving its own
 * slightly different label.
 */
export function gutTrainingTierFromIntake(avgGPerHour: number | null): GutTrainingTier | null {
  if (avgGPerHour == null) return null;
  for (const tier of GUT_TRAINING_TIERS) {
    if (avgGPerHour >= tier.minGPerHour) return { level: tier.level, rangeLabel: tier.rangeLabel };
  }
  return null;
}

/**
 * Powers `/historial`'s "Diario de Rendimiento Nutricional" — unlike
 * `getWeeklyPerformance` (scoped to the last 7 days for the Dashboard's
 * glance-back panel), every summary figure here is a genuine all-time
 * aggregate across *every* logged ride with real consumption data, not just
 * whatever's in the displayed page. That's why activities/logs are fetched
 * with no limit and the `displayLimit` param only slices the rendered
 * `entries` afterward — an athlete with more synced rides than the display
 * limit would otherwise get a skewed "all-time" figure computed from only
 * their most recent few. Two queries joined client-side via a `Map`, same
 * convention as `getWeeklyPerformance`/`getRecentIntakeBreakdown` above.
 */
export const getNutritionDiary = cache(
  async (displayLimit: number = 20): Promise<NutritionDiary> => {
    const supabase = await getAuthenticatedSupabaseClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    const userId = authData.user?.id;
    const empty: NutritionDiary = {
      entries: [],
      summary: { avgCompliancePct: null, totalCarbsConsumedG: 0, gutTrainingTier: null },
    };
    if (!userId) return empty;

    const [{ data: activities, error: activitiesError }, { data: logs, error: logsError }] =
      await Promise.all([
        supabase
          .from("activities")
          .select("id, name, distance, moving_time, activity_date")
          .eq("profile_id", userId)
          .order("activity_date", { ascending: false }),
        supabase
          .from("fueling_logs")
          .select(
            "activity_id, total_carbs_g, fluid_ml, sodium_mg, carbs_consumed_g, fluid_consumed_ml, sodium_consumed_mg"
          )
          .eq("profile_id", userId)
          .eq("kind", "post_ride")
          .not("carbs_consumed_g", "is", null),
      ]);
    if (activitiesError) throw activitiesError;
    if (logsError) throw logsError;

    const activityRows = activities ?? [];
    if (activityRows.length === 0) return empty;

    const durationByActivityId = new Map(activityRows.map((a) => [a.id, a.moving_time]));
    const logByActivityId = new Map((logs ?? []).map((l) => [l.activity_id, l]));

    function toEntry(activity: (typeof activityRows)[number]): NutritionDiaryEntry {
      const log = logByActivityId.get(activity.id);
      const hasData = Boolean(log);
      const durationHours = activity.moving_time / 3600;
      const intakeGPerHour =
        hasData && durationHours > 0 ? Math.round((log!.carbs_consumed_g ?? 0) / durationHours) : null;
      const compliancePct =
        hasData && log!.total_carbs_g > 0
          ? Math.round(((log!.carbs_consumed_g ?? 0) / log!.total_carbs_g) * 100)
          : null;
      return {
        activityId: activity.id,
        activityName: activity.name,
        activityDate: activity.activity_date,
        distanceKm: Math.round((activity.distance / 1000) * 10) / 10,
        hasConsumptionData: hasData,
        intakeGPerHour,
        fluidConsumedL:
          hasData && log!.fluid_consumed_ml != null
            ? Math.round((log!.fluid_consumed_ml / 1000) * 10) / 10
            : null,
        sodiumConsumedMg: hasData ? (log!.sodium_consumed_mg ?? null) : null,
        compliancePct,
      };
    }

    const entries = activityRows.slice(0, displayLimit).map(toEntry);

    // Summary KPIs below deliberately reuse *all* logs joined against a
    // known ride duration, not just the sliced `entries` above.
    const logsWithDuration = (logs ?? [])
      .map((log) => ({ log, durationSeconds: durationByActivityId.get(log.activity_id) }))
      .filter((x): x is { log: NonNullable<typeof logs>[number]; durationSeconds: number } =>
        Boolean(x.durationSeconds)
      );

    const complianceRatios = logsWithDuration
      .filter((x) => x.log.total_carbs_g > 0)
      .map((x) => Math.min(1, (x.log.carbs_consumed_g ?? 0) / x.log.total_carbs_g));
    const avgCompliancePct =
      complianceRatios.length > 0
        ? Math.round(
            (complianceRatios.reduce((sum, r) => sum + r, 0) / complianceRatios.length) * 100
          )
        : null;

    const totalCarbsConsumedG = Math.round(
      logsWithDuration.reduce((sum, x) => sum + (x.log.carbs_consumed_g ?? 0), 0)
    );

    const intakeRates = logsWithDuration.map(
      (x) => (x.log.carbs_consumed_g ?? 0) / (x.durationSeconds / 3600)
    );
    const avgIntakeGPerHour =
      intakeRates.length > 0 ? intakeRates.reduce((sum, r) => sum + r, 0) / intakeRates.length : null;

    return {
      entries,
      summary: {
        avgCompliancePct,
        totalCarbsConsumedG,
        gutTrainingTier: gutTrainingTierFromIntake(avgIntakeGPerHour),
      },
    };
  }
);

// Cache tag for one athlete's saved-routes list — exported so
// `lib/strava-actions.ts`'s manual refresh Server Action can invalidate
// exactly this user's entry via `revalidateTag`, without affecting anyone
// else's cached routes.
export function stravaRoutesCacheTag(userId: string): string {
  return `strava-routes-${userId}`;
}

// 24h — saved/starred routes on Strava change rarely (an athlete stars a new
// route maybe a few times a month), so a full day between refreshes cuts
// `GET /athlete/routes` calls by roughly 99% against calling it on every
// Dashboard load, while the manual refresh button covers the rare "I just
// starred a new route and want it now" case. Exported so the first-login
// bootstrap (`app/api/auth/strava/callback/route.ts`) can pre-warm this
// exact same Data Cache entry with the identical revalidate window, rather
// than the two drifting out of sync.
export const STRAVA_ROUTES_REVALIDATE_SECONDS = 60 * 60 * 24;

/**
 * The athlete's saved/starred Strava cycling routes, for the fueling
 * planner's route selector. `[]` (not an error) whenever Strava isn't
 * connected or the API call fails — the planner just falls back to its
 * manual quick-calculator mode.
 *
 * The actual Strava call is wrapped in `unstable_cache`, keyed only by
 * `userId` (not the access token, which rotates every ~6h) so a token
 * refresh never defeats the cache — the wrapped closure captures whatever
 * token was valid at cache-population time, and Next's Data Cache returns
 * that same result for `STRAVA_ROUTES_REVALIDATE_SECONDS` regardless of
 * later token rotations, until it naturally expires or `revalidateTag`
 * clears it early. `getAuthenticatedSupabaseClient()`/`auth.getUser()` run
 * *outside* the cached function deliberately — `unstable_cache` throws if a
 * dynamic API like `cookies()` is used inside it, so only the plain network
 * fetch is ever wrapped.
 */
export const getStravaRoutes = cache(async (): Promise<StravaRoute[]> => {
  const supabase = await getAuthenticatedSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) return [];

  const accessToken = await getValidStravaAccessToken(supabase, userId);
  if (!accessToken) return [];

  const fetchCachedRoutes = unstable_cache(
    async () => fetchAthleteRoutes(accessToken),
    [stravaRoutesCacheTag(userId)],
    { revalidate: STRAVA_ROUTES_REVALIDATE_SECONDS, tags: [stravaRoutesCacheTag(userId)] }
  );
  return fetchCachedRoutes();
});

export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await getAuthenticatedSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, strava_athlete_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
});

export type ViewerIdentity = {
  name: string;
  subtitle: string;
  initials: string;
  avatarUrl: string | null;
  isStravaConnected: boolean;
};

function initialsFrom(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

/**
 * The sidebar's "who's logged in" card. There's no real login yet (see
 * "No login yet" in CLAUDE.md — every request is the same dev seed user),
 * so Strava is the only real identity source this app has: if connected,
 * pulls the athlete's actual first/last name and avatar straight from
 * Strava's `/athlete` endpoint. Falls back to the auth user's own email
 * local-part (never a made-up name) when Strava isn't connected or the
 * request fails — same "degrade gracefully, never fabricate" convention as
 * `getStravaRoutes()` returning `[]`.
 */
export const getViewerIdentity = cache(async (): Promise<ViewerIdentity> => {
  const supabase = await getAuthenticatedSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const user = authData.user;

  const emailName = user?.email?.split("@")[0] ?? "Atleta";

  if (user) {
    const accessToken = await getValidStravaAccessToken(supabase, user.id);
    if (accessToken) {
      try {
        const athlete = await fetchAthlete(accessToken);
        const fullName = [athlete.firstname, athlete.lastname].filter(Boolean).join(" ").trim();
        if (fullName) {
          return {
            name: fullName,
            subtitle: "Conectado con Strava",
            initials: initialsFrom(fullName),
            avatarUrl: athlete.profileMedium,
            isStravaConnected: true,
          };
        }
      } catch (error) {
        console.error("No se pudo obtener el atleta de Strava para la tarjeta de perfil:", error);
      }
    }
  }

  return {
    name: emailName,
    subtitle: user ? "Cuenta de desarrollo" : "Sin sesión",
    initials: initialsFrom(emailName),
    avatarUrl: null,
    isStravaConnected: false,
  };
});

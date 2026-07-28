import "server-only";

import { cache } from "react";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";
import type { AthleteType, GutTrainingLevel, SweatRate } from "@/lib/metabolic-engine";
import { fetchAthlete, fetchAthleteStats } from "@/lib/strava";
import { getValidStravaAccessToken } from "@/lib/strava-session";
import { fetchAthleteRoutes, type StravaRoute } from "@/lib/strava-routes";

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

export type MissingProfileField = "ftp" | "sweat_rate" | "weight";

// The Strava→Supabase auth bridge inserts a fresh `athlete_profiles` row with
// this exact placeholder pair (`ftp: 200`, `sweat_rate: 'medium'`) whenever it
// syncs a new athlete's weight with no prior physiological data — see
// `app/api/auth/strava/callback/route.ts`'s `DEFAULT_FTP`/`DEFAULT_SWEAT_RATE`.
// Checking *both* together (rather than either alone) avoids flagging a real
// athlete whose genuine sweat rate happens to be "medium" — only the exact
// untouched pair is a reliable "never configured" signal.
const PLACEHOLDER_FTP = 200;
const PLACEHOLDER_SWEAT_RATE = "medium";

/**
 * "Banner de Onboarding Dinámico" — which critical fields still look like
 * the zero-friction Strava-sync placeholder rather than a real, athlete-
 * entered value. `null` (no `athlete_profiles` row at all yet) flags
 * everything. Pure (no I/O) despite living in this otherwise all-I/O file —
 * kept alongside `AthleteProfile` since it's the type this operates on, and
 * plain enough that `components/profile-check-banner.tsx` (a client
 * component) can't host it directly: calling a function exported from a
 * `"use client"` module from a Server Component throws at runtime, so this
 * lives here and the client component only imports its return *type*.
 */
export function getMissingProfileFields(
  profile: Pick<AthleteProfile, "ftp" | "sweat_rate"> | null
): MissingProfileField[] {
  if (!profile) return ["ftp", "sweat_rate", "weight"];
  if (profile.ftp === PLACEHOLDER_FTP && profile.sweat_rate === PLACEHOLDER_SWEAT_RATE) {
    return ["ftp", "sweat_rate"];
  }
  return [];
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
  gutTrainingLevel: GutTrainingLevel;
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
    gutTrainingLevel: "intermediate",
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
    gutTrainingLevel: athleteProfile?.gut_training_level ?? "intermediate",
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
 * The athlete's saved/starred Strava cycling routes, for the fueling
 * planner's route selector. `[]` (not an error) whenever Strava isn't
 * connected or the API call fails — the planner just falls back to its
 * manual quick-calculator mode.
 */
export const getStravaRoutes = cache(async (): Promise<StravaRoute[]> => {
  const supabase = await getAuthenticatedSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) return [];

  const accessToken = await getValidStravaAccessToken(supabase, userId);
  if (!accessToken) return [];

  return fetchAthleteRoutes(accessToken);
});

/**
 * The athlete's historical average speed (km/h), for the GPX Híbrido
 * uploader's time estimate — prefers the rolling last-4-weeks pace over the
 * all-time one (see `fetchAthleteStats`), and returns `null` (never a
 * fabricated number) when Strava isn't connected or has no ride history to
 * derive a pace from; the uploader falls back to a fixed generic assumption
 * in that case, with a note that it's not personalized.
 */
export const getAthleteAverageSpeedKmh = cache(async (): Promise<number | null> => {
  const supabase = await getAuthenticatedSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("strava_athlete_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.strava_athlete_id) return null;

  const accessToken = await getValidStravaAccessToken(supabase, userId);
  if (!accessToken) return null;

  const stats = await fetchAthleteStats(accessToken, profile.strava_athlete_id);
  return stats.recentAvgSpeedKmh ?? stats.allTimeAvgSpeedKmh;
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

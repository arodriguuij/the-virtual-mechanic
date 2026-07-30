/**
 * The one rule for "does this athlete have a usable Physiological Profile" —
 * deliberately its own tiny, dependency-free module (no `"server-only"`, no
 * Supabase import) rather than living only inside `lib/dashboard-data.ts`,
 * because it needs to run in two runtimes that can't share a query helper:
 * `proxy.ts`'s Edge Middleware (which redirects an incomplete profile away
 * from every route except `/perfil`, see CLAUDE.md's "Mandatory profile
 * completion" section) and ordinary Server Components (via
 * `lib/dashboard-data.ts`'s `isProfileComplete`, which wraps this same
 * predicate around the richer `AthleteProfile` type). Keeping the rule itself
 * in exactly one place means the two call sites can never silently drift —
 * change what "complete" means once, here, and both enforcement points pick
 * it up.
 */
export type ProfileCompletenessFields = {
  weight_kg: number | null | undefined;
  ftp: number | null | undefined;
  gut_training_level: string | null | undefined;
  sweat_rate: string | null | undefined;
};

export function isProfileDataComplete(fields: ProfileCompletenessFields | null | undefined): boolean {
  return Boolean(fields?.weight_kg && fields?.ftp && fields?.gut_training_level && fields?.sweat_rate);
}

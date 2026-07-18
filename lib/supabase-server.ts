import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Module-level singleton: sign in once per server process and let the SDK's
 * built-in token refresh keep the session alive, instead of calling
 * signInWithPassword on every request/route. Shared by every server-side
 * Supabase read/write in the app (dashboard data, Strava OAuth routes) so
 * they don't each trigger their own sign-in and blow through Supabase
 * Auth's rate limit. Swap this whole file for the real logged-in user's
 * session once Auth.js lands.
 */
let clientPromise: Promise<SupabaseClient> | null = null;

export function getAuthenticatedSupabaseClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const seedEmail = process.env.SEED_USER_EMAIL;
      const seedPassword = process.env.SEED_USER_PASSWORD;

      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error(
          "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local"
        );
      }
      if (!seedEmail || !seedPassword) {
        throw new Error(
          "Faltan SEED_USER_EMAIL o SEED_USER_PASSWORD en .env.local (necesarias mientras no exista login con Auth.js)"
        );
      }

      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: seedEmail,
        password: seedPassword,
      });
      if (signInError) {
        throw new Error(
          `No se pudo autenticar con el usuario temporal de desarrollo: ${signInError.message}`
        );
      }

      return supabase;
    })();

    // Don't cache a failed sign-in forever — let the next call retry.
    clientPromise.catch(() => {
      clientPromise = null;
    });
  }

  return clientPromise;
}

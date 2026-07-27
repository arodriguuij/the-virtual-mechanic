import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS entirely, so it must never be used for
 * regular data reads/writes (those go through `getAuthenticatedSupabaseClient`
 * in `lib/supabase-server.ts`, which respects the real signed-in user's
 * session). The *only* legitimate use in this app is the Strava→Supabase
 * auth bridge (`app/api/auth/strava/callback/route.ts`): Strava isn't a
 * supported Supabase OAuth provider, so establishing a real session for a
 * Strava login requires the Admin API to provision/locate that user first.
 */
let adminClient: SupabaseClient | null = null;

export function getSupabaseAdminClient(): SupabaseClient {
  if (!adminClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local"
      );
    }
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}

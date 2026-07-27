import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Request-scoped Supabase client that reads the real signed-in user's
 * session from cookies — real auth landed via the Strava→Supabase bridge
 * (see `app/api/auth/strava/callback/route.ts`), so this is no longer the
 * single hardcoded dev-user singleton it used to be. Every existing caller
 * already derives `userId` from `supabase.auth.getUser()` rather than
 * assuming a fixed one, so nothing downstream needed to change — only this
 * file's internals did.
 *
 * Cookie writes are wrapped in a try/catch because Server Components can
 * only *read* cookies, never set them (a Next.js restriction) — `proxy.ts`
 * already refreshes and persists the session on every request, so a
 * Server Component silently no-op'ing its own write attempt is safe. Route
 * Handlers and Server Actions, which *can* set cookies, apply normally.
 */
export async function getAuthenticatedSupabaseClient(): Promise<SupabaseClient> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local"
    );
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component — see doc comment above.
        }
      },
    },
  });
}

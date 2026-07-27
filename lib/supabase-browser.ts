import { createBrowserClient } from "@supabase/ssr";

/** The only client-side Supabase client in this app — used exclusively to
 * call `auth.signOut()` from the sidebar's logout button. Every actual data
 * read/write still goes through the server (Server Components / Route
 * Handlers), never this client directly. */
export function getSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

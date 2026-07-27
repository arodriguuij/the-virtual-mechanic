import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Reachable with no session at all — the Strava OAuth entry/callback (the
// only login flow this app has) and the login screen itself. `/auth/callback`
// is the dual-logo transition page Strava redirects back to (see
// `getStravaRedirectUri` in `lib/strava.ts`) — there's no session yet at that
// point either, since it's what forwards into `/api/auth/strava/callback`
// to actually establish one. Everything else requires a real signed-in user.
const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/auth/callback",
  "/api/strava/connect",
  "/api/auth/strava/callback",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Refreshes the Supabase session on every request (per Supabase's standard
 * Next.js SSR pattern) and gates every non-public route behind it — this is
 * what makes "Conectar con Strava" a real login rather than cosmetic UI,
 * since without this a stale/expired session would silently keep serving
 * pages instead of bouncing back to `/login`. `supabase.auth.getUser()` is
 * used rather than `getSession()` because it revalidates the JWT against
 * Supabase's server instead of trusting whatever the cookie claims.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|apple-icon|icon|manifest.webmanifest).*)"],
};

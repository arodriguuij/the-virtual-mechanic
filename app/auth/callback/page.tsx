"use client";

import { useEffect, useRef } from "react";

import { LoginHeroLayout } from "@/components/login-hero";

/**
 * "Pantalla de Transición de Autenticación" — Strava redirects here (see
 * `getStravaRedirectUri` in `lib/strava.ts`) instead of straight to
 * `/api/auth/strava/callback`, so the browser has a real loading screen to
 * render for however long the actual token-exchange/Supabase-bridge work
 * takes, rather than a blank tab. Renders the *exact* same `LoginHeroLayout`
 * as `/login` — same background video, brand mark, hero copy, and
 * illustrative telemetry readout — with only the CTA slot swapped for a
 * disabled "Conectando con Strava..." state, so the transition from
 * "Conectar con Strava" to this screen reads as one continuous layout
 * rather than a jarring switch to a different frame.
 *
 * This page does no work itself beyond forwarding the exact same query
 * string (`code`, `error`, etc.) to that Route Handler via `fetch` and then
 * navigating to whatever it redirects to — same "fetch, then
 * `window.location.href = res.url`" pattern `components/sync-button.tsx`
 * already uses, so the real bridge logic (and its cookie-setting) is
 * completely untouched.
 *
 * `hasStartedRef` guards against firing the forward twice — React 18
 * Strict Mode double-invokes effects in development, and Strava's
 * authorization `code` is single-use, so a second forward would fail. Never
 * happens in a production build, but cheap enough to guard against anyway.
 */
function ConnectingButton() {
  return (
    <button
      type="button"
      disabled
      aria-live="polite"
      className="flex w-full cursor-wait items-center justify-center gap-2 rounded-md bg-neutral-800 px-4 py-4 font-mono text-xs font-bold tracking-wider text-neutral-300 uppercase opacity-90 shadow-none sm:text-sm"
    >
      <span
        className="size-4 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-[#FD5A08]"
        aria-hidden="true"
      />
      Conectando con Strava...
    </button>
  );
}

export default function AuthCallbackPage() {
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    async function forwardToAuthBridge() {
      try {
        const res = await fetch(`/api/auth/strava/callback${window.location.search}`);
        window.location.href = res.url || "/login?strava_error=auth_bridge_failed";
      } catch {
        window.location.href = "/login?strava_error=auth_bridge_failed";
      }
    }

    forwardToAuthBridge();
  }, []);

  return <LoginHeroLayout cta={<ConnectingButton />} />;
}

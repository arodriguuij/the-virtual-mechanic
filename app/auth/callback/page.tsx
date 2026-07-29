"use client";

import { useEffect, useRef } from "react";

import { RatioLogo } from "@/components/icons/RatioLogo";

/**
 * "Pantalla de Transición de Autenticación" — Strava redirects here (see
 * `getStravaRedirectUri` in `lib/strava.ts`) instead of straight to
 * `/api/auth/strava/callback`, so the browser has a real loading screen to
 * render for however long the actual token-exchange/Supabase-bridge work
 * takes, rather than a blank tab.
 *
 * Deliberately its own minimal screen, not `LoginHeroLayout` (the video-
 * background split layout `/login` uses) — a brief, bounded "we're setting
 * you up" transition reads better as a quiet, static moment (bronze mark
 * breathing on a plain cream field) than a repeat of the full marketing hero
 * the athlete just clicked through. Bronze (`text-terracotta`, this app's PNS
 * Bronze token) is the one and only color here — no Strava orange, no black
 * CTA chrome — since there's no CTA at all on this screen anymore, just a
 * status read.
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

  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center bg-[#FDFCF9] px-4">
      <RatioLogo className="size-12 animate-pulse text-terracotta" aria-hidden="true" />
      <p className="mt-4 font-mono text-xs tracking-wider text-neutral-500 uppercase" aria-live="polite">
        Sincronizando perfil fisiológico...
      </p>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";

import { AppLogo } from "@/components/app-logo";
import { StravaMark } from "@/components/strava-mark";

/**
 * "Pantalla de Transición de Autenticación" — Strava redirects here (see
 * `getStravaRedirectUri` in `lib/strava.ts`) instead of straight to
 * `/api/auth/strava/callback`, so the browser has a real dual-branding
 * loading screen to render for however long the actual token-exchange/
 * Supabase-bridge work takes, rather than a blank tab. This page does no
 * work itself beyond forwarding the exact same query string (`code`,
 * `error`, etc.) to that Route Handler via `fetch` and then navigating to
 * whatever it redirects to — same "fetch, then `window.location.href =
 * res.url`" pattern `components/sync-button.tsx` already uses, so the real
 * bridge logic (and its cookie-setting) is completely untouched.
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
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-neutral-200/80 bg-white p-8 text-center shadow-sm sm:p-10">
        <AppLogo className="mb-3 size-12 animate-pulse" />

        <div className="flex flex-wrap items-center justify-center gap-3">
          <div className="flex items-center gap-2 text-xs font-bold tracking-[0.2em] text-neutral-900 uppercase">
            Motor Metabólico
          </div>

          <div className="flex items-center gap-1" aria-hidden="true">
            <span className="size-1 animate-pulse rounded-full bg-neutral-400 [animation-delay:0ms]" />
            <span className="size-1 animate-pulse rounded-full bg-neutral-400 [animation-delay:200ms]" />
            <span className="size-1 animate-pulse rounded-full bg-neutral-400 [animation-delay:400ms]" />
          </div>

          <div className="flex items-center gap-2 text-xs font-bold tracking-[0.2em] text-[#FC4C02] uppercase">
            <StravaMark className="size-5" />
            Strava
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs font-semibold tracking-widest text-neutral-800 uppercase">
            Conectando con Strava...
          </p>
          <p className="mt-1 font-sans text-xs text-neutral-400">
            Importando perfil fisiológico y sincronizando rutas recientes
          </p>
        </div>
      </div>
    </div>
  );
}

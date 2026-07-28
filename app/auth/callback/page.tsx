"use client";

import { useEffect, useRef } from "react";

import { AppLogo } from "@/components/app-logo";
import { AuthPageShell } from "@/components/auth-page-shell";

/**
 * "Pantalla de Transición de Autenticación" — Strava redirects here (see
 * `getStravaRedirectUri` in `lib/strava.ts`) instead of straight to
 * `/api/auth/strava/callback`, so the browser has a real loading screen
 * (the same full-bleed `AuthPageShell` frame as `/login`, with a pulsing
 * `AppLogo` and status copy in place of the login CTA) to render for
 * however long the actual token-exchange/Supabase-bridge work takes, rather
 * than a blank tab. This page does no work itself beyond forwarding the
 * exact same query string (`code`, `error`, etc.) to that Route Handler via
 * `fetch` and then navigating to whatever it redirects to — same "fetch,
 * then `window.location.href = res.url`" pattern `components/sync-button.tsx`
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
    <AuthPageShell>
      <AppLogo className="mb-4 size-10 animate-pulse" />
      <h1 className="text-center font-mono text-lg font-bold tracking-tight text-neutral-900 uppercase sm:text-xl">
        Conectando con Strava...
      </h1>
      <p className="mx-auto mt-2 max-w-xs text-center font-mono text-xs leading-relaxed text-neutral-500">
        Sincronizando perfil fisiológico y recalculando datos de rutas recientes.
      </p>
    </AuthPageShell>
  );
}

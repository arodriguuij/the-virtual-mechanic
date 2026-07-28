"use client";

import { useState } from "react";

import { StravaMark } from "@/components/strava-mark";
import { cn } from "@/lib/utils";

/**
 * "CONECTAR CON STRAVA" — the sole login/registration entry point (see
 * "Real auth: Strava-exclusive login" in CLAUDE.md). This is a real
 * full-page navigation to `/api/strava/connect` (Strava's own OAuth
 * authorize redirect), not a `fetch`-based action, so there's no
 * `useFormStatus`/pending state to hook into the way `SyncForm` has —
 * instead, `connecting` flips true on click and disables further clicks
 * (`pointer-events-none`, `aria-disabled`) for the brief window before the
 * browser actually navigates away, so a double-click can't fire the OAuth
 * handshake twice.
 */
export function StravaLoginButton() {
  const [connecting, setConnecting] = useState(false);

  return (
    <a
      href="/api/strava/connect"
      aria-disabled={connecting}
      onClick={(e) => {
        if (connecting) {
          e.preventDefault();
          return;
        }
        setConnecting(true);
      }}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-md bg-neutral-900 px-6 py-3.5 font-mono text-xs font-bold text-white uppercase transition-all duration-150",
        connecting ? "pointer-events-none opacity-80" : "cursor-pointer hover:bg-black"
      )}
    >
      {connecting ? (
        <>
          <span
            className="size-4 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white"
            aria-hidden="true"
          />
          Iniciando sesión...
        </>
      ) : (
        <>
          <StravaMark className="size-4 shrink-0" />
          Conectar con Strava
        </>
      )}
    </a>
  );
}

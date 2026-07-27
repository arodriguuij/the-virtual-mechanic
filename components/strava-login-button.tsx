"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/** Official Strava icomark — a single fill path (Simple Icons' `siStrava`
 * glyph), always rendered white-on-orange regardless of theme, so it's
 * drawn with a literal `fill` rather than `currentColor`. */
function StravaMark({ className }: { className?: string }) {
  return (
    <svg role="img" viewBox="0 0 24 24" className={className} fill="#FFFFFF" aria-hidden="true">
      <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
    </svg>
  );
}

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
        "inline-flex w-full items-center justify-center gap-2.5 rounded-lg bg-[#FC4C02] px-6 py-3.5 text-xs font-semibold tracking-wider text-white uppercase transition-all duration-150",
        connecting ? "pointer-events-none opacity-80" : "cursor-pointer hover:shadow-md hover:brightness-105"
      )}
    >
      {connecting ? (
        <>
          <span
            className="size-4 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white"
            aria-hidden="true"
          />
          Conectando...
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

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
 *
 * `connecting` is `useState` owned entirely by this component — the parent
 * (`LoginHeroLayout`, a Server Component) only ever receives this whole
 * component as an opaque `cta` prop, so this state update re-renders nothing
 * but this button's own subtree. In particular it can never touch
 * `BackgroundMedia`'s looping video (see that component's own doc comment in
 * `components/login-hero.tsx`) — the two are siblings in fully separate
 * parts of the render tree, not a parent/child relationship.
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
        "flex w-full items-center justify-center gap-2 rounded-sm bg-[#18181B] px-4 py-2.5 font-mono text-xs font-bold tracking-wider text-white uppercase transition-colors duration-150 sm:py-3",
        connecting ? "pointer-events-none opacity-80" : "cursor-pointer hover:bg-[#27272A]"
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

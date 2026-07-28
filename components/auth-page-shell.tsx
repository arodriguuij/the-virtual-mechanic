import type { ReactNode } from "react";

import { AppLogo } from "@/components/app-logo";

/**
 * Shared full-bleed, card-free frame for every unauthenticated screen
 * (`/login`, the Strava OAuth transition at `/auth/callback`) — three flat
 * horizontal bands (top bar, centered hero, bottom bar) divided only by
 * thin `border-neutral-300/80` rules, no card/shadow/background pattern.
 * Extracted here once both screens needed the *identical* top/bottom bars,
 * so a future copy/style change to either only has to happen in one place.
 * Plain component (no `"use client"`, no server-only APIs) — safe to import
 * from `/login`'s Server Component or `/auth/callback`'s Client Component.
 *
 * `h-dvh` (not `min-h-screen`) + `overflow-hidden` pins the frame to the
 * browser's *dynamic* viewport height and blocks any scroll at the root —
 * `min-h-screen` alone left the page tall enough that iOS Safari's
 * address/tab-bar chrome (which shrinks the viewport after the first
 * scroll gesture) could reveal a sliver of extra height below the fold,
 * letting a stray touch-drag scroll the whole page by a few pixels even
 * though every visible section already fit. `justify-between` on this root
 * flex column plus `flex-none` on the header/footer bands is what keeps
 * `<main>` (the only `flex-1`) as the sole flexible region — the bands
 * never grow/shrink even if their own content's natural height changes.
 */
export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh w-full select-none flex-col justify-between overflow-hidden bg-[#FDFCF9]">
      <header className="relative flex w-full flex-none items-center justify-center border-b border-neutral-300/80 bg-[#FDFCF9] px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center gap-2">
          <AppLogo className="size-4 shrink-0 sm:size-5" />
          <span className="font-mono text-xs font-bold whitespace-nowrap text-neutral-900 uppercase tracking-wider sm:text-sm">
            Motor Metabólico
          </span>
        </div>
        <span className="absolute right-6 hidden font-mono text-[10px] whitespace-nowrap text-neutral-500 uppercase tracking-widest sm:block">
          V1.0 · Nutrición de precisión
        </span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 sm:px-6">{children}</main>

      <footer className="flex-none border-t border-neutral-300/80 bg-[#FDFCF9] px-4 py-3">
        <div className="flex w-full items-center justify-center gap-0.5 text-center font-mono text-[9px] tracking-wider text-neutral-500 uppercase sm:gap-8 sm:text-[10px]">
          <span className="whitespace-nowrap">01 / Ratio 1:0.8</span>
          <span aria-hidden="true">&bull;</span>
          <span className="whitespace-nowrap">02 / Meteo en vivo</span>
          <span aria-hidden="true">&bull;</span>
          <span className="whitespace-nowrap">03 / Mezcla casera</span>
        </div>
      </footer>
    </div>
  );
}

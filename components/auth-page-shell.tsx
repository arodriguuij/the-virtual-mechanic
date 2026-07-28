import type { ReactNode } from "react";

import { AppLogo } from "@/components/app-logo";

const specsFull = ["01 / Ratio 1:0.8 optimizado", "02 / Meteorología en vivo", "03 / Mezcla casera"];
// A narrow phone can't fit the full specs on one line (measured: 388px of content
// against 342px available at a 390px viewport, clipping both edges) — shortened labels
// below `sm:` instead of wrapping/scrolling, same "shorter label on mobile" convention as
// the Sync button and the Carbos/Carbohidratos stat label elsewhere in this app.
const specsShort = ["01 / Ratio 1:0.8", "02 / Clima en vivo", "03 / Mezcla casera"];

/**
 * Shared full-bleed, card-free frame for every unauthenticated screen
 * (`/login`, the Strava OAuth transition at `/auth/callback`) — three flat
 * horizontal bands (top bar, centered hero, bottom bar) divided only by
 * thin `border-neutral-300/80` rules, no card/shadow/background pattern.
 * Extracted here once both screens needed the *identical* top/bottom bars,
 * so a future copy/style change to either only has to happen in one place.
 * Plain component (no `"use client"`, no server-only APIs) — safe to import
 * from `/login`'s Server Component or `/auth/callback`'s Client Component.
 */
export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-[#FDFCF9]">
      <header className="relative flex w-full items-center justify-center border-b border-neutral-300/80 bg-[#FDFCF9] px-6 py-4">
        <div className="flex items-center gap-2">
          <AppLogo className="size-5 shrink-0" />
          <span className="font-mono text-sm font-bold whitespace-nowrap text-neutral-900 uppercase tracking-wider">
            Motor Metabólico
          </span>
        </div>
        <span className="absolute right-6 hidden font-mono text-[10px] whitespace-nowrap text-neutral-500 uppercase tracking-widest sm:block">
          V1.0 · Nutrición de precisión
        </span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-8">{children}</main>

      <footer className="border-t border-neutral-300/80 bg-[#FDFCF9] px-6 py-4">
        <div className="flex w-full items-center justify-center gap-3 font-mono text-[9px] tracking-wider text-neutral-500 uppercase sm:hidden">
          {specsShort.map((spec) => (
            <span key={spec} className="shrink-0 whitespace-nowrap">
              {spec}
            </span>
          ))}
        </div>
        <div className="hidden w-full items-center justify-center gap-8 font-mono text-[10px] tracking-wider text-neutral-500 uppercase sm:flex">
          {specsFull.map((spec) => (
            <span key={spec} className="shrink-0 whitespace-nowrap">
              {spec}
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}

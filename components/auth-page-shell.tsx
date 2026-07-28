import type { ReactNode } from "react";

import { AppLogo } from "@/components/app-logo";

const specs = ["01 / Ratio 1:0.8 optimizado", "02 / Meteorología en vivo", "03 / Mezcla casera"];

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
      <header className="flex items-center justify-between border-b border-neutral-300/80 bg-[#FDFCF9] px-6 py-4">
        <div className="flex shrink-0 items-center gap-2">
          <AppLogo className="size-5 shrink-0" />
          <span className="font-mono text-sm font-bold whitespace-nowrap text-neutral-900 tracking-wider">
            Motor Metabólico
          </span>
        </div>
        <span className="shrink-0 text-right font-mono text-[10px] whitespace-nowrap text-neutral-500 uppercase tracking-widest">
          <span className="sm:hidden">V1.0</span>
          <span className="hidden sm:inline">V1.0 · Nutrición de precisión</span>
        </span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-8">{children}</main>

      <footer className="border-t border-neutral-300/80 bg-[#FDFCF9] px-6 py-4">
        <div className="flex flex-col items-center gap-1 font-mono text-[10px] tracking-wider text-neutral-500 uppercase sm:flex-row sm:justify-center sm:gap-x-12">
          {specs.map((spec) => (
            <span key={spec} className="whitespace-nowrap">
              {spec}
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}

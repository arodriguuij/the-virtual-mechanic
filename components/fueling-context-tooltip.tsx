"use client";

import { HelpCircle } from "lucide-react";

import { getCarbRatioContextNote } from "@/lib/metabolic-engine";

/**
 * "Contextualización Científica Dinámica" — a hover/focus tooltip next to
 * the carb-rate readout explaining *why* the recipe picked the
 * maltodextrin:fructose ratio it did (see `getCarbRatioContextNote`), rather
 * than expecting the athlete to already know the SGLT1/GLUT5 transporter
 * research behind the numbers. Pure CSS hover/focus (no tooltip primitive in
 * `components/ui` yet) — `group-focus-within` keeps it reachable by
 * keyboard, not just mouse hover. Icon/panel styling matches
 * `components/info-tooltip.tsx`'s own "Unificación Global de Iconos de
 * Tooltip" treatment exactly (`HelpCircle`, dark `zinc-900` panel) — the
 * only other tooltip trigger in the app, kept in sync by hand since this one
 * predates `InfoTooltip` and takes a derived note rather than a static one,
 * so it isn't a candidate to just delegate to that shared component.
 */
export function FuelingContextTooltips({ carbsGPerHour }: { carbsGPerHour: number }) {
  const note = getCarbRatioContextNote(carbsGPerHour);
  return (
    <span className="group relative inline-flex items-center">
      <button
        type="button"
        tabIndex={0}
        aria-label="Contexto científico del ratio de carbohidratos"
        className="ml-1 inline-flex shrink-0 cursor-help text-zinc-400 transition-colors outline-none hover:text-zinc-600 focus:outline-none"
      >
        <HelpCircle className="size-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 max-w-xs -translate-x-1/2 rounded-sm border-0 bg-zinc-900 p-3 font-mono text-xs text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {note}
      </span>
    </span>
  );
}

"use client";

import { Info } from "lucide-react";

import { getCarbRatioContextNote } from "@/lib/metabolic-engine";

/**
 * "Contextualización Científica Dinámica" — a hover/focus tooltip next to
 * the carb-rate readout explaining *why* the recipe picked the
 * maltodextrin:fructose ratio it did (see `getCarbRatioContextNote`), rather
 * than expecting the athlete to already know the SGLT1/GLUT5 transporter
 * research behind the numbers. Pure CSS hover/focus (no tooltip primitive in
 * `components/ui` yet) — `group-focus-within` keeps it reachable by
 * keyboard, not just mouse hover.
 */
export function FuelingContextTooltips({ carbsGPerHour }: { carbsGPerHour: number }) {
  const note = getCarbRatioContextNote(carbsGPerHour);
  return (
    <span className="group relative inline-flex items-center">
      <Info
        tabIndex={0}
        aria-label="Contexto científico del ratio de carbohidratos"
        className="ml-1 inline-block size-3 shrink-0 cursor-help text-neutral-400 outline-none transition-colors duration-150 hover:text-neutral-700 focus:text-neutral-700"
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-56 -translate-x-1/2 rounded-sm border border-neutral-200 bg-background px-2.5 py-2 text-xs text-neutral-700 opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {note}
      </span>
    </span>
  );
}

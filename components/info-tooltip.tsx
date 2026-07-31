import { HelpCircle } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Small inline "(?)" affordance for a section header/label — hover or focus
 * reveals a short plain-language explainer, without needing a modal or a
 * real tooltip primitive (none exists in `components/ui` yet — this is the
 * same pure `group-hover`/`group-focus-within` CSS technique
 * `components/fueling-context-tooltip.tsx` uses, generalized here with a
 * `note` prop instead of computing one internally, since call sites this
 * time are static copy, not a derived value). No `"use client"`: the whole
 * thing is CSS-only, so it renders fine inside a Server Component form like
 * `/perfil`'s just as well as a Client Component.
 *
 * `note` accepts a `ReactNode`, not just a plain string — most call sites
 * still just pass one sentence, but the Fueling Planner's "Intensidad
 * Objetivo" zone guide needs several `<p>`/`<strong>` lines, and widening
 * the type (a string is already a valid `ReactNode`) is backward-compatible
 * with every existing caller. `panelClassName` similarly lets a richer
 * tooltip widen itself past the default `max-w-xs` without affecting the
 * single-line callers that don't pass it.
 *
 * Icon and panel styling ("Unificación Global de Iconos de Tooltip") is the
 * one deliberate exception to this app's own porcelain/white card palette —
 * a dark `zinc-900` panel reads as a distinct, universal "help" affordance
 * rather than another content card, and `HelpCircle` (not `Info`) is the
 * one icon every tooltip trigger in the app now shares — see
 * `components/fueling-context-tooltip.tsx` for the other (and only other)
 * call site sharing this exact treatment.
 */
export function InfoTooltip({
  label,
  note,
  panelClassName,
}: {
  label: string;
  note: ReactNode;
  panelClassName?: string;
}) {
  return (
    <span className="group relative inline-flex items-center">
      <button
        type="button"
        tabIndex={0}
        aria-label={label}
        className="inline-flex shrink-0 cursor-help text-zinc-400 transition-colors outline-none hover:text-zinc-600 focus:outline-none"
      >
        <HelpCircle className="size-3.5" />
      </button>
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 max-w-xs -translate-x-1/2 rounded-sm border-0 bg-zinc-900 p-3 font-mono text-xs font-normal tracking-normal text-white normal-case opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
          panelClassName
        )}
      >
        {note}
      </span>
    </span>
  );
}

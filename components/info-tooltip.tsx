"use client";

import { HelpCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Small inline "(?)" affordance for a section header/label — hover or focus
 * reveals a short plain-language explainer, without needing a modal or a
 * real tooltip primitive (none exists in `components/ui` yet). Now a real
 * `open` state (hover/focus in, hover/focus out) rather than pure CSS
 * `group-hover`/`group-focus-within` — a client component either way, but
 * this is what lets it close itself the instant the window scrolls (a
 * scroll-triggered popover drifting away from its trigger, or staying
 * stuck open under a card boundary, reads as broken), which a CSS-only
 * hover/focus trigger can't do on its own.
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
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function closeOnScroll() {
      setOpen(false);
    }
    window.addEventListener("scroll", closeOnScroll, { passive: true });
    return () => window.removeEventListener("scroll", closeOnScroll);
  }, [open]);

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        tabIndex={0}
        aria-label={label}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex shrink-0 cursor-help text-zinc-400 transition-colors outline-none hover:text-zinc-600 focus:outline-none"
      >
        <HelpCircle className="size-3.5" />
      </button>
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 max-w-xs -translate-x-1/2 rounded-sm border-0 bg-zinc-900 p-3 font-mono text-xs font-normal tracking-normal text-white normal-case shadow-lg transition-opacity duration-150",
          open ? "opacity-100" : "opacity-0",
          panelClassName
        )}
      >
        {note}
      </span>
    </span>
  );
}

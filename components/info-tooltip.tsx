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
 * `HelpCircle` (not `Info`) is the one icon every tooltip trigger in the
 * app shares — see `components/fueling-context-tooltip.tsx` for the other
 * (and only other) call site sharing this exact treatment.
 *
 * **Panel: clean white, not dark.** "Unificación Global de Iconos de
 * Tooltip" originally gave this a dark `zinc-900` panel deliberately, as
 * the one exception to this app's porcelain/white palette. Reversed by a
 * later UX audit — on a real phone that dark panel read as "invasive,"
 * covering close to half the screen and darkening the surrounding card far
 * more than a short explainer warrants. Now `bg-white shadow-xl border
 * border-zinc-200 text-zinc-800 rounded-xl`, matching this app's own card
 * system instead of standing apart from it.
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
          "pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 max-w-xs -translate-x-1/2 rounded-xl border border-zinc-200 bg-white p-4 font-mono text-xs font-normal tracking-normal text-zinc-800 normal-case shadow-xl transition-opacity duration-150",
          open ? "opacity-100" : "opacity-0",
          panelClassName
        )}
      >
        {note}
      </span>
    </span>
  );
}

"use client";

import { HelpCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { getCarbRatioContextNote } from "@/lib/metabolic-engine";

/**
 * "Contextualización Científica Dinámica" — a hover/focus tooltip next to
 * the carb-rate readout explaining *why* the recipe picked the
 * maltodextrin:fructose ratio it did (see `getCarbRatioContextNote`), rather
 * than expecting the athlete to already know the SGLT1/GLUT5 transporter
 * research behind the numbers. Real `open` state (not pure CSS `group-hover`/
 * `group-focus-within`) so it can close itself the instant the window
 * scrolls, matching `components/info-tooltip.tsx`'s own treatment — the
 * only other tooltip trigger in the app, kept in sync by hand since this one
 * predates `InfoTooltip` and takes a derived note rather than a static one,
 * so it isn't a candidate to just delegate to that shared component. Panel
 * styling (clean white, not dark — see `InfoTooltip`'s own doc comment for
 * why) is kept in sync by hand too.
 */
export function FuelingContextTooltips({ carbsGPerHour }: { carbsGPerHour: number }) {
  const note = getCarbRatioContextNote(carbsGPerHour);
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
        aria-label="Contexto científico del ratio de carbohidratos"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="ml-1 inline-flex shrink-0 cursor-help text-zinc-400 transition-colors outline-none hover:text-zinc-600 focus:outline-none"
      >
        <HelpCircle className="size-3.5" />
      </button>
      {/* "Corrección de Tooltip Cortado" — this trigger sits inside Card
          03's *right*-hand Carbohidratos tile, so a centered popover
          (`left-1/2 -translate-x-1/2`, the pattern `InfoTooltip` still
          uses) extends past the right edge of a narrow phone screen before
          it ever gets clipped/repositioned — there's no real Popover
          primitive here with its own collision detection (see this app's
          own "no Tooltip primitive exists in `components/ui`" convention),
          so the fix is a purely CSS one: anchor the panel's own *right*
          edge to the trigger (`right-0`) instead of centering it, so it
          only ever grows leftward, and narrow it from `max-w-xs` (320px) to
          `max-w-65` (260px) so that leftward growth stays comfortably
          inside a 375-390px viewport even when the trigger itself sits
          fairly far right. */}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute right-0 bottom-full z-50 mb-2 max-w-65 rounded-xl border border-zinc-200 bg-white p-4 font-mono text-xs text-zinc-800 shadow-xl transition-opacity duration-150",
          open ? "opacity-100" : "opacity-0"
        )}
      >
        {note}
      </span>
    </span>
  );
}

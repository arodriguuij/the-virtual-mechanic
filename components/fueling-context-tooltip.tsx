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
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 max-w-xs -translate-x-1/2 rounded-xl border border-zinc-200 bg-white p-4 font-mono text-xs text-zinc-800 shadow-xl transition-opacity duration-150",
          open ? "opacity-100" : "opacity-0"
        )}
      >
        {note}
      </span>
    </span>
  );
}

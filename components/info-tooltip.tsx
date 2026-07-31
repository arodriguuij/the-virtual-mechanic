import { Info } from "lucide-react";

/**
 * Small inline "(i)" affordance for a section header/label — hover or focus
 * reveals a short plain-language explainer, without needing a modal or a
 * tooltip primitive (none exists in `components/ui` yet — same pure
 * `group-hover`/`group-focus-within` CSS technique
 * `components/fueling-context-tooltip.tsx` already uses, generalized here
 * with a `note` prop instead of computing one internally, since call sites
 * this time are static copy, not a derived value). No `"use client"`: the
 * whole thing is CSS-only, so it renders fine inside a Server Component form
 * like `/perfil`'s just as well as a Client Component.
 *
 * The bubble resets `font`/`case`/`tracking` explicitly rather than
 * inheriting from its call site — every current call site sits inside an
 * uppercase, tracked, `font-mono` section label, and the explainer itself
 * reads as prose, not another numeric/label readout.
 */
export function InfoTooltip({ label, note }: { label: string; note: string }) {
  return (
    <span className="group relative inline-flex items-center">
      <Info
        tabIndex={0}
        aria-label={label}
        className="ml-1 inline-block size-3.5 shrink-0 cursor-help text-neutral-400 outline-none transition-colors duration-150 hover:text-neutral-700 focus:text-neutral-700"
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-sm border border-neutral-200 bg-background px-2.5 py-2 font-sans text-xs font-normal tracking-normal text-neutral-700 normal-case opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {note}
      </span>
    </span>
  );
}

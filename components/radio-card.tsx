"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared active/inactive treatment for every radio-card selector on
 * `/perfil` — "Fenotipo metabólico," "Tasa de sudoración," and Gut
 * Training's own level cards each used to style their selected state
 * differently (a light `bg-[#FDF8F6]` tint with a dark border for
 * phenotype vs. a solid `bg-terracotta` fill for the other two), which read
 * as three inconsistent selector components rather than one. This is the
 * one shared card every group now renders through — `checked`/`title`/
 * `children` (a secondary caption slot: sweat rate and phenotype pass a
 * single description line, Gut Training passes both its g/h range and its
 * description as two stacked lines) are the only things that vary.
 *
 * The native `<input type="radio">` stays in the DOM for real form
 * semantics (`name`/`value`/`checked`/`onChange`, keyboard navigation,
 * screen readers) but is visually hidden (`sr-only`, not `hidden` — it
 * must stay focusable) in favor of a custom circle indicator, since the
 * desired active look (a white ring with a terracotta-colored inner dot,
 * sitting on top of the card's own solid terracotta fill) isn't achievable
 * through the native widget's `accent-color` alone. `peer-focus-visible:`
 * on the label puts a visible focus ring around the whole card when the
 * hidden input is reached via keyboard, so hiding the native circle doesn't
 * cost keyboard accessibility.
 */
export function RadioCard({
  name,
  value,
  checked,
  onChange,
  onBlur,
  title,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  onBlur?: () => void;
  title: string;
  children?: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 shadow-none transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-terracotta peer-focus-visible:ring-offset-2",
        checked
          ? "border-transparent bg-terracotta text-white"
          : "border-zinc-300/70 bg-white text-neutral-800 hover:border-zinc-400"
      )}
    >
      <span className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          onChange={onChange}
          onBlur={onBlur}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={cn(
            "flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
            checked ? "border-white bg-white" : "border-neutral-300 bg-transparent"
          )}
        >
          {checked && <span className="size-1.5 rounded-full bg-terracotta" />}
        </span>
        <span className={cn("text-sm", checked ? "font-bold text-white" : "font-medium text-neutral-800")}>
          {title}
        </span>
      </span>
      {children && (
        <span className={cn("text-xs", checked ? "text-white/80" : "text-neutral-500")}>{children}</span>
      )}
    </label>
  );
}

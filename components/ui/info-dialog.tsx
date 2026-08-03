"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { HelpCircle, X } from "lucide-react";
import type { ReactNode } from "react";

import { Dialog, DialogOverlay, DialogPortal, DIALOG_CONTENT_Z } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * "Diálogo de Ayuda (Bottom Sheet)" — every "(?)" help affordance in the app
 * (Perfil's FTP/VLaMax/Tasa de sudoración/Adaptación digestiva explainers,
 * the Fueling Planner's Intensidad Objetivo zone guide and Carbohidratos
 * ratio context) opens this same bottom sheet instead of the hover/focus
 * tooltip both used to render inline. A hover tooltip has no equivalent on
 * a touchscreen — there's no hover state to trigger it — so an athlete on
 * their phone (this app's primary device, pre/post-ride) could never
 * actually read these explainers at all; a real tap-triggered sheet works
 * identically on touch and desktop. Built on the same `@base-ui/react/
 * dialog` primitives `components/commercial-products-sheet.tsx` already
 * uses for its own bottom sheet, not the centered `DialogContent` helper —
 * that helper's positioning is baked in for a centered dialog, and
 * overriding every one of those classes for a bottom-sheet layout is more
 * fragile than composing the same primitives directly with their own
 * bottom-sheet classes.
 *
 * The trigger's real hit area is a full 44×44px (the minimum touch-target
 * size widely recommended for mobile) even though the visible `HelpCircle`
 * glyph itself stays small (`size-3.5`, matching every other icon at this
 * scale in the app) — `-m-3.75 p-3.75` expands the clickable box by
 * 15px on every side of the 14px icon (44px total) while the matching
 * negative margin cancels that padding back out of normal layout flow, so
 * a label row this sits inline in (`flex items-center gap-1`) doesn't grow
 * taller just to fit an otherwise-oversized square button.
 */
export function InfoDialog({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog>
      <DialogPrimitive.Trigger
        aria-label={label}
        className="-m-3.75 inline-flex shrink-0 cursor-pointer p-3.75 text-zinc-400 transition-colors outline-none hover:text-zinc-600 focus:outline-none"
      >
        <HelpCircle className="size-3.5" />
      </DialogPrimitive.Trigger>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cn(
            "fixed right-0 bottom-0 left-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl outline-none duration-200 data-closed:animate-out data-closed:slide-out-to-bottom data-open:animate-in data-open:slide-in-from-bottom",
            DIALOG_CONTENT_Z
          )}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <h3 className="font-mono text-sm font-bold text-zinc-900">{title}</h3>
            <DialogPrimitive.Close
              render={
                <button type="button" aria-label="Cerrar" className="shrink-0 cursor-pointer p-1 text-zinc-400 transition-colors duration-150 hover:text-zinc-900" />
              }
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
          <div className="text-sm leading-relaxed text-zinc-700">{children}</div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}

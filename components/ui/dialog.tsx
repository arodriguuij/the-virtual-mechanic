"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

// "Overlay Oscuro Nativo, Sin Blur" — superseding the earlier GPU-promotion
// workaround (`transform-gpu`/`translate-z-0`/`backface-hidden`/
// `will-change-[opacity]`), which existed purely to fix an iOS Safari
// freeze/flash artifact specific to *blurred* elements fading in/out.
// `backdrop-blur`/`backdrop-filter` is dropped entirely here rather than
// worked around — a flat, semi-transparent black scrim (the native iOS/
// Android "dimming" look) has no `backdrop-filter` compositing layer to
// glitch in the first place, so the fix is structural, not another
// GPU hint layered on top of the same root cause.
//
// "Cobertura Total de Pantalla (Sidebar Incluido)" — `z-50` used to sit
// far below the app shell's own `<aside>` sidebar (`components/
// dashboard-shell.tsx`, `z-10000` on desktop, where it's a permanent
// `position: fixed` column rather than a drawer overlay), so on a wide
// viewport the sidebar rendered *on top of* every modal's dark overlay,
// left fully undimmed. `z-[10010]` clears that comfortably — picked by
// reading the sidebar's own real z-index rather than guessing a small
// round number, since anything under `10000` would have silently failed
// to fix this exact bug. No `container` prop is passed to `DialogPortal`
// anywhere in this app, so every dialog already portals to `document.body`
// (never a local, `<main>`-scoped container that could re-trap `position:
// fixed`), and no ancestor between `<body>` and this overlay sets its own
// `transform`/`perspective`/`filter` that would create a containing block
// a `fixed` element could get trapped inside instead of the true viewport.
const DIALOG_OVERLAY_Z = "z-[10010]";
const DIALOG_CONTENT_Z = "z-[10020]";

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate bg-black/50 transition-opacity duration-150 ease-out data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        DIALOG_OVERLAY_Z,
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          DIALOG_CONTENT_Z,
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  // Exported so `components/commercial-products-sheet.tsx` and
  // `components/ui/info-dialog.tsx` — both of which build their own
  // `DialogPrimitive.Popup` bottom sheet directly rather than going through
  // `DialogContent` — can reuse the exact same z-index tokens instead of a
  // second, independently-drifting magic number.
  DIALOG_OVERLAY_Z,
  DIALOG_CONTENT_Z,
}

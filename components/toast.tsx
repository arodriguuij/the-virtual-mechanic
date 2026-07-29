"use client";

import { Check, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

export type ToastData = { kind: "success" | "error"; title: string; message: string };

/**
 * The one global toast presentation this app uses — extracted from
 * `components/sync-button.tsx`'s `SyncForm` (the first place it was built)
 * so every other confirmation/error toast in the app (starting with
 * `ProfileSavedToast`) renders through the exact same proven mechanism
 * instead of a second, hand-rolled one. Fixed bottom-center, a solid white
 * pill (`shadow-xl`, `border-neutral-200/90`) — an earlier semi-transparent
 * version let content show through behind it, and a dark `bg-neutral-900`
 * version broke with this app's light editorial palette (every other
 * surface is white/cream, never a dark card); both were reverted. A small
 * `bg-emerald-50`/`bg-red-50` icon chip (a soft tint, not a saturated fill)
 * plus a two-line title/message.
 */
export function Toast({ toast }: { toast: ToastData }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 pointer-events-auto fixed bottom-6 left-1/2 z-10000 flex w-[90%] max-w-md -translate-x-1/2 items-center gap-3 rounded-xl border border-neutral-200/90 bg-white px-4 py-3 text-neutral-900 shadow-xl duration-200">
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border",
          toast.kind === "success"
            ? "border-emerald-200/60 bg-emerald-50 text-emerald-600"
            : "border-red-200/60 bg-red-50 text-red-600"
        )}
      >
        {toast.kind === "success" ? (
          <Check className="size-4 stroke-[2.5]" />
        ) : (
          <TriangleAlert className="size-4 stroke-[2.5]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs font-bold tracking-wider text-neutral-900 uppercase">
          {toast.title}
        </p>
        <p className="mt-0.5 truncate font-sans text-xs text-neutral-600">{toast.message}</p>
      </div>
    </div>
  );
}

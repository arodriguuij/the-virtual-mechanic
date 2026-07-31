"use client";

import { X } from "lucide-react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { stripEmoji } from "@/lib/gpx-export";
import { pocketFoodCarbsG, pocketFoodLabels, type PocketFoodItemType } from "@/lib/metabolic-engine";
import { primaryButtonClass } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";

/**
 * "Mi Despensa" — lets the athlete narrow Tarjeta 04's pocket-food catalog
 * down to only the items they actually buy/carry, without leaving the
 * planner or losing whatever they've already entered in Pasos 01/02.
 * Fully controlled by the parent (`open`/`onOpenChange`, `activeTypes`/
 * `onToggle`) rather than owning its own draft state — every checkbox here
 * *is* the same `activePantryTypes` state Card 04's stepper list and the
 * CUBIERTO/RESTANTE pill already read, so unchecking an item here is
 * reflected there instantly, live, while the modal is still open (not just
 * after "Guardar despensa" closes it). `onSave` only needs to persist that
 * already-applied selection to `localStorage` and close the modal.
 *
 * **Custom header, not `DialogHeader`/`DialogTitle`.** `DialogContent`'s
 * own built-in close button is absolutely positioned (`top-2 right-2`) on
 * top of whatever the header renders, with no reserved right-padding for
 * it — fine for a short one-line title, but this modal's original title
 * ("Selecciona los alimentos de tu despensa habitual") was long enough to
 * wrap on a narrow phone and collide with that corner button. Fixed two
 * ways together: the title itself is now short ("Mi Despensa Habitual,"
 * never wraps at any supported width) *and* the header is a real
 * `flex items-center justify-between` row holding both the title and the
 * close button as siblings (`showCloseButton={false}` on `DialogContent`
 * turns off the absolute one), so the two can never overlap regardless of
 * title length in the future.
 */
export function PantryEditorModal({
  open,
  onOpenChange,
  catalog,
  activeTypes,
  onToggle,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: PocketFoodItemType[];
  activeTypes: PocketFoodItemType[];
  onToggle: (type: PocketFoodItemType) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[92vh] overflow-y-auto rounded-xl p-4 sm:max-w-md sm:p-5"
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="font-mono text-xs font-bold tracking-wider text-zinc-900 uppercase sm:text-sm">
            Mi despensa habitual
          </h3>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar"
            className="shrink-0 cursor-pointer p-1 text-zinc-400 transition-colors duration-150 hover:text-zinc-900"
          >
            <X className="size-5" />
          </button>
        </div>
        <p className="text-xs text-neutral-600">
          Marca solo los alimentos que sueles comprar o llevar en las salidas:
        </p>
        <ul className="mt-2 flex flex-col gap-0.5">
          {catalog.map((type) => {
            const checked = activeTypes.includes(type);
            return (
              <li key={type}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-sm px-1 py-1.5 text-sm text-neutral-800 transition-colors duration-150 hover:bg-[#F8F7F5]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(type)}
                    className="size-4 shrink-0 cursor-pointer accent-terracotta"
                  />
                  {stripEmoji(pocketFoodLabels[type])}
                  <span className="ml-auto shrink-0 font-mono text-xs text-neutral-500">
                    {pocketFoodCarbsG[type]}g HC
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={onSave} className={cn(primaryButtonClass, "mt-3 w-full")}>
          Guardar despensa
        </button>
      </DialogContent>
    </Dialog>
  );
}

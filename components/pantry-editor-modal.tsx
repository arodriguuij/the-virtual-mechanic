"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
      <DialogContent className="max-h-[85vh] w-full max-w-md overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm font-bold tracking-wide text-zinc-900 uppercase">
            Selecciona los alimentos de tu despensa habitual
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-neutral-600">
          Marca solo los alimentos que sueles comprar o llevar en las salidas:
        </p>
        <ul className="flex flex-col gap-0.5">
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
        <button type="button" onClick={onSave} className={cn(primaryButtonClass, "w-full")}>
          Guardar despensa
        </button>
      </DialogContent>
    </Dialog>
  );
}

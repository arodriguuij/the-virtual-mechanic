"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { useState } from "react";

import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { COMMERCIAL_PRODUCTS, type CommercialProduct } from "@/lib/constants/nutrition-brands";
import { cn } from "@/lib/utils";

const COMMERCIAL_PRODUCT_BRANDS = Array.from(new Set(COMMERCIAL_PRODUCTS.map((p) => p.brand)));

/** One "Marcas comerciales" catalog row — the same compact stepper
 * geometry as `PocketFoodStepperRow` (`components/fueling-planner.tsx`),
 * but the label renders as 2 stacked lines (brand in bronze up top, then
 * product name + its real carb/sodium figures below) instead of one
 * bracketed `[ Marca - Nombre (...) ]` string — that single-line format
 * reliably truncated the brand/name/figures together on a narrow phone
 * ("Nombres Cortos"-style clipping), which this 2-line split avoids since
 * only the second line's own trailing figures need `truncate`. Exported
 * since it renders in two places: inside this sheet's own catalog list,
 * and inline in Card 04's "bolsillo" for whatever's already selected (see
 * `FuelingPlanner`'s own `selectedCommercialProducts`). */
export function CommercialProductStepperRow({
  product,
  qty,
  onChange,
}: {
  product: CommercialProduct;
  qty: number;
  onChange: (qty: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-zinc-100 py-2 last:border-b-0">
      <div className="min-w-0 flex-1 pr-2">
        <span className="mb-1 block font-mono text-[10px] font-bold tracking-wider text-[#70685b] uppercase leading-none">
          {product.brand}
        </span>
        <span className="block truncate font-sans text-xs font-semibold text-zinc-900">
          {product.name}{" "}
          <span className="font-mono text-[11px] font-normal text-zinc-500">
            · {product.carbs}g HC · {product.sodium}mg Na+
          </span>
        </span>
      </div>
      <div className="flex h-7 min-w-20 shrink-0 items-center justify-between rounded-sm border border-zinc-200 bg-transparent px-2 py-0.5">
        <button
          type="button"
          onClick={() => onChange(qty - 1)}
          className="flex size-5 cursor-pointer items-center justify-center text-sm leading-none font-normal text-zinc-600 transition-colors hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Quitar ${product.brand} ${product.name}`}
        >
          −
        </button>
        <span className="min-w-4 px-1 text-center font-sans text-xs font-medium text-zinc-800 tabular-nums">
          {qty}
        </span>
        <button
          type="button"
          onClick={() => onChange(qty + 1)}
          className="flex size-5 cursor-pointer items-center justify-center text-sm leading-none font-normal text-zinc-600 transition-colors hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Añadir ${product.brand} ${product.name}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

/**
 * "Selector de Marcas vía Bottom Sheet" — replaces the old always-expanded,
 * brand-grouped flat list (12 rows at once) that used to collapse Card 04
 * vertically on a narrow phone. A real iOS-style bottom sheet instead:
 * floats up from the bottom edge (`fixed bottom-0`, `rounded-t-2xl`, slides
 * in via `tw-animate-css`'s `slide-in-from-bottom`), capped at `85vh` with
 * its own internal scroll, and a quick brand filter row up top so a rider
 * restocking from one specific brand doesn't have to scroll past the other
 * 5. Fully controlled by the parent (`quantities`/`onChangeQty` are the
 * exact same `commercialProducts`/`setCommercialProductQty` state Card 04's
 * own CUBIERTO/RESTANTE pill and Card 05's sodium balance already read), so
 * a change here is reflected everywhere else instantly, live, while the
 * sheet is still open — same "controlled, not a draft" contract
 * `PantryEditorModal` already established for the pocket-food catalog.
 *
 * Built directly on `@base-ui/react/dialog`'s own `Popup`/`Close` (not the
 * shared `DialogContent` helper in `components/ui/dialog.tsx`) — that
 * helper's positioning classes are baked in for a centered dialog
 * (`top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2`), and overriding
 * every one of those via a `className` string merge for a bottom-sheet
 * layout is more fragile than just composing the same primitives directly
 * with their own bottom-sheet classes. `Dialog`/`DialogPortal`/
 * `DialogOverlay` are still the shared wrappers, though — the backdrop and
 * open/close state machinery don't need a bottom-sheet-specific variant.
 */
export function CommercialProductsSheet({
  open,
  onOpenChange,
  quantities,
  onChangeQty,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quantities: Record<string, number>;
  onChangeQty: (id: string, qty: number) => void;
}) {
  const [activeBrand, setActiveBrand] = useState<string | "all">("all");
  const visibleProducts =
    activeBrand === "all" ? COMMERCIAL_PRODUCTS : COMMERCIAL_PRODUCTS.filter((p) => p.brand === activeBrand);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        // A closed-and-reopened sheet starts back on "Todas" rather than
        // wherever the athlete last filtered to — the filter is a quick
        // in-session convenience, not something worth remembering across
        // separate visits to the sheet.
        if (!next) setActiveBrand("all");
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className="fixed right-0 bottom-0 left-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl outline-none duration-200 data-closed:animate-out data-closed:slide-out-to-bottom data-open:animate-in data-open:slide-in-from-bottom"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-mono text-xs font-bold tracking-wider text-zinc-900 uppercase">
              Marcas comerciales
            </h3>
            <DialogPrimitive.Close
              render={
                <button
                  type="button"
                  aria-label="Cerrar"
                  className="shrink-0 cursor-pointer p-1 text-zinc-400 transition-colors duration-150 hover:text-zinc-900"
                />
              }
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>

          {/* Filtro rápido por marca — a horizontal, non-wrapping pill row
              (own `scrollbar-none` overflow-x-auto strip, same hidden-
              scrollbar utility the weather carousel uses) rather than a
              full tab bar, since 7 options (6 brands + "Todas") would
              otherwise wrap onto 2-3 lines on a narrow phone. */}
          <div className="scrollbar-none mb-4 flex gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveBrand("all")}
              className={cn(
                "shrink-0 cursor-pointer rounded-full border px-3 py-1 font-mono text-[11px] font-semibold whitespace-nowrap transition-colors",
                activeBrand === "all"
                  ? "border-transparent bg-[#70685b] text-white"
                  : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400"
              )}
            >
              Todas
            </button>
            {COMMERCIAL_PRODUCT_BRANDS.map((brand) => (
              <button
                key={brand}
                type="button"
                onClick={() => setActiveBrand(brand)}
                className={cn(
                  "shrink-0 cursor-pointer rounded-full border px-3 py-1 font-mono text-[11px] font-semibold whitespace-nowrap transition-colors",
                  activeBrand === brand
                    ? "border-transparent bg-[#70685b] text-white"
                    : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400"
                )}
              >
                {brand}
              </button>
            ))}
          </div>

          <div className="flex flex-col">
            {visibleProducts.map((product) => (
              <CommercialProductStepperRow
                key={product.id}
                product={product}
                qty={quantities[product.id] ?? 0}
                onChange={(qty) => onChangeQty(product.id, qty)}
              />
            ))}
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}

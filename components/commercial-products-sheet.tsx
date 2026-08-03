"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { useState } from "react";

import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { COMMERCIAL_PRODUCTS, type CommercialProduct } from "@/lib/constants/nutrition-brands";
import { cn } from "@/lib/utils";

const COMMERCIAL_PRODUCT_BRANDS = Array.from(new Set(COMMERCIAL_PRODUCTS.map((p) => p.brand)));

// "Badges de Color por Rango de HC" — a flat carb figure reads faster as a
// quick visual band than as one more number in a line the eye has to parse
// — a low-carb electrolyte tab (≤30g) shouldn't compete for attention the
// same way a high-carb gel (>60g) does. Thresholds match the ranges named
// in the request itself; kept as one small pure function rather than an
// inline ternary in the JSX so the 3 bands can't drift out of sync between
// a future second call site and this one.
const CARB_BADGE_LOW_MAX_G = 30;
const CARB_BADGE_MID_MAX_G = 60;
function getCarbBadgeClass(carbs: number): string {
  if (carbs <= CARB_BADGE_LOW_MAX_G) return "bg-zinc-100 text-zinc-700 border-zinc-200";
  if (carbs <= CARB_BADGE_MID_MAX_G) return "bg-[#70685b]/15 text-[#70685b] border-[#70685b]/30";
  return "bg-zinc-900 text-amber-200 border-zinc-800";
}

/** One "Marcas comerciales" catalog row — the same compact stepper
 * geometry as `PocketFoodStepperRow` (`components/fueling-planner.tsx`),
 * laid out as 3 fixed blocks (brand+name / HC+Na+ / stepper) rather than
 * cramming the carb/sodium figures into the same truncating text line as
 * the product name — a long product name plus its own trailing "· Xg HC ·
 * Ymg Na+" figures used to compete for the same `truncate`d line, clipping
 * the figures off on a narrow phone; the HC badge and Na+ label are now
 * their own `shrink-0` block that can never be cut, and only the name
 * itself truncates if it's genuinely too long. The HC badge's color also
 * bands by range (`getCarbBadgeClass`) so a rider scanning the sheet can
 * spot a high-carb gel vs. a low-carb electrolyte tab at a glance, not just
 * by reading the number. Exported since it renders in two places: inside
 * this sheet's own catalog list, and inline in Card 04's "bolsillo" for
 * whatever's already selected (see `FuelingPlanner`'s own
 * `selectedCommercialProducts`). */
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
    <div className="flex items-center justify-between gap-2 border-b border-zinc-100 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <span className="mb-1 block font-mono text-[9px] font-bold tracking-wider text-[#70685b] uppercase leading-none">
          {product.brand}
        </span>
        <span className="block truncate font-sans text-xs font-semibold text-zinc-900">{product.name}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold",
            getCarbBadgeClass(product.carbs)
          )}
        >
          {product.carbs}g HC
        </span>
        <span className="font-mono text-[10px] text-zinc-400">{product.sodium}mg Na+</span>
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
 * sheet is still open — same "controlled, not a draft" contract this
 * results flow already uses everywhere else, e.g. the pocket-food steppers.
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

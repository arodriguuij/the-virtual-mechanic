// Custom, minimalist product silhouettes for the tactical-altimetry stacked
// icons ("Simplificación UX masiva de Altimetría Táctica" /
// "Integración de Iconos Custom para Geles y Mix de Hidratación" —
// `components/gpx-altimetry-modal.tsx` is the one consumer, mapping each
// `MergedTacticalPoint`'s `has*` flags to one of these instead of the
// generic lucide-react icons it used before). Every icon is a plain 24×24
// viewBox, `stroke="currentColor"` (no hardcoded fill color) so a caller's
// own `className` (`text-amber-500`, `text-sky-500`, etc.) controls the
// tint — the same "color via `currentColor`, size via `className`"
// convention every lucide icon in this app already follows, kept here so a
// custom icon slots in as a drop-in replacement with zero call-site
// surprises.

/** Gel energético — pouch silhouette with a torn-corner opening notch and a
 * lightning-bolt interior (fast-absorption cue), not a literal brand
 * shape. */
export function GelIcon({ className = "size-4 text-amber-500" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M7 3h10l1.5 3.5v13a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5v-13L7 3Z" />
      <path d="M8.5 3 7 6.5M15.5 3 17 6.5" />
      <path d="M13 8.5 9.5 14h3l-1 4.5 5-6.5h-3.2l1.2-3.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Mix de bidón — a stick-pack/sachet of powder (die-cut top edge) with a
 * drop mark, distinguishing it from `GelIcon`'s pouch shape at a glance
 * even at `size-4`. */
export function MixSachetIcon({ className = "size-4 text-sky-500" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M7.5 4h9v15a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 7.5 19V4Z" />
      <path strokeWidth="1.25" d="M7.5 4 8.5 2M10.5 4l1-2M13 4l1-2M15.5 4l1-2" />
      <path
        d="M12 9.5c1.4 1.7 2.3 2.9 2.3 4a2.3 2.3 0 1 1-4.6 0c0-1.1.9-2.3 2.3-4Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/** Hidratación — bidón/gota silhouette (a squared bottle body flaring from
 * a narrow neck), matching this app's existing bronze/blue water iconography
 * elsewhere without depending on lucide's generic `Droplets`. */
export function WaterIcon({ className = "size-4 text-blue-400" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9.5 2h5v3.2c1.9 1.1 3.2 3.8 3.2 6.6a5.7 5.7 0 1 1-11.4 0c0-2.8 1.3-5.5 3.2-6.6V2Z" />
      <path d="M9.5 6.2h5" />
    </svg>
  );
}

/** Comida sólida — plátano/barrita táctica, replacing the earlier generic
 * fork/spoon glyph ("Reemplazo de Icono de Comida Sólida"). Kept
 * byte-for-byte as specified — a real-food silhouette reads faster as
 * "solid" than cutlery does at icon size. */
export function SolidFoodIcon({ className = "size-4 text-neutral-600" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 15C4 15 5 20 12 20C19 20 20 11 20 4C20 4 17 5 13 8C9 11 4 15 4 15Z" />
      <path d="M5 14C8 12 12 9 17 7" />
    </svg>
  );
}

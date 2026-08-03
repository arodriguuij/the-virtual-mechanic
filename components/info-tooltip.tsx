import type { ReactNode } from "react";

import { InfoDialog } from "@/components/ui/info-dialog";

/**
 * Small inline "(?)" affordance for a section header/label — tapping it
 * opens a bottom-sheet dialog with a short plain-language explainer (see
 * `InfoDialog`, `components/ui/info-dialog.tsx`). Used to be a hover/focus
 * CSS tooltip, which has no equivalent on a touchscreen — a rider on their
 * phone could hover nothing, so the explainer was effectively unreachable
 * on this app's primary device. `label` becomes both the trigger's
 * accessible name and the sheet's own title; `note` is the sheet's body —
 * still a plain string at every call site today, but `ReactNode` since the
 * Fueling Planner's "Intensidad Objetivo" zone guide needs several `<p>`/
 * `<strong>` lines rather than one sentence.
 */
export function InfoTooltip({ label, note }: { label: string; note: ReactNode }) {
  return (
    <InfoDialog label={label} title={label}>
      {note}
    </InfoDialog>
  );
}

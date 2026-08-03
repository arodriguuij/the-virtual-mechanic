import { InfoDialog } from "@/components/ui/info-dialog";
import { getCarbRatioContextNote } from "@/lib/metabolic-engine";

/**
 * "Contextualización Científica Dinámica" — a bottom-sheet dialog next to
 * the carb-rate readout explaining *why* the recipe picked the
 * maltodextrin:fructose ratio it did (see `getCarbRatioContextNote`),
 * rather than expecting the athlete to already know the SGLT1/GLUT5
 * transporter research behind the numbers. Renders through the same shared
 * `InfoDialog` (`components/ui/info-dialog.tsx`) `components/info-tooltip.tsx`
 * uses — the only other tooltip-style trigger in the app — rather than its
 * own hand-rolled hover tooltip, which this predated and used to keep in
 * sync by hand.
 */
export function FuelingContextTooltips({ carbsGPerHour }: { carbsGPerHour: number }) {
  const note = getCarbRatioContextNote(carbsGPerHour);
  return (
    <InfoDialog label="Contexto científico del ratio de carbohidratos" title="Ratio de carbohidratos">
      {note}
    </InfoDialog>
  );
}

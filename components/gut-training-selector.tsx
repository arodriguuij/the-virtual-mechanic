"use client";

import { RadioCard } from "@/components/radio-card";
import {
  getGutTrainingCapGPerHour,
  gutTrainingLevelDescriptions,
  gutTrainingLevelLabels,
  gutTrainingLevelRanges,
  type GutTrainingLevel,
} from "@/lib/metabolic-engine";
import { cn } from "@/lib/utils";

const LEVELS = Object.keys(gutTrainingLevelLabels) as GutTrainingLevel[];

/**
 * The 4 Gut Training level cards on `/perfil` — fully controlled. `value`/
 * `onChange` are owned by the parent `PhysiologicalProfileForm`, which needs
 * to read this field's current selection to compute the form's overall
 * `isFormValid` and drive the unified "Campo obligatorio" inline-error
 * treatment every required field on that form now uses (see its own doc
 * comment). This component used to own its `level` state privately via
 * `useState` — fine for its own live helper-text update, but it left the
 * parent form with no way to see the selection at all.
 *
 * `value` accepts `null` — a brand-new athlete with no `athlete_profiles`
 * row yet must start with *no* card selected, never a silently pre-checked
 * "Intermedio" that reads as if they'd already configured something they
 * haven't (see CLAUDE.md's "Eliminating profile fallbacks" section).
 * `invalid` (the parent's "touched AND still empty" check for this field)
 * drives the red ring + "Campo obligatorio" treatment. `onBlur` on the
 * wrapping grid, not on each individual radio, is what lets the parent
 * detect "focus left this whole group" (via `e.currentTarget.contains
 * (e.relatedTarget)`) rather than firing on every click between cards.
 *
 * Each card renders through the shared `RadioCard` (`components/
 * radio-card.tsx`) — the same component "Fenotipo metabólico" and "Tasa de
 * sudoración" use on this same page, so all three selector groups share one
 * active/inactive visual language instead of three independently-styled
 * ones. This component's own job is just the range+description two-line
 * caption (passed as `RadioCard`'s `children`) and the live helper
 * paragraph below the grid.
 */
export function GutTrainingSelector({
  value,
  onChange,
  onGroupBlur,
  invalid,
}: {
  value: GutTrainingLevel | null;
  onChange: (level: GutTrainingLevel) => void;
  onGroupBlur: () => void;
  invalid: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "grid grid-cols-2 gap-2 rounded-lg sm:grid-cols-4",
          invalid && "ring-1 ring-red-500"
        )}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            onGroupBlur();
          }
        }}
      >
        {LEVELS.map((lvl) => (
          <RadioCard
            key={lvl}
            name="gut_training_level"
            value={lvl}
            checked={value === lvl}
            onChange={() => onChange(lvl)}
            title={gutTrainingLevelLabels[lvl]}
          >
            <span className="block font-mono">{gutTrainingLevelRanges[lvl]}</span>
            <span className="mt-1 block font-mono text-[11px] leading-tight">
              {gutTrainingLevelDescriptions[lvl]}
            </span>
          </RadioCard>
        ))}
      </div>
      {invalid ? (
        <span className="font-mono text-[11px] text-red-500">Campo obligatorio</span>
      ) : (
        <p className="text-xs text-neutral-500">
          {value
            ? `El motor limitará las recomendaciones a un máximo de ${getGutTrainingCapGPerHour(value)} g/h para evitar molestias estomacales.`
            : "Selecciona tu nivel actual para calibrar el límite de carbohidratos por hora que el motor te recomendará."}
        </p>
      )}
    </div>
  );
}

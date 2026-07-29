"use client";

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
        {LEVELS.map((lvl) => {
          const active = value === lvl;
          return (
            <label
              key={lvl}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 transition-colors duration-150",
                active
                  ? "border-terracotta bg-terracotta text-white"
                  : "border-neutral-200 text-neutral-700 hover:border-neutral-400"
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="gut_training_level"
                  value={lvl}
                  checked={active}
                  onChange={() => onChange(lvl)}
                  className="size-3.5 cursor-pointer accent-terracotta"
                />
                <span className="text-sm font-semibold">{gutTrainingLevelLabels[lvl]}</span>
              </span>
              <span className={cn("font-mono text-xs", active ? "text-white/80" : "text-neutral-500")}>
                {gutTrainingLevelRanges[lvl]}
              </span>
              <span
                className={cn(
                  "mt-1 font-mono text-[11px] leading-tight",
                  active ? "text-white/80" : "text-neutral-500"
                )}
              >
                {gutTrainingLevelDescriptions[lvl]}
              </span>
            </label>
          );
        })}
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

"use client";

import { useState } from "react";

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
 * The 4 Gut Training level cards on `/perfil` — a `"use client"` island
 * inside an otherwise plain server-rendered `<form action="...">`, needed
 * only so the helper line below ("El motor limitará...") can update live as
 * the athlete clicks between levels, before they ever hit "Guardar cambios".
 * Still a genuine native radio group (`name="gut_training_level"`,
 * `checked`/`value` on each `<input>`), so it submits with the surrounding
 * form exactly like the plain server-rendered version it replaces.
 *
 * The selected card fills solid (`bg-terracotta text-white`) rather than the
 * lighter outline+tint treatment the "Fenotipo metabólico" cards above it on
 * the same page still use — a deliberate, scoped visual upgrade for this
 * selector and the sweat-rate one right below it (see
 * `app/(app)/perfil/page.tsx`), not a page-wide restyle of every radio-card
 * group. Selection is already driven by real `level` state here (not CSS
 * `has-checked:`), so the secondary text's active-state color is a plain
 * ternary rather than a `group-has-checked:` variant.
 */
export function GutTrainingSelector({ defaultLevel }: { defaultLevel: GutTrainingLevel }) {
  const [level, setLevel] = useState<GutTrainingLevel>(defaultLevel);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {LEVELS.map((lvl) => {
          const active = level === lvl;
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
                  onChange={() => setLevel(lvl)}
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
      <p className="text-xs text-neutral-500">
        El motor limitará las recomendaciones a un máximo de {getGutTrainingCapGPerHour(level)} g/h
        para evitar molestias estomacales.
      </p>
    </div>
  );
}

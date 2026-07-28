"use client";

import { useState } from "react";

import {
  getGutTrainingCapGPerHour,
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
 */
export function GutTrainingSelector({ defaultLevel }: { defaultLevel: GutTrainingLevel }) {
  const [level, setLevel] = useState<GutTrainingLevel>(defaultLevel);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {LEVELS.map((lvl) => (
          <label
            key={lvl}
            className={cn(
              "flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 transition-colors duration-150",
              level === lvl
                ? "border-2 border-terracotta bg-[#FDF8F6] text-neutral-900"
                : "border-neutral-200 text-neutral-700 hover:border-neutral-400"
            )}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="gut_training_level"
                value={lvl}
                checked={level === lvl}
                onChange={() => setLevel(lvl)}
                className="size-3.5 cursor-pointer accent-terracotta"
              />
              <span className="text-sm font-semibold">{gutTrainingLevelLabels[lvl]}</span>
            </span>
            <span className="font-mono text-xs text-neutral-500">
              {gutTrainingLevelRanges[lvl]}
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs text-neutral-500">
        El motor limitará las recomendaciones a un máximo de {getGutTrainingCapGPerHour(level)} g/h
        para evitar molestias estomacales.
      </p>
    </div>
  );
}

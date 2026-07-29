"use client";

import { useState, type FocusEvent } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { GutTrainingSelector } from "@/components/gut-training-selector";
import { InfoTooltip } from "@/components/info-tooltip";
import type { AthleteProfile } from "@/lib/dashboard-data";
import {
  athleteTypeDescriptions,
  athleteTypeLabels,
  sweatRateDescriptions,
  sweatRateLabels,
  type AthleteType,
  type GutTrainingLevel,
  type SweatRate,
} from "@/lib/metabolic-engine";
import { fieldClass, primaryButtonClass, selectableFieldClass } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";

const eyebrow = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
const cardNumberHeading = "font-mono text-xs font-bold tracking-widest text-neutral-500 uppercase";

const errorTextClass = "mt-1 font-mono text-[11px] text-red-500";
const invalidFieldClass = "border-red-500 focus:border-red-500 focus:ring-red-500";
const invalidGroupClass = "rounded-lg ring-1 ring-red-500";

// Shared with every other field/button across the app (`lib/ui-classes.ts`).
const profileInputClass = fieldClass;
const selectableProfileInputClass = selectableFieldClass;

type RequiredField = "weight" | "ftp" | "athleteType" | "sweatRate" | "gutTrainingLevel";

/**
 * The entire Physiological Profile form — moved to a `"use client"`
 * component (from a plain server-rendered `<form action="...">`) so a
 * single `isFormValid` can watch every required field's *live* value and
 * unify what used to be three different validation UIs: FTP/Peso relied on
 * the browser's own native "Fill out this field" popup, sweat rate relied
 * on a full-page-top red banner surfaced only after a real server round
 * trip, and "Guardar cambios" was clickable regardless of whether the form
 * was actually complete. Now every required field renders the same
 * treatment — a red border/ring plus a "Campo obligatorio" micro-text,
 * shown only once that field has been *touched* (not on first paint, which
 * would flag a brand-new athlete's entirely blank form as five errors
 * before they've typed anything) — and the submit button is genuinely
 * `disabled` until all five pass. `noValidate` on the `<form>` turns off the
 * native popups entirely, since this component now owns 100% of the
 * validation UX.
 *
 * Still a real native `<form action="/api/athlete-profile/update"
 * method="POST">` — nothing about the actual submission mechanism changed,
 * every input keeps its original `name` so the server route's
 * `formData.get(...)` parsing is untouched. Only the *validation* moved
 * client-side; the server route's own validation stays in place too as a
 * defense-in-depth backstop (see `app/(app)/perfil/page.tsx`'s remaining
 * `no_session`/`update_blocked_by_rls` banner for the one class of failure
 * this component genuinely can't predict client-side).
 *
 * `bottle_count`/`bottle_capacity_ml`/`is_salty_sweater` stay plain
 * uncontrolled inputs (`defaultValue`/`defaultChecked`) — they're never
 * "empty" (a `<select>` always has some option selected) and aren't part of
 * `isFormValid`, so there's nothing for them to validate.
 */
export function PhysiologicalProfileForm({
  profile,
  stravaWeightKg,
}: {
  profile: AthleteProfile | null;
  stravaWeightKg: number | null;
}) {
  const [weight, setWeight] = useState(
    profile?.weight_kg?.toString() ?? stravaWeightKg?.toString() ?? ""
  );
  const [ftp, setFtp] = useState(profile?.ftp?.toString() ?? "");
  const [athleteType, setAthleteType] = useState<AthleteType | null>(profile?.athlete_type ?? null);
  const [sweatRate, setSweatRate] = useState<SweatRate | null>(profile?.sweat_rate ?? null);
  const [gutTrainingLevel, setGutTrainingLevel] = useState<GutTrainingLevel | null>(
    profile?.gut_training_level ?? null
  );
  const [touched, setTouched] = useState<Partial<Record<RequiredField, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const markTouched = (field: RequiredField) => setTouched((t) => ({ ...t, [field]: true }));

  const weightValid = Boolean(weight) && Number(weight) > 0;
  const ftpValid = Boolean(ftp) && Number(ftp) > 0;
  const isFormValid = Boolean(weightValid && ftpValid && athleteType && sweatRate && gutTrainingLevel);

  const weightInvalid = Boolean(touched.weight) && !weightValid;
  const ftpInvalid = Boolean(touched.ftp) && !ftpValid;
  const athleteTypeInvalid = Boolean(touched.athleteType) && !athleteType;
  const sweatRateInvalid = Boolean(touched.sweatRate) && !sweatRate;
  const gutTrainingInvalid = Boolean(touched.gutTrainingLevel) && !gutTrainingLevel;

  // Attached to a radio group's wrapping grid, not each individual radio —
  // `e.relatedTarget` is the element about to receive focus, so this only
  // fires once focus genuinely leaves the whole group (clicking between
  // cards inside the same grid never triggers it).
  function onGroupBlur(field: RequiredField) {
    return (e: FocusEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        markTouched(field);
      }
    };
  }

  return (
    <form
      action="/api/athlete-profile/update"
      method="POST"
      noValidate
      onSubmit={() => setIsSubmitting(true)}
      className="flex flex-col gap-6"
    >
      <Card>
        <CardContent className="flex flex-col gap-4">
          <span className={cardNumberHeading}>01 · Métricas físicas y equipamiento</span>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="weight_kg" className={eyebrow}>
                Peso (kg)
              </label>
              <input
                id="weight_kg"
                name="weight_kg"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="1"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                onBlur={() => markTouched("weight")}
                className={cn(profileInputClass, weightInvalid && invalidFieldClass)}
              />
              {weightInvalid && <span className={errorTextClass}>Campo obligatorio</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ftp" className={eyebrow}>
                FTP (W)
              </label>
              <input
                id="ftp"
                name="ftp"
                type="number"
                inputMode="numeric"
                min="1"
                value={ftp}
                onChange={(e) => setFtp(e.target.value)}
                onBlur={() => markTouched("ftp")}
                className={cn(profileInputClass, ftpInvalid && invalidFieldClass)}
              />
              {ftpInvalid && <span className={errorTextClass}>Campo obligatorio</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bottle_count" className={eyebrow}>
                Soportes de bidón
              </label>
              <select
                id="bottle_count"
                name="bottle_count"
                defaultValue={profile?.bottle_count ?? 2}
                className={selectableProfileInputClass}
              >
                <option value={1}>1 bidón</option>
                <option value={2}>2 bidones</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bottle_capacity_ml" className={eyebrow}>
                Capacidad por bidón
              </label>
              <select
                id="bottle_capacity_ml"
                name="bottle_capacity_ml"
                defaultValue={profile?.bottle_capacity_ml ?? 500}
                className={selectableProfileInputClass}
              >
                <option value={500}>500 ml</option>
                <option value={600}>600 ml</option>
                <option value={750}>750 ml</option>
                <option value={950}>950 ml</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <span className={cardNumberHeading}>02 · Fenotipo metabólico y sudoración</span>

          <div className="flex flex-col gap-1.5">
            <span className={eyebrow}>Fenotipo metabólico (VLaMax)</span>
            <div
              className={cn(
                "grid grid-cols-1 gap-2 sm:grid-cols-3",
                athleteTypeInvalid && invalidGroupClass
              )}
              onBlur={onGroupBlur("athleteType")}
            >
              {(Object.keys(athleteTypeLabels) as AthleteType[]).map((type) => (
                <label
                  key={type}
                  className="flex cursor-pointer flex-col gap-1 rounded-lg border border-neutral-200 px-3 py-2.5 transition-colors duration-150 has-checked:border-terracotta has-checked:bg-[#FDF8F6]"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="athlete_type"
                      value={type}
                      checked={athleteType === type}
                      onChange={() => setAthleteType(type)}
                      className="size-3.5 cursor-pointer accent-terracotta"
                    />
                    <span className="text-sm font-medium text-neutral-900">
                      {athleteTypeLabels[type]}
                    </span>
                  </span>
                  <span className="text-xs text-neutral-500">{athleteTypeDescriptions[type]}</span>
                </label>
              ))}
            </div>
            {athleteTypeInvalid && <span className={errorTextClass}>Campo obligatorio</span>}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={cn(eyebrow, "flex items-center")}>
              Tasa de sudoración
              <InfoTooltip
                label="Contexto sobre sudoración y sodio"
                note="La tasa de sudoración y la concentración de sodio en el sudor varían mucho por persona — sin un sudor test real, las marcas de sal visibles en la ropa son la señal más fiable para autoevaluarte."
              />
            </span>
            <div
              className={cn(
                "grid grid-cols-1 gap-2 sm:grid-cols-3",
                sweatRateInvalid && invalidGroupClass
              )}
              onBlur={onGroupBlur("sweatRate")}
            >
              {(Object.keys(sweatRateLabels) as SweatRate[]).map((rate) => (
                <label
                  key={rate}
                  className={cn(
                    "group flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 text-neutral-700 transition-colors duration-150 hover:border-neutral-400",
                    sweatRate === rate ? "border-terracotta bg-terracotta text-white" : "border-neutral-200"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="sweat_rate"
                      value={rate}
                      checked={sweatRate === rate}
                      onChange={() => setSweatRate(rate)}
                      className="size-3.5 cursor-pointer accent-terracotta"
                    />
                    <span className="text-sm font-semibold">{sweatRateLabels[rate]}</span>
                  </span>
                  <span
                    className={cn(
                      "mt-1 font-mono text-[11px] leading-tight",
                      sweatRate === rate ? "text-white/80" : "text-neutral-500"
                    )}
                  >
                    {sweatRateDescriptions[rate]}
                  </span>
                </label>
              ))}
            </div>
            {sweatRateInvalid && <span className={errorTextClass}>Campo obligatorio</span>}
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              name="is_salty_sweater"
              defaultChecked={profile?.is_salty_sweater ?? false}
              className="mt-0.5 size-3.5 cursor-pointer accent-terracotta"
            />
            <span>
              Sudo mucha sal (cercos blancos en el maillot / escozor en los ojos)
              <span className="block text-xs text-neutral-500">
                Eleva el objetivo de sodio de la receta para prevenir calambres e hiponatremia
                en rutas largas.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <span className={cn(cardNumberHeading, "flex items-center")}>
            03 · Adaptación digestiva
            <InfoTooltip
              label="Contexto sobre adaptación digestiva"
              note="La capacidad de absorber carbohidratos en ruta es entrenable, igual que las piernas: exponer al intestino a dosis crecientes de forma repetida sube el techo con el tiempo, sin necesidad de mejorar la forma física."
            />
          </span>
          <p className="text-sm text-neutral-500">
            El intestino se entrena igual que las piernas — tolerar más carbohidratos por hora
            en ruta es una capacidad que se gana progresivamente. Tu nivel actual limita el
            máximo que el planificador te recomendará, aunque la intensidad de la ruta pida más.
          </p>
          <GutTrainingSelector
            value={gutTrainingLevel}
            onChange={setGutTrainingLevel}
            onGroupBlur={() => markTouched("gutTrainingLevel")}
            invalid={gutTrainingInvalid}
          />
        </CardContent>
      </Card>

      <div className="flex flex-col items-center gap-2">
        <button
          type="submit"
          disabled={!isFormValid || isSubmitting}
          className={cn(
            "w-full rounded-lg py-3.5 text-xs shadow-sm",
            isFormValid && !isSubmitting
              ? primaryButtonClass
              : "inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-neutral-300 font-mono text-xs font-semibold tracking-wider text-neutral-500 uppercase opacity-60"
          )}
        >
          {isSubmitting ? "Guardando…" : "Guardar cambios"}
        </button>
        {!isFormValid && (
          <span className="font-mono text-[11px] text-neutral-500">
            * Completa todos los campos obligatorios para guardar.
          </span>
        )}
      </div>
    </form>
  );
}

"use client";

import { ChevronDown, FlaskConical } from "lucide-react";
import { useMemo, useState, type FocusEvent } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { FtpEstimatorModal } from "@/components/ftp-estimator-modal";
import { GutTrainingSelector } from "@/components/gut-training-selector";
import { InfoTooltip } from "@/components/info-tooltip";
import { RadioCard } from "@/components/radio-card";
import type { AthleteProfile } from "@/lib/dashboard-data";
import {
  athleteTypeDescriptions,
  athleteTypeLabels,
  getWkgBarPercentage,
  getWkgCategory,
  sweatRateDescriptions,
  sweatRateLabels,
  type AthleteType,
  type GutTrainingLevel,
  type SweatRate,
} from "@/lib/metabolic-engine";
import {
  fieldClass,
  primaryButtonClass,
  selectableFieldClass,
  selectChevronClass,
} from "@/lib/ui-classes";
import { cn } from "@/lib/utils";

const eyebrow = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
const cardNumberHeading = "font-mono text-xs font-bold tracking-widest text-neutral-500 uppercase";

const errorTextClass = "mt-1 font-mono text-[11px] text-red-500";
const invalidFieldClass = "border-red-500 focus:border-red-500 focus:ring-red-500";
const invalidGroupClass = "rounded-sm ring-1 ring-red-500";

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
 * `bottle_count`/`bottle_capacity_ml`/`is_salty_sweater` are controlled too
 * (previously plain `defaultValue`/`defaultChecked` uncontrolled inputs) —
 * not because they need validating (a `<select>` is never "empty," and an
 * unchecked checkbox is never invalid), but because `hasChanges` below needs
 * to see their *live* value to know whether the athlete actually edited
 * anything, the same reason every other field became controlled in an
 * earlier pass.
 *
 * **Dirty-tracking gate (`hasChanges`).** "Guardar cambios" used to enable
 * the instant every required field was filled, even if none of them
 * actually differed from what was already saved — reopening `/perfil` with
 * an already-complete profile and touching nothing still left the button
 * clickable. `hasChanges` compares each field's current state against the
 * `profile` prop's own values (the one snapshot Supabase returned for this
 * request) and the button is now `disabled` unless the form is both valid
 * *and* dirty. `profile` itself doubles as the "initial values" reference —
 * no separate ref/copy is needed, since this component's real submission is
 * a native `<form action="...">` POST that redirects the whole browser on
 * both success (to the Dashboard, see `app/api/athlete-profile/update`) and
 * failure (back to `/perfil?profile_error=...`) — either way the component
 * fully remounts with a fresh `profile` prop from the server rather than
 * needing an in-place JS reset after a successful save.
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
  const [bottleCount, setBottleCount] = useState(profile?.bottle_count ?? 2);
  // "Estandarización Unificada de Bidones (550/750/950ml)" — 550ml is now
  // both this app's internal *reference recipe* size (`BASE_BOTTLE_ML` in
  // `lib/metabolic-engine.ts`, the fixed 44g HC dose the DIY mix is
  // calibrated against) *and* the default real, persistable
  // `bottle_capacity_ml` option, replacing the old 500/600/750/950 set —
  // 500 and 600 are no longer offered anywhere in the app (see
  // `VALID_BOTTLE_CAPACITIES_ML` in `app/api/athlete-profile/update/
  // route.ts` and the `<option>`s below). **Requires a manual Supabase
  // migration** — the DB column's own `CHECK` constraint still only allows
  // the old 500/600/750/950 set as of this pass (no migration tooling
  // exists in this repo to run it automatically), so until that constraint
  // is widened to `IN (550, 750, 950)`, submitting the new default `550`
  // will fail the DB write. Flagged transparently rather than silently
  // shipping a value the live database would still reject.
  const [bottleCapacityMl, setBottleCapacityMl] = useState(profile?.bottle_capacity_ml ?? 550);
  const [isSaltySweater, setIsSaltySweater] = useState(profile?.is_salty_sweater ?? false);
  const [touched, setTouched] = useState<Partial<Record<RequiredField, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const markTouched = (field: RequiredField) => setTouched((t) => ({ ...t, [field]: true }));

  const weightValid = Boolean(weight) && Number(weight) > 0;
  const ftpValid = Boolean(ftp) && Number(ftp) > 0;
  const isFormValid = Boolean(weightValid && ftpValid && athleteType && sweatRate && gutTrainingLevel);

  // Purely reactive, read-only — recalculates from whatever Peso/FTP the
  // athlete has typed so far, live, on every keystroke; never an editable
  // field of its own and never persisted (the server route has no `wkg`
  // column to save it to — it's just FTP ÷ Peso, trivially re-derivable
  // any time both real values are on hand). `0` (not `NaN`/`Infinity`) below
  // a genuinely valid weight, so the pill's own `wkg > 0` guard hides it
  // cleanly rather than ever rendering a broken number mid-typing.
  const wkg = weightValid && ftpValid ? Number(ftp) / Number(weight) : 0;
  const wkgCategory = wkg > 0 ? getWkgCategory(wkg) : null;
  const wkgBarPercentage = wkg > 0 ? getWkgBarPercentage(wkg) : 0;

  const hasChanges = useMemo(
    () =>
      weight !== (profile?.weight_kg?.toString() ?? "") ||
      ftp !== (profile?.ftp?.toString() ?? "") ||
      athleteType !== (profile?.athlete_type ?? null) ||
      sweatRate !== (profile?.sweat_rate ?? null) ||
      gutTrainingLevel !== (profile?.gut_training_level ?? null) ||
      bottleCount !== (profile?.bottle_count ?? 2) ||
      bottleCapacityMl !== (profile?.bottle_capacity_ml ?? 550) ||
      isSaltySweater !== (profile?.is_salty_sweater ?? false),
    [
      weight,
      ftp,
      athleteType,
      sweatRate,
      gutTrainingLevel,
      bottleCount,
      bottleCapacityMl,
      isSaltySweater,
      profile,
    ]
  );

  const canSave = isFormValid && hasChanges && !isSubmitting;

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
      <Card className="overflow-visible">
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={cardNumberHeading}>01 · Métricas físicas y equipamiento</span>
              {/* Read-only W/kg readout — FTP ÷ Peso, recalculated live from
                  the two controlled inputs directly below, never its own
                  input and never persisted (see the `wkg`/`wkgCategory`
                  derivation above). Plain inline text, no box — an earlier
                  pass wrapped this in a bordered `bg-[#F8F7F5]` pill; a later
                  request explicitly asked for "cero fondos pesados," so it's
                  now just clean editorial `font-mono` text sitting flush
                  against the section eyebrow, the same "quiet technical
                  readout, not a call-to-action" intent as before, just
                  without the container. `flex-wrap` on the parent row still
                  lets this drop to its own line below the (longer) eyebrow
                  label on a narrow phone instead of both squeezing onto one
                  forced row. */}
              {wkgCategory && (
                <div className="flex shrink-0 items-center gap-1.5 font-mono text-xs whitespace-nowrap text-zinc-800">
                  <span className="font-bold text-zinc-900">{wkg.toFixed(2)} W/kg</span>
                  <span className="text-zinc-400">·</span>
                  <span className="text-zinc-500">{wkgCategory.label}</span>
                </div>
              )}
            </div>
            {/* Micro-graduated scale bar — a thin, five-band gradient
                (Principiante → Pro/Excepcional across the same 1.5-5.5 W/kg
                spectrum `getWkgCategory` bands into labels) with a small
                dark notch marking the athlete's own live position
                (`getWkgBarPercentage`). Deliberately not one of this app's
                `rounded-sm` selector/card/button shapes — a progress-bar
                track, styled `rounded-full` like every other track/pill in
                the app, reactive on every keystroke since it's derived from
                the exact same `wkg` value as the text readout above it. */}
            {wkgCategory && (
              <div className="relative w-full pt-1">
                <div className="flex h-1.5 w-full divide-x divide-white overflow-hidden rounded-full bg-zinc-100">
                  <div className="w-1/5 bg-zinc-200/60" title="Principiante (<2.0)" />
                  <div className="w-1/5 bg-zinc-200/80" title="Recreacional (2.0-2.8)" />
                  <div className="w-1/5 bg-zinc-300/80" title="Intermedio (2.8-3.5)" />
                  <div className="w-1/5 bg-zinc-400/80" title="Avanzado (3.5-4.2)" />
                  <div className="w-1/5 bg-zinc-500/80" title="Elite / Pro (>4.2)" />
                </div>
                <div
                  className="absolute top-0.5 -ml-1 h-2.5 w-2 rounded-sm bg-zinc-900 shadow-sm transition-all duration-300"
                  style={{ left: `${wkgBarPercentage}%` }}
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 *:min-w-0">
            {/* Both columns share one fixed-height header row (`h-5`) so
                the inputs below stay perfectly aligned regardless of what
                either header actually contains — Peso's header is a bare
                one-line label, but FTP's carries a label + tooltip + the
                "Estimar" trigger, which used to wrap onto a second line on
                a narrow phone (`flex-wrap`) and silently push its own
                input down relative to Peso's. `whitespace-nowrap` on every
                piece inside the FTP header backs the fixed height up —
                content can't wrap even if it tried to. */}
            <div className="flex flex-col gap-1.5">
              <div className="flex h-5 items-center">
                <label htmlFor="weight_kg" className={cn(eyebrow, "whitespace-nowrap")}>
                  Peso (kg)
                </label>
              </div>
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
              <div className="flex h-5 items-center justify-between gap-1.5">
                {/* The `(?)` tooltip that used to sit next to this label
                    was removed as redundant — the "Estimar" trigger right
                    beside it already offers the guided explanation and the
                    actual estimation tool, so the two were saying the same
                    thing twice. */}
                <label htmlFor="ftp" className={cn(eyebrow, "whitespace-nowrap")}>
                  FTP (W)
                </label>
                <FtpEstimatorModal
                  weightKg={weightValid ? Number(weight) : null}
                  onApply={(estimatedFtp) => {
                    setFtp(String(estimatedFtp));
                    markTouched("ftp");
                  }}
                />
              </div>
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
              <div className="relative">
                <select
                  id="bottle_count"
                  name="bottle_count"
                  value={bottleCount}
                  onChange={(e) => setBottleCount(Number(e.target.value))}
                  className={selectableProfileInputClass}
                >
                  <option value={1}>1 bidón</option>
                  <option value={2}>2 bidones</option>
                </select>
                <ChevronDown className={selectChevronClass} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bottle_capacity_ml" className={eyebrow}>
                Capacidad por bidón
              </label>
              <div className="relative">
                <select
                  id="bottle_capacity_ml"
                  name="bottle_capacity_ml"
                  value={bottleCapacityMl}
                  onChange={(e) => setBottleCapacityMl(Number(e.target.value))}
                  className={selectableProfileInputClass}
                >
                  <option value={550}>550 ml</option>
                  <option value={750}>750 ml</option>
                  <option value={950}>950 ml</option>
                </select>
                <ChevronDown className={selectChevronClass} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-visible">
        <CardContent className="flex flex-col gap-4">
          <span className={cardNumberHeading}>02 · Fenotipo metabólico y sudoración</span>

          <div className="flex flex-col gap-1.5">
            <span className={cn(eyebrow, "flex items-center")}>
              Fenotipo metabólico (VLaMax)
              <InfoTooltip
                label="Contexto sobre VLaMax"
                note="Mide tu tasa de producción de lactato. Un VLaMax alto corresponde a un perfil explosivo/esprinter (mayor consumo de glucógeno); un VLaMax bajo corresponde a un perfil fondista/diésel."
              />
            </span>
            <div
              className={cn(
                "grid grid-cols-1 gap-2 sm:grid-cols-3",
                athleteTypeInvalid && invalidGroupClass
              )}
              onBlur={onGroupBlur("athleteType")}
            >
              {(Object.keys(athleteTypeLabels) as AthleteType[]).map((type) => (
                <RadioCard
                  key={type}
                  name="athlete_type"
                  value={type}
                  checked={athleteType === type}
                  onChange={() => setAthleteType(type)}
                  title={athleteTypeLabels[type]}
                >
                  {athleteTypeDescriptions[type]}
                </RadioCard>
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
                <RadioCard
                  key={rate}
                  name="sweat_rate"
                  value={rate}
                  checked={sweatRate === rate}
                  onChange={() => setSweatRate(rate)}
                  title={sweatRateLabels[rate]}
                >
                  {sweatRateDescriptions[rate]}
                </RadioCard>
              ))}
            </div>
            {sweatRateInvalid && <span className={errorTextClass}>Campo obligatorio</span>}
          </div>

          {/* Consolidated with "Tasa de sudoración" above — that selector's own
              "Alta" description already covers the same visible-salt signal
              ("Marcas blancas evidentes en maillot..."), so this no longer
              repeats it as a second descriptive block. `is_salty_sweater`
              stays a real, independent field (sweat *concentration* vs.
              sweat *volume* are genuinely different axes — see
              `getSodiumLossMgPerHour` in `lib/metabolic-engine.ts`), just
              surfaced as one compact refinement line instead of a duplicate
              sub-section. */}
          <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-600">
            <input
              type="checkbox"
              name="is_salty_sweater"
              checked={isSaltySweater}
              onChange={(e) => setIsSaltySweater(e.target.checked)}
              className="size-3.5 shrink-0 cursor-pointer accent-terracotta"
            />
            Además, mi sudor es especialmente salado (más allá del volumen) — sube el objetivo
            de sodio.
          </label>
        </CardContent>
      </Card>

      <Card id="gut-training" className="overflow-visible">
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

          {/* "Módulo Educativo de Gut Training" — the Fueling Planner's own
              "Límite digestivo superado" warning links here
              (`/perfil#gut-training`) precisely because raising the level
              above isn't a settings tweak that instantly unlocks more
              absorption — it only moves once the athlete has actually put
              in the weeks of progressive gut training this explains. A
              `<details>` accordion, closed by default, matching this app's
              existing convention for supplementary/optional reading (see
              "Estrategia de carga día −1" in the Fueling Planner) — this is
              context for the curious, not something every visit to
              `/perfil` needs to show expanded. `FlaskConical` stands in for
              the "🧪" the brief used in its own heading — this app's
              established "no emoji, technical typography/vector icons
              instead" convention applies to section headings too, not just
              food-catalog rows. */}
          <details className="group rounded-lg bg-[#F8F7F5] p-3.5">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-neutral-700 [&::-webkit-details-marker]:hidden">
              <FlaskConical className="size-3.5 shrink-0 text-terracotta" />
              <span className="flex-1">¿Cómo entrenar tu capacidad digestiva (Gut Training)?</span>
              <ChevronDown className="size-3.5 shrink-0 text-neutral-400 transition-transform duration-150 group-open:rotate-180" />
            </summary>
            <div className="mt-3 flex flex-col gap-3 border-t border-dashed border-zinc-300 pt-3 text-sm text-neutral-600">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold tracking-wide text-neutral-700 uppercase">
                  Fisiología básica
                </span>
                <p>
                  La absorción de carbohidratos en el intestino depende de transportadores
                  específicos: <strong>SGLT1</strong> para glucosa/maltodextrina y{" "}
                  <strong>GLUT5</strong> para fructosa. Ambos son adaptables — se multiplican con
                  la exposición repetida, igual que el músculo responde al entrenamiento — por
                  eso la capacidad digestiva sube con la práctica, no con la forma física.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold tracking-wide text-neutral-700 uppercase">
                  Protocolo progresivo (6-8 semanas)
                </span>
                <ol className="flex flex-col gap-1.5">
                  <li>
                    <span className="font-mono text-xs font-semibold text-neutral-800">
                      Semanas 1-2:
                    </span>{" "}
                    incrementa tu ingesta en salidas Z2 a 60-70 g/h usando un ratio 2:1 o 1:0.8
                    (malto:fructosa).
                  </li>
                  <li>
                    <span className="font-mono text-xs font-semibold text-neutral-800">
                      Semanas 3-4:
                    </span>{" "}
                    sube a 80 g/h incorporando mezclas de malto/fructosa en entrenamientos
                    clave.
                  </li>
                  <li>
                    <span className="font-mono text-xs font-semibold text-neutral-800">
                      Semanas 5-6+:
                    </span>{" "}
                    ensayos a 90-100 g/h en salidas simuladas de intensidad de carrera.
                  </li>
                </ol>
              </div>
              <p className="border-t border-dashed border-zinc-300 pt-3 text-xs text-neutral-500">
                <strong className="text-neutral-700">Consejo práctico:</strong> sube tu nivel de
                Adaptación Digestiva aquí arriba solo cuando hayas completado con éxito 3-4
                salidas en ruta al nuevo ritmo objetivo sin molestias estomacales — no antes.
              </p>
            </div>
          </details>
        </CardContent>
      </Card>

      <div className="flex flex-col items-center gap-2">
        <button
          type="submit"
          disabled={!canSave}
          className={cn(
            "w-full rounded-sm py-3.5 text-xs transition-all duration-150",
            canSave
              ? primaryButtonClass
              : "inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-sm bg-neutral-300/30 font-mono text-xs font-semibold tracking-wider text-neutral-400 uppercase opacity-60 shadow-none"
          )}
        >
          {isSubmitting ? "Guardando…" : "Guardar cambios"}
        </button>
        {!isFormValid ? (
          <span className="font-mono text-[11px] text-neutral-500">
            * Completa todos los campos obligatorios para guardar.
          </span>
        ) : (
          !hasChanges && (
            <span className="font-mono text-[11px] text-neutral-500">
              * Modifica al menos un dato para poder guardar.
            </span>
          )
        )}
      </div>
    </form>
  );
}

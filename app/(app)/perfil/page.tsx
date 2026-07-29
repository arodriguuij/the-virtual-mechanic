import { TriangleAlert } from "lucide-react";
import { Suspense } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { GutTrainingSelector } from "@/components/gut-training-selector";
import { InfoTooltip } from "@/components/info-tooltip";
import { ProfileSavedToast } from "@/components/profile-saved-toast";
import { getAthleteProfile } from "@/lib/dashboard-data";
import {
  athleteTypeDescriptions,
  athleteTypeLabels,
  sweatRateDescriptions,
  sweatRateLabels,
  type SweatRate,
} from "@/lib/metabolic-engine";
import { fieldClass, primaryButtonClass, selectableFieldClass } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const eyebrow = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
// Distinct from the generic `eyebrow` above — this page's three numbered
// section headers ("01 · MÉTRICAS...") read as a technical step sequence,
// which is what earns them the monospace treatment; every other card title
// in this app stays in the plain geometric sans (see CLAUDE.md's "Code
// style" section on `font-mono` being reserved for numeric readouts and,
// now, this one numbered-header exception).
const cardNumberHeading = "font-mono text-xs font-bold tracking-widest text-neutral-500 uppercase";

// Shared with every other field/button across the app (`lib/ui-classes.ts`).
const profileInputClass = fieldClass;
const selectableProfileInputClass = selectableFieldClass;

async function PhysiologicalProfileCard() {
  const profile = await getAthleteProfile();

  return (
    <form
      action="/api/athlete-profile/update"
      method="POST"
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
                required
                defaultValue={profile?.weight_kg ?? ""}
                className={profileInputClass}
              />
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
                required
                defaultValue={profile?.ftp ?? ""}
                className={profileInputClass}
              />
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
                defaultValue={profile?.bottle_capacity_ml ?? 750}
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(Object.keys(athleteTypeLabels) as (keyof typeof athleteTypeLabels)[]).map(
                (type) => (
                  <label
                    key={type}
                    className="flex cursor-pointer flex-col gap-1 rounded-lg border border-neutral-200 px-3 py-2.5 transition-colors duration-150 has-checked:border-terracotta has-checked:bg-[#FDF8F6]"
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="athlete_type"
                        value={type}
                        defaultChecked={(profile?.athlete_type ?? "balanced") === type}
                        className="size-3.5 cursor-pointer accent-terracotta"
                      />
                      <span className="text-sm font-medium text-neutral-900">
                        {athleteTypeLabels[type]}
                      </span>
                    </span>
                    <span className="text-xs text-neutral-500">
                      {athleteTypeDescriptions[type]}
                    </span>
                  </label>
                )
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={cn(eyebrow, "flex items-center")}>
              Tasa de sudoración
              <InfoTooltip
                label="Contexto sobre sudoración y sodio"
                note="La tasa de sudoración y la concentración de sodio en el sudor varían mucho por persona — sin un sudor test real, las marcas de sal visibles en la ropa son la señal más fiable para autoevaluarte."
              />
            </span>
            {/* Solid-fill active state (`bg-terracotta`), matching the Gut
                Training cards right below — see that component's own doc
                comment for why this is a scoped upgrade, not applied to the
                "Fenotipo metabólico" cards above. Plain `has-checked:` CSS,
                no client state needed: unlike Gut Training, nothing else on
                this page reads the selected sweat rate live. */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(Object.keys(sweatRateLabels) as SweatRate[]).map((rate) => (
                <label
                  key={rate}
                  className="group flex cursor-pointer flex-col gap-1 rounded-lg border border-neutral-200 px-3 py-2.5 text-neutral-700 transition-colors duration-150 has-checked:border-terracotta has-checked:bg-terracotta has-checked:text-white hover:border-neutral-400"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="sweat_rate"
                      value={rate}
                      defaultChecked={(profile?.sweat_rate ?? "medium") === rate}
                      className="size-3.5 cursor-pointer accent-terracotta"
                    />
                    <span className="text-sm font-semibold">{sweatRateLabels[rate]}</span>
                  </span>
                  <span className="mt-1 font-mono text-[11px] leading-tight text-neutral-500 group-has-checked:text-white/80">
                    {sweatRateDescriptions[rate]}
                  </span>
                </label>
              ))}
            </div>
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
          <GutTrainingSelector defaultLevel={profile?.gut_training_level ?? "intermediate"} />
        </CardContent>
      </Card>

      <button
        type="submit"
        className={cn(
          primaryButtonClass,
          "w-full rounded-lg py-3.5 text-xs shadow-sm"
        )}
      >
        Guardar cambios
      </button>
    </form>
  );
}

// Mirrors the real form's three numbered cards and their actual, static
// labels (never dependent on `getAthleteProfile()`) instead of a generic set
// of unrelated gray bars — only the value-bearing fields (which genuinely
// aren't known yet) get a muted, pulsing placeholder, matching the "labels
// visible instantly, values fill in" rule this pass is built around.
function PhysiologicalProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <span className={cardNumberHeading}>01 · Métricas físicas y equipamiento</span>
          <div className="grid grid-cols-2 gap-4">
            {["Peso (kg)", "FTP (W)", "Soportes de bidón", "Capacidad por bidón"].map((label) => (
              <div key={label} className="flex flex-col gap-1.5">
                <span className={eyebrow}>{label}</span>
                <div
                  className={cn(
                    profileInputClass,
                    "flex animate-pulse items-center bg-neutral-100 text-sm text-neutral-400"
                  )}
                >
                  Cargando…
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <span className={cardNumberHeading}>02 · Fenotipo metabólico y sudoración</span>
          <div className="flex flex-col gap-1.5">
            <span className={eyebrow}>Fenotipo metabólico (VLaMax)</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-18.5 animate-pulse rounded-lg border border-neutral-200 bg-neutral-100"
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={eyebrow}>Tasa de sudoración</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-18.5 animate-pulse rounded-lg border border-neutral-200 bg-neutral-100"
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <span className={cardNumberHeading}>03 · Adaptación digestiva</span>
          <p className="text-sm text-neutral-500">
            El intestino se entrena igual que las piernas — tolerar más carbohidratos por hora
            en ruta es una capacidad que se gana progresivamente. Tu nivel actual limita el
            máximo que el planificador te recomendará, aunque la intensidad de la ruta pida más.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg border border-neutral-200 bg-neutral-100" />
            ))}
          </div>
        </CardContent>
      </Card>

      <div className={cn(primaryButtonClass, "pointer-events-none w-full justify-center py-3.5 text-xs opacity-50")}>
        Guardar cambios
      </div>
    </div>
  );
}

const profileErrorMessages: Record<string, string> = {
  invalid_weight: "Introduce un peso válido.",
  invalid_ftp: "Introduce un FTP válido.",
  invalid_sweat_rate: "Selecciona una tasa de sudoración válida.",
  invalid_gut_training_level: "Selecciona un nivel de capacidad digestiva válido.",
  invalid_athlete_type: "Selecciona un fenotipo metabólico válido.",
  invalid_bottle_count: "Selecciona un número de soportes de bidón válido.",
  invalid_bottle_capacity_ml: "Selecciona una capacidad de bidón válida.",
  no_session: "No se pudo verificar la sesión de desarrollo.",
  update_blocked_by_rls: "No se pudo guardar el perfil: RLS bloqueó el UPDATE.",
};

export default async function PerfilPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;

  const profileErrorCode = params.profile_error;
  const profileError =
    typeof profileErrorCode === "string"
      ? (profileErrorMessages[profileErrorCode] ?? "No se pudo guardar el perfil fisiológico.")
      : null;

  const profileSaved = params.profile_saved === "1";

  return (
    <>
      {profileSaved && <ProfileSavedToast />}
      <div className="flex flex-col gap-6">
        <header className="border-b border-neutral-200 pb-6">
          <h1 className="text-xl font-bold font-mono text-neutral-900 uppercase tracking-tight sm:text-2xl">
            Perfil fisiológico
          </h1>
          <p className="text-xs font-mono text-neutral-500 mt-1 leading-relaxed">
            Línea base metabólica, parámetros fijos y capacidad digestiva
          </p>
        </header>

        {profileError && (
          <div className="flex items-center gap-2 border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-sm text-status-warning">
            <TriangleAlert className="size-4 shrink-0" />
            {profileError}
          </div>
        )}

        <Suspense fallback={<PhysiologicalProfileSkeleton />}>
          <PhysiologicalProfileCard />
        </Suspense>
      </div>
    </>
  );
}

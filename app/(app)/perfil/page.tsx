import { TriangleAlert } from "lucide-react";
import { Suspense } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GutTrainingSelector } from "@/components/gut-training-selector";
import { ProfileSavedToast } from "@/components/profile-saved-toast";
import { getAthleteProfile } from "@/lib/dashboard-data";
import { athleteTypeDescriptions, athleteTypeLabels, sweatRateLabels } from "@/lib/metabolic-engine";
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
            <label htmlFor="sweat_rate" className={eyebrow}>
              Tasa de sudoración
            </label>
            <select
              id="sweat_rate"
              name="sweat_rate"
              defaultValue={profile?.sweat_rate ?? "medium"}
              className={cn(selectableProfileInputClass, "sm:w-1/2")}
            >
              {(Object.keys(sweatRateLabels) as (keyof typeof sweatRateLabels)[]).map((rate) => (
                <option key={rate} value={rate}>
                  {sweatRateLabels[rate]}
                </option>
              ))}
            </select>
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
          <span className={cardNumberHeading}>03 · Adaptación digestiva</span>
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

function PhysiologicalProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: 3 }).map((_, cardIndex) => (
        <Card key={cardIndex}>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
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

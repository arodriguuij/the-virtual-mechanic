import { TriangleAlert } from "lucide-react";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardShell } from "@/components/dashboard-shell";
import { ProfileSavedToast } from "@/components/profile-saved-toast";
import { ViewerIdentity, ViewerIdentitySkeleton } from "@/components/viewer-identity";
import { getAthleteProfile } from "@/lib/dashboard-data";
import {
  athleteTypeDescriptions,
  athleteTypeLabels,
  gutTrainingLevelLabels,
  gutTrainingLevelRanges,
  sweatRateLabels,
} from "@/lib/metabolic-engine";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const eyebrow = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";

const profileInputClass =
  "border border-neutral-300 bg-background px-3 py-2.5 text-sm text-neutral-900 outline-none focus:border-neutral-900";
// Selects are "pick one" controls, unlike the plain number inputs sharing
// `profileInputClass` — an explicit pointer cursor signals that difference.
const selectableProfileInputClass = cn(profileInputClass, "cursor-pointer");
const primaryButtonClass =
  "inline-flex w-full cursor-pointer items-center justify-center gap-2 border border-neutral-900 bg-neutral-900 px-6 py-3 text-xs font-bold tracking-widest text-background uppercase transition-colors duration-150 hover:bg-background hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-neutral-900 disabled:hover:text-background sm:w-fit";

async function PhysiologicalProfileCard() {
  const profile = await getAthleteProfile();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfil fisiológico</CardTitle>
        <CardDescription className={eyebrow}>
          {profile
            ? "Tu línea base metabólica — peso sincronizado desde Strava al conectar"
            : "Todavía no has configurado tu perfil de atleta"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form action="/api/athlete-profile/update" method="POST" className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
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
              <label htmlFor="sweat_rate" className={eyebrow}>
                Sudoración
              </label>
              <select
                id="sweat_rate"
                name="sweat_rate"
                defaultValue={profile?.sweat_rate ?? "medium"}
                className={selectableProfileInputClass}
              >
                {(Object.keys(sweatRateLabels) as (keyof typeof sweatRateLabels)[]).map((rate) => (
                  <option key={rate} value={rate}>
                    {sweatRateLabels[rate]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="gut_training_level" className={eyebrow}>
                Gut training
              </label>
              <select
                id="gut_training_level"
                name="gut_training_level"
                defaultValue={profile?.gut_training_level ?? "intermediate"}
                className={selectableProfileInputClass}
              >
                {(
                  Object.keys(gutTrainingLevelLabels) as (keyof typeof gutTrainingLevelLabels)[]
                ).map((level) => (
                  <option key={level} value={level}>
                    {gutTrainingLevelLabels[level]} ({gutTrainingLevelRanges[level]})
                  </option>
                ))}
              </select>
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

          <div className="flex flex-col gap-1.5">
            <span className={eyebrow}>Fenotipo metabólico (VLaMax)</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(Object.keys(athleteTypeLabels) as (keyof typeof athleteTypeLabels)[]).map(
                (type) => (
                  <label
                    key={type}
                    className="flex cursor-pointer flex-col gap-1 rounded-sm border border-neutral-300 px-3 py-2.5 transition-colors duration-150 has-checked:border-neutral-900 has-checked:bg-neutral-100"
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="athlete_type"
                        value={type}
                        defaultChecked={(profile?.athlete_type ?? "balanced") === type}
                        className="size-3.5 cursor-pointer accent-neutral-900"
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

          <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              name="is_salty_sweater"
              defaultChecked={profile?.is_salty_sweater ?? false}
              className="mt-0.5 size-3.5 cursor-pointer accent-neutral-900"
            />
            <span>
              Sudo mucha sal (cercos blancos en el maillot / escozor en los ojos)
              <span className="block text-xs text-neutral-500">
                Eleva el objetivo de sodio de la receta para prevenir calambres e hiponatremia
                en rutas largas.
              </span>
            </span>
          </label>

          <button type="submit" className={primaryButtonClass}>
            Guardar
          </button>
        </form>

        <div className="border-t border-neutral-200 pt-4">
          <span className={eyebrow}>Escala de adaptación digestiva (Gut Training)</span>
          <p className="mt-1.5 text-sm text-neutral-500">
            El intestino se entrena igual que las piernas — tolerar más carbohidratos por hora
            en ruta es una capacidad que se gana progresivamente. Tu nivel actual limita el
            máximo que el planificador te recomendará, aunque la intensidad de la ruta pida
            más.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm text-neutral-700 sm:grid-cols-4">
            {(
              Object.keys(gutTrainingLevelLabels) as (keyof typeof gutTrainingLevelLabels)[]
            ).map((level) => (
              <li key={level} className="flex flex-col gap-0.5 border border-neutral-200 px-3 py-2">
                <span className="font-medium text-neutral-900">{gutTrainingLevelLabels[level]}</span>
                <span className="text-xs text-neutral-500">{gutTrainingLevelRanges[level]}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function PhysiologicalProfileSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const profileErrorMessages: Record<string, string> = {
  invalid_weight: "Introduce un peso válido.",
  invalid_ftp: "Introduce un FTP válido.",
  invalid_sweat_rate: "Selecciona una tasa de sudoración válida.",
  invalid_gut_training_level: "Selecciona un nivel de Gut Training válido.",
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
    <DashboardShell
      identitySlot={
        <Suspense fallback={<ViewerIdentitySkeleton />}>
          <ViewerIdentity />
        </Suspense>
      }
    >
      {profileSaved && <ProfileSavedToast />}
      <div className="flex flex-col gap-10">
        <header className="border-b border-neutral-200 pb-6">
          <p className={eyebrow}>Línea base metabólica</p>
          <h1 className="mt-1 text-2xl font-bold tracking-wide text-neutral-900 uppercase">
            Perfil fisiológico
          </h1>
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
    </DashboardShell>
  );
}

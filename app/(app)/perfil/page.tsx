import { TriangleAlert } from "lucide-react";
import { Suspense } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { PhysiologicalProfileForm } from "@/components/physiological-profile-form";
import { getAthleteProfile, getStravaAthleteWeightKg } from "@/lib/dashboard-data";
import { fieldClass, primaryButtonClass } from "@/lib/ui-classes";
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

async function PhysiologicalProfileCard() {
  const profile = await getAthleteProfile();
  // The one legitimate exception to "never fabricate a value": Strava's own
  // real weight reading for this athlete, used purely to prefill the form
  // field below — never persisted on the athlete's behalf (see
  // `getStravaAthleteWeightKg`'s own doc comment). Only fetched when there's
  // no profile row yet; an athlete who already has one already has a real
  // `weight_kg` of their own, so there's nothing to prefill.
  const stravaWeightKg = profile ? null : await getStravaAthleteWeightKg();

  return <PhysiologicalProfileForm profile={profile} stravaWeightKg={stravaWeightKg} />;
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
                  className="h-18.5 animate-pulse rounded-lg bg-neutral-100"
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
                  className="h-18.5 animate-pulse rounded-lg bg-neutral-100"
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
              <div key={i} className="h-16 animate-pulse rounded-lg bg-neutral-100" />
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

// Only genuine server/infra failures still surface a banner here — every
// per-field validation error (invalid_weight, invalid_sweat_rate, etc.) is
// now prevented before the form can ever submit at all (see
// `PhysiologicalProfileForm`'s `isFormValid` gate + inline "Campo
// obligatorio" errors), so the old full-width red banner for those specific
// codes was removed outright as redundant. `no_session`/`update_blocked_by_rls`
// are real backend failures with no client-side equivalent to catch them, so
// they're the one class of error that still needs a visible surface —
// deliberately an allowlist (not a map with a generic fallback message), so
// an unrecognized code renders nothing rather than resurrecting the banner.
const profileErrorMessages: Record<string, string> = {
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
    typeof profileErrorCode === "string" ? profileErrorMessages[profileErrorCode] ?? null : null;

  return (
    <div className="flex flex-col gap-6">
      {/* No divider line below the subtitle — the wrapper's own `gap-6`
          is the only separator before "01 · Métricas físicas..." now,
          matching the same "let whitespace do the work" treatment applied
          to the Dashboard's own header. */}
      <header>
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
  );
}

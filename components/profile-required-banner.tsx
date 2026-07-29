import Link from "next/link";

/**
 * Shown just below "Calcular estrategia nutricional"
 * (`components/fueling-planner.tsx`) and "Guardar consumo real"
 * (`components/post-ride-analysis.tsx`) whenever `isProfileComplete`
 * (`lib/dashboard-data.ts`) is false — both actions depend on the athlete's
 * real FTP/weight/sweat-rate/gut-training figures, so running either against
 * an incomplete profile would silently compute or log against a stand-in
 * value instead of the athlete's own. Deliberately amber rather than this
 * app's usual `status-warning` brick-red token: that color means "something
 * went wrong," this is a plain "here's the one thing to do next" nudge, a
 * different register worth keeping visually distinct.
 */
export function ProfileRequiredBanner() {
  return (
    <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 font-mono text-xs text-amber-700">
      <span>Debes completar tu Perfil Fisiológico para habilitar el cálculo de precisión.</span>
      <Link
        href="/perfil"
        className="shrink-0 font-semibold whitespace-nowrap underline underline-offset-2 hover:text-amber-900"
      >
        [ COMPLETAR PERFIL → ]
      </Link>
    </div>
  );
}

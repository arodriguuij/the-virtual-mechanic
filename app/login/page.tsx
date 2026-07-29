import { TriangleAlert } from "lucide-react";
import Link from "next/link";

import { AuthPageShell } from "@/components/auth-page-shell";
import { StravaLoginButton } from "@/components/strava-login-button";

export const dynamic = "force-dynamic";

const stravaLoginErrorMessages: Record<string, string> = {
  access_denied: "Cancelaste la conexión con Strava.",
  missing_code: "Strava no envió un código de autorización válido.",
  token_exchange_failed: "No se pudo intercambiar el código con Strava.",
  missing_athlete_id: "Strava no devolvió tu identidad de atleta — inténtalo de nuevo.",
  auth_bridge_failed: "No se pudo iniciar sesión en Motor Metabólico. Inténtalo de nuevo.",
  save_failed: "No se pudieron guardar los tokens de Strava.",
};

const headerPills = ["Ratio 1:0.8", "Meteo en vivo", "Mezcla casera"];

const telemetryStats = [
  { label: "Potencia NP", value: "228 W" },
  { label: "Glucógeno", value: "195 g" },
  { label: "Sudor", value: "1.2 L/h" },
];

/**
 * "Tarjeta Técnica" — a real mockup of the app's own visual language (the
 * Post-Ride telemetry card's badge/stat-grid pattern, the Fueling Planner's
 * terracotta-accented recommendation block), not an abstract illustration.
 * Deliberately 100% typographic — no icons, no emoji, not even the small
 * colored-dot "synced" indicator an earlier version had next to the badge —
 * every visual cue here is text weight/color/borders only, matching this
 * pass's "sobria" brief more strictly than the rest of the app (which does
 * use `lucide-react` icons elsewhere). The one deliberate exception on this
 * whole page is the Strava icomark on the CTA button below — Strava's API
 * Agreement requires it for brand identification (see "Strava API
 * compliance" in CLAUDE.md), so that one icon stays even though everything
 * else here goes text-only.
 *
 * Every figure here is illustrative/static (a real route name, a plausible
 * NP/glycogen/sweat-rate/carb-target set of numbers) — this card exists
 * purely to preview the *shape* of a real result, not to claim it's live
 * data, so nothing here needs a network round-trip or Strava connection.
 *
 * Sizing is mobile-first and deliberately compact by default: `AuthPageShell`
 * is a zero-scroll `h-dvh overflow-hidden` frame tuned to exactly zero
 * vertical slack at a 360×640 viewport (see "Root-level scroll lock" in
 * CLAUDE.md) — content that doesn't fit isn't scrollable, it's silently
 * clipped by that `overflow-hidden`.
 */
function DashboardPreviewCard() {
  return (
    <div className="mx-auto my-2 w-full max-w-md rounded-xl border border-neutral-200 bg-white p-3.5 text-left shadow-sm sm:my-3 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-md border border-emerald-200/60 bg-emerald-50 px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider text-emerald-700 uppercase">
          Strava Synced
        </span>
        <span className="font-mono text-[9px] text-neutral-400 sm:text-[10px]">27°C</span>
      </div>

      <div className="mt-1.5 sm:mt-2">
        <p className="truncate font-mono text-[11px] font-bold text-neutral-900 sm:text-sm">
          Puig Major &amp; Sa Calobra
        </p>
        <p className="font-mono text-[9px] text-neutral-500 sm:text-xs">84.5 km · 1.650m D+</p>
        <p className="font-mono text-[8px] text-neutral-400 sm:text-[10px]">Martes 28 de julio</p>
      </div>

      <div className="my-2.5 grid grid-cols-3 gap-1.5 rounded-lg border border-neutral-100 bg-[#FDFCF9] p-2 text-center">
        {telemetryStats.map((stat) => (
          <div key={stat.label}>
            <p className="truncate font-mono text-[7px] font-semibold tracking-wide text-neutral-500 uppercase sm:text-[9px]">
              {stat.label}
            </p>
            <p className="font-mono text-[11px] font-bold text-neutral-900 sm:text-sm">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-terracotta/30 bg-terracotta/5 p-2 sm:p-3">
        <p className="font-mono text-[7px] font-bold tracking-wide text-neutral-500 uppercase sm:text-[9px]">
          Pauta de ingesta recomendada
        </p>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 font-mono text-neutral-900">
          <span className="text-base font-bold sm:text-xl">85</span>
          <span className="text-[10px] font-normal text-neutral-500 sm:text-xs">g/h</span>
          <span className="text-[8px] font-normal text-neutral-500 sm:text-[10px]">
            (Ratio 1:0.8 Glucosa:Fructosa)
          </span>
        </p>
        <p className="mt-0.5 font-mono text-[8px] text-neutral-600 sm:text-[10px]">
          750 ml/h · 850 mg Sodio
        </p>
      </div>
    </div>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const errorCode = params.strava_error;
  const error =
    typeof errorCode === "string"
      ? (stravaLoginErrorMessages[errorCode] ?? "No se pudo completar la conexión con Strava.")
      : null;

  return (
    <AuthPageShell>
      <h1 className="max-w-lg px-4 text-center font-mono text-xl font-bold tracking-tight text-neutral-900 uppercase sm:text-3xl">
        Nutrición de precisión para ciclistas
      </h1>

      <div className="my-2 flex flex-wrap justify-center gap-1.5">
        {headerPills.map((pill) => (
          <span
            key={pill}
            className="rounded-full border border-neutral-300/80 px-2.5 py-1 font-mono text-[10px] text-neutral-600 uppercase tracking-wide sm:text-xs"
          >
            {pill}
          </span>
        ))}
      </div>

      <DashboardPreviewCard />

      {error && (
        <div className="mx-auto mb-2 flex w-full max-w-70 items-center gap-2 border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-left text-xs text-status-warning sm:mb-3 sm:px-4 sm:py-3 sm:text-sm">
          <TriangleAlert className="size-4 shrink-0" />
          {error}
        </div>
      )}

      <StravaLoginButton />

      <p className="mt-2 text-center font-mono text-[10px] text-neutral-500 sm:mt-3 sm:text-[11px]">
        Acceso seguro mediante OAuth. Solo lectura de rutas — nunca vendemos ni compartimos
        tus datos.{" "}
        <Link href="/privacidad" className="underline underline-offset-2 hover:text-neutral-700">
          Política de Privacidad
        </Link>
      </p>
    </AuthPageShell>
  );
}

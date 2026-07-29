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

const benefits = [
  "Recetas exactas de glucosa y fructosa",
  "Ajuste por meteorología en tiempo real",
  "Pautas listas para tu mezcla casera",
];

const telemetryStats = [
  { label: "Potencia NP", value: "228 W" },
  { label: "Glucógeno", value: "195 g" },
  { label: "Sudoración", value: "1.2 L/h" },
];

/**
 * "Tarjeta Técnica" — a real mockup of the app's own visual language (the
 * Post-Ride telemetry card's badge/stat-grid pattern, the Fueling Planner's
 * terracotta-accented recommendation block), not an abstract illustration.
 * Replaced an earlier hand-drawn SVG "route squiggle + 3 loose numbers,"
 * which read as too abstract/generic to build credibility for a brand-new
 * visitor deciding whether to trust this app with their Strava data.
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
 * clipped by that `overflow-hidden`. The benefits checklist above shrank
 * (`my-6`→`my-3`, `space-y-2.5`→`space-y-1.5`, smaller text) to make room,
 * since a full card *and* a full checklist *and* the Strava button never
 * fit together in that budget — verified live at 360×640 with this exact
 * spacing (zero overflow) before landing on it.
 */
function DashboardPreviewCard() {
  return (
    <div className="mx-auto my-2 w-full max-w-lg rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-sm sm:my-5 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200/60 bg-emerald-50 px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-wider text-emerald-700 uppercase sm:px-2 sm:text-[10px]">
          <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
          Strava Synced
        </span>
        <span className="font-mono text-[8px] text-neutral-400 sm:text-[10px]">27°C</span>
      </div>

      <div className="mt-1.5 sm:mt-2">
        <p className="truncate font-mono text-[11px] font-bold text-neutral-900 sm:text-sm">
          Puig Major &amp; Sa Calobra
        </p>
        <p className="font-mono text-[9px] text-neutral-500 sm:text-xs">84.5 km · 1.650m D+</p>
        <p className="font-mono text-[8px] text-neutral-400 sm:text-[10px]">Martes 28 de julio</p>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5 sm:mt-3 sm:gap-2">
        {telemetryStats.map((stat) => (
          <div key={stat.label} className="rounded bg-[#FDFCF9] p-1.5 text-center sm:p-2">
            <p className="truncate font-mono text-[7px] font-semibold tracking-wide text-neutral-500 uppercase sm:text-[9px]">
              {stat.label}
            </p>
            <p className="font-mono text-[11px] font-bold text-neutral-900 sm:text-sm">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-2 rounded-lg border border-terracotta/30 bg-terracotta/5 p-2 sm:mt-3 sm:p-3">
        <p className="font-mono text-[7px] font-bold tracking-wide text-terracotta uppercase sm:text-[9px]">
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
          750 ml/h + 850 mg Sodio
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
      <h1 className="mb-4 max-w-lg px-4 text-center font-mono text-xl font-bold tracking-tight text-neutral-900 uppercase sm:mb-6 sm:text-3xl">
        Nutrición de precisión para ciclistas
      </h1>

      <ul className="my-3 w-full max-w-70 space-y-1.5 text-left font-mono text-[11px] text-neutral-800 sm:my-4 sm:max-w-xs sm:space-y-2 sm:text-xs">
        {benefits.map((benefit) => (
          <li key={benefit} className="flex items-start gap-2">
            <span className="font-bold text-terracotta">&#10003;</span>
            {benefit}
          </li>
        ))}
      </ul>

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

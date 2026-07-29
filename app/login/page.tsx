import { TriangleAlert } from "lucide-react";
import Link from "next/link";

import { AppLogo } from "@/components/app-logo";
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
 * Full-bleed background — the real `public/login-bg.mp4` loop (replacing an
 * earlier CSS-gradient placeholder built while no real asset existed yet).
 * `autoPlay`/`muted`/`playsInline` together are what actually let this
 * autoplay on mobile Safari/Chrome — any one missing and the browser blocks
 * autoplay outright. A flat `bg-black/20` tint sits on top for contrast; the
 * floating card itself (mobile) already has its own `backdrop-blur-md`, so
 * this overlay stays a plain tint rather than also blurring, which would
 * double up with the card's own blur right behind it.
 */
function BackgroundMedia() {
  return (
    <div className="absolute inset-0 lg:static lg:h-full lg:w-1/2 lg:shrink-0">
      <video
        autoPlay
        loop
        muted
        playsInline
        className="h-full w-full object-cover"
        aria-hidden="true"
      >
        <source src="/login-bg.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-black/20" aria-hidden="true" />
    </div>
  );
}

/**
 * "Tarjeta Técnica" — a real mockup of the app's own visual language (the
 * Post-Ride telemetry card's badge/stat-grid pattern, the Fueling Planner's
 * terracotta-accented recommendation block), not an abstract illustration.
 * Deliberately 100% typographic — no icons, no emoji, not even a colored-dot
 * "synced" indicator — every visual cue here is text weight/color/borders
 * only. The one deliberate exception on this whole page is the Strava
 * icomark on the CTA button below — Strava's API Agreement requires it for
 * brand identification (see "Strava API compliance" in CLAUDE.md).
 *
 * Every figure here is illustrative/static (a real route name, a plausible
 * NP/glycogen/sweat-rate/carb-target set of numbers) — this card exists
 * purely to preview the *shape* of a real result, not to claim it's live
 * data, so nothing here needs a network round-trip or Strava connection.
 */
function DashboardPreviewCard() {
  return (
    <div className="my-2 rounded-lg border border-neutral-300/90 bg-white p-3.5 text-left shadow-none sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded border border-emerald-200/80 bg-emerald-50 px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider text-emerald-800 uppercase">
          Strava Synced
        </span>
        <span className="font-mono text-[9px] text-neutral-400">28 JUL · 27°C</span>
      </div>

      <div className="mt-1.5">
        <p className="truncate font-mono text-[11px] font-bold text-neutral-900 sm:text-sm">
          Puig Major &amp; Sa Calobra
        </p>
        <p className="font-mono text-[9px] text-neutral-500 sm:text-xs">84.5 km · 1.650m D+</p>
      </div>

      <div className="my-2.5 grid grid-cols-3 divide-x divide-neutral-200 rounded-md border border-neutral-200/60 bg-[#FBF9F5] py-2 text-center">
        {telemetryStats.map((stat) => (
          <div key={stat.label}>
            <p className="truncate font-mono text-[7px] font-semibold tracking-wide text-neutral-500 uppercase sm:text-[9px]">
              {stat.label}
            </p>
            <p className="font-mono text-[11px] font-bold text-neutral-900 sm:text-sm">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="my-1.5 rounded-r-md border-y border-r border-l-2 border-neutral-200/80 border-l-[#D9532F] bg-[#F9F7F2] p-2.5">
        <span className="mb-0.5 block font-mono text-[9px] font-bold tracking-wider text-neutral-500 uppercase">
          Pauta de ingesta recomendada
        </span>
        <p className="flex flex-wrap items-baseline gap-x-1.5 font-mono text-neutral-900">
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
    <div className="relative h-dvh w-full overflow-hidden lg:flex lg:flex-row">
      <BackgroundMedia />

      {/* Brand mark — a translucent white chip rather than plain text/logo
          directly on the image, since `AppLogo`'s fills are fixed (not
          `currentColor`) and would otherwise be unreadable against a dark
          photo/gradient background. */}
      <div className="absolute top-4 left-4 z-20 lg:top-8 lg:left-8">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 shadow-sm backdrop-blur-sm">
          <AppLogo className="size-4 shrink-0" />
          <span className="font-mono text-[11px] font-bold tracking-wider text-neutral-900 uppercase">
            Motor Metabólico
          </span>
        </div>
      </div>

      <div className="relative z-10 flex h-full w-full items-center justify-center overflow-y-auto px-4 py-6 lg:w-1/2 lg:shrink-0 lg:bg-[#FDFCF9] lg:px-10">
        <div className="my-auto w-full max-w-md rounded-xl border border-neutral-200/80 bg-white/95 p-5 text-center shadow-2xl backdrop-blur-md lg:max-w-sm lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
          <h1 className="mb-1 font-mono text-xl font-bold tracking-tight text-neutral-900 uppercase sm:text-2xl">
            Nutrición de precisión para ciclistas
          </h1>

          <div className="mb-3 flex flex-wrap justify-center gap-1.5">
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
            <div className="mx-auto mb-2 flex w-full items-center gap-2 border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-left text-xs text-status-warning sm:mb-3 sm:px-4 sm:py-3 sm:text-sm">
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
        </div>
      </div>
    </div>
  );
}

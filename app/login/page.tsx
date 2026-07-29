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
 *
 * `fixed` (not `absolute`) + explicit `h-dvh`/`min-h-screen` on mobile —
 * an `absolute inset-0` wrapper sizes against its *containing block*, and on
 * iOS Safari that measurement doesn't reliably keep up with the toolbar's
 * own collapse/expand animation, leaving a black strip at the very bottom
 * once the toolbar settled into its collapsed state (reported live on a
 * real device). `fixed` positions against the true viewport directly
 * instead, which is what `AuthPageShell`'s own `h-dvh` root already relies
 * on for the exact same class of iOS-Safari-chrome-resize bug (see
 * "Root-level scroll lock" in CLAUDE.md) — `min-h-screen` is added as a
 * belt-and-suspenders floor under `h-dvh` and is harmless on a `fixed`
 * element even if it computes taller than the current visual viewport,
 * since a `fixed`, `overflow-hidden` box simply clips to whatever's
 * currently visible rather than affecting page scroll.
 *
 * At `lg:` the wrapper switches to `lg:relative` (not `lg:static`) — still a
 * normal in-flow flex column exactly like `lg:static` would give, but
 * `position: relative` additionally makes this wrapper the containing block
 * for the `bg-black/20` overlay's `absolute inset-0` below, so that overlay
 * stays scoped to this column rather than resolving against the root's own
 * `relative` and bleeding across the whole page. `lg:flex lg:items-center
 * lg:justify-center` centers the video, which matters once the video itself
 * switches to `lg:object-contain` (see below) and can render narrower than
 * its box.
 *
 * The source clip is a 9:16 vertical recording — `object-cover` (mobile)
 * correctly fills the full-bleed portrait background, but the same crop
 * applied to the landscape `lg:w-1/2` desktop column zoomed in hard on the
 * footage, cropping most of the frame. `lg:object-contain` shows the whole
 * frame uncropped and unscaled-past-native-resolution instead, letterboxed
 * against the column's own `bg-neutral-950` (a video element's own
 * unfilled `object-contain` gutter is transparent, so the parent's
 * background is what actually shows through there).
 */
function BackgroundMedia() {
  return (
    <div className="fixed inset-0 z-0 h-dvh min-h-screen w-full overflow-hidden bg-neutral-950 lg:relative lg:z-auto lg:flex lg:h-full lg:min-h-0 lg:w-1/2 lg:shrink-0 lg:items-center lg:justify-center">
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className="h-full w-full object-cover opacity-90 transition-opacity duration-500 lg:object-contain"
        aria-hidden="true"
      >
        <source src="/login-bg.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-black/20" aria-hidden="true" />
    </div>
  );
}

/**
 * Fixed, full-width, top-center brand masthead — PNS's own convention: the
 * wordmark floats over the page rather than living inside the card, and
 * stays put while the card's content column scrolls beneath it. The outer
 * bar is `pointer-events-none` full-width so its empty space never blocks
 * clicks/scroll to whatever's underneath; only the pill itself is
 * `pointer-events-auto`. The pill keeps the translucent `bg-white/90
 * backdrop-blur-md` treatment (not plain text) since `AppLogo`'s fills are
 * hardcoded, not `currentColor` (see its own doc comment) — over the video
 * on mobile especially, the white pill is what guarantees contrast
 * regardless of whatever's playing behind it.
 */
function BrandMasthead() {
  return (
    <div className="pointer-events-none fixed top-0 right-0 left-0 z-50 flex items-center justify-center px-6 py-4">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-neutral-200/80 bg-white/90 px-4 py-1.5 shadow-sm backdrop-blur-md">
        <AppLogo className="h-5 w-5 shrink-0" />
        <span className="font-mono text-xs font-bold tracking-[0.25em] text-neutral-900 uppercase sm:text-sm">
          Motor Metabólico
        </span>
      </div>
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
 * The one genuinely live value is the date pill, computed at request time
 * (`LoginPage` is a Server Component, `dynamic = "force-dynamic"` already
 * set) via `Intl`/`toLocaleDateString` rather than hardcoded — a static date
 * would read as stale the day after it was written.
 */
function DashboardPreviewCard() {
  const dateLabel = new Date()
    .toLocaleDateString("es-ES", { day: "numeric", month: "short" })
    .toUpperCase();

  return (
    <div className="my-2 rounded-md border border-neutral-300/80 bg-white p-4 text-left shadow-none sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-sm border border-emerald-200/80 bg-emerald-50 px-2 py-0.5 font-mono text-[9px] font-bold tracking-widest text-emerald-800 uppercase">
          Strava Synced
        </span>
        <span className="font-mono text-[9px] text-neutral-400">{dateLabel} · 27°C</span>
      </div>

      <div className="mt-1.5">
        <p className="truncate font-mono text-[11px] font-bold text-neutral-900 sm:text-sm">
          Sa Calobra — Coll dels Reis
        </p>
        <p className="font-mono text-[9px] text-neutral-500 sm:text-xs">9.5 km · 670m D+ · 7% avg</p>
      </div>

      <div className="my-3 grid grid-cols-3 divide-x divide-neutral-200 rounded-sm border border-neutral-200 bg-[#FAF9F5] py-2.5 text-center">
        {telemetryStats.map((stat) => (
          <div key={stat.label}>
            <p className="truncate font-mono text-[7px] font-semibold tracking-wide text-neutral-500 uppercase sm:text-[9px]">
              {stat.label}
            </p>
            <p className="font-mono text-[11px] font-bold text-neutral-900 sm:text-sm">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="my-2 rounded-r-sm border-y border-r border-l-2 border-neutral-200/80 border-l-[#D9532F] bg-[#F7F5F0] p-3">
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
    <div className="relative h-dvh w-full overflow-hidden bg-neutral-950 lg:flex lg:flex-row">
      <BackgroundMedia />
      <BrandMasthead />

      <div className="relative z-10 flex min-h-dvh w-full flex-col items-center justify-center overflow-y-auto px-4 py-6 lg:h-full lg:min-h-0 lg:w-1/2 lg:shrink-0 lg:bg-[#FDFCF9] lg:px-10">
        <div className="my-auto w-full max-w-md rounded-xl border border-neutral-200/80 bg-white/95 p-5 pt-16 text-center shadow-2xl backdrop-blur-md lg:max-w-sm lg:border-0 lg:bg-transparent lg:p-0 lg:pt-16 lg:shadow-none lg:backdrop-blur-none">
          <h1 className="my-2 text-center font-mono text-base font-bold tracking-tight text-neutral-800 uppercase sm:text-lg">
            Nutrición de precisión para ciclistas
          </h1>

          <p className="my-3 block text-center font-mono text-[10px] font-bold tracking-widest text-neutral-500 uppercase sm:text-xs">
            {headerPills.join("  •  ")}
          </p>

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

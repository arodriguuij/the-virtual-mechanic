import { TriangleAlert } from "lucide-react";
import Link from "next/link";

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
 * Full-bleed background — the real `public/login-bg.mp4` loop. `autoPlay`/
 * `muted`/`playsInline` together are what actually let this autoplay on
 * mobile Safari/Chrome — any one missing and the browser blocks autoplay
 * outright. `object-cover` at every breakpoint (not `lg:object-contain`, a
 * prior iteration's approach) — that letterboxed the 9:16 clip against the
 * desktop column's dark background to avoid cropping, but the brief here
 * explicitly wants the column filled edge-to-edge with zero visible bars,
 * accepting the crop instead. A flat `bg-black/20` tint sits on top for
 * contrast against whatever text overlays it.
 *
 * `fixed` (not `absolute`) + explicit `h-dvh`/`min-h-screen` on mobile — an
 * `absolute inset-0` wrapper sizes against its *containing block*, and on
 * iOS Safari that measurement doesn't reliably keep up with the toolbar's
 * own collapse/expand animation, leaving a black/white strip at the very
 * bottom once the toolbar settles into its collapsed state. `fixed`
 * positions against the true viewport directly instead, the same mechanism
 * `AuthPageShell`'s own `h-dvh` root already relies on for this exact class
 * of iOS-chrome-resize bug (see "Root-level scroll lock" in CLAUDE.md).
 * `min-h-screen` is a harmless belt-and-suspenders floor under `h-dvh`.
 *
 * At `lg:` this becomes a normal in-flow grid column (`lg:relative`, taking
 * the grid's first implicit column) rather than a fixed overlay — `relative`
 * rather than `static` specifically so it stays the containing block for
 * the `bg-black/20` overlay's `absolute inset-0` below, keeping that tint
 * scoped to this column instead of resolving against the page root and
 * bleeding across the whole split screen.
 */
function BackgroundMedia() {
  return (
    <div className="fixed inset-0 z-0 h-dvh min-h-screen w-full overflow-hidden bg-neutral-950 lg:relative lg:z-auto lg:h-full lg:min-h-dvh lg:w-full">
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 h-full w-full object-cover opacity-90"
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
 * NP/glycogen/sweat-rate/carb-target set of numbers, a "HOY" date pill
 * rather than a real computed date) — this card exists purely to preview
 * the *shape* of a real result, not to claim it's live data, so nothing
 * here needs a network round-trip, Strava connection, or server-side clock.
 */
function DashboardPreviewCard() {
  return (
    <div className="mb-6 rounded-md border border-neutral-300/80 bg-white p-4 text-left shadow-none">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-sm border border-emerald-200/80 bg-emerald-50 px-2 py-0.5 font-mono text-[9px] font-bold tracking-widest text-emerald-800 uppercase">
          Strava Synced
        </span>
        <span className="font-mono text-[9px] text-neutral-400">HOY · 27°C</span>
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

      <div className="rounded-r-sm border-y border-r border-l-2 border-neutral-200/80 border-l-[#D9532F] bg-[#F7F5F0] p-3">
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
    <div className="relative grid min-h-dvh w-full grid-cols-1 bg-neutral-950 lg:grid-cols-2 lg:bg-[#FDFCF9]">
      <BackgroundMedia />

      {/* Content column — no floating card, no shadow, no rounded container.
          On mobile this is a translucent layer sitting directly over the
          fixed video (the "única capa translúcida limpia" the design calls
          for); at `lg:` it becomes the solid-cream right half of the split
          screen, since the column's own background already provides all
          the contrast a translucent layer exists for on mobile.

          `bg-white/60` with no `backdrop-blur` — tuned live against the real
          clip, not guessed. `/85` fully fogged the video out (looked like a
          flat gray page with no motion visible at all); `/45` let the video
          through clearly but left the small spec line under-contrast at
          narrow widths (320px), where it wraps onto a busier stretch of
          frame. `/60` is the middle ground: the clip stays clearly
          recognizable (verified via screenshot) while text stays legible.
          No `backdrop-blur` deliberately — blurring the video underneath
          read as "foggy," not "PNS," even at lower opacity values. */}
      <div className="relative z-10 flex min-h-dvh w-full flex-col justify-between bg-white/60 px-6 py-8 text-left sm:px-8 sm:py-12 lg:h-full lg:min-h-dvh lg:bg-[#FDFCF9] lg:p-12">
        <div className="flex flex-col">
          <span className="mb-6 block font-mono text-xs font-bold tracking-[0.3em] text-neutral-900 uppercase sm:text-sm">
            Motor Metabólico
          </span>

          <h1 className="mb-2 font-mono text-base font-bold tracking-tight text-neutral-900 uppercase sm:text-xl">
            Nutrición de precisión para ciclistas
          </h1>

          <p className="mb-6 font-mono text-[10px] font-bold tracking-widest text-neutral-500 uppercase sm:text-xs">
            {headerPills.join(" • ")}
          </p>

          <DashboardPreviewCard />

          {error && (
            <div className="mb-6 flex w-full items-center gap-2 border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-left text-xs text-status-warning sm:px-4 sm:py-3 sm:text-sm">
              <TriangleAlert className="size-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <StravaLoginButton />

          <p className="text-left font-mono text-[10px] text-neutral-500 sm:text-[11px]">
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

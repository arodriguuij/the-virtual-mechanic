import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { memo, type ReactNode } from "react";

import { RatioLogo } from "@/components/icons/RatioLogo";
import { cn } from "@/lib/utils";

const headerTagline = "Estrategia de avituallamiento pre y post-ruta adaptada a tus vatios reales.";

// `accent` marks the two labels the "Rediseño Integral" pass singled out
// for the Taupe Táctico (`#70685b`) treatment — the same accent every
// active selector/badge in the app already uses — leaving the third
// (Tasa de sudor) on the neutral tone every other stat label already had.
const telemetryStats = [
  { label: "Potencia NP", value: "228 W", accent: true },
  { label: "Deuda glucógeno", value: "195 g", accent: true },
  { label: "Tasa de sudor", value: "1.2 L/h", accent: false },
];

// The 4-box "Pauta de ingesta" micro-grid, matching Card 03's own
// stat-tile pattern (`bg-[#F6F5F0]` porcelain fill, bold `zinc-900` figure)
// — replaces the old single "85 g/h · 750 ml/h · 850 mg Sodio" line with
// one box per figure, plus the post-ride target as its own 4th box.
const nutritionMicroGrid = [
  { label: "Carbohidratos", value: "85 g/h" },
  { label: "Hidratación", value: "750 ml/h" },
  { label: "Sodio", value: "850 mg/h" },
  { label: "Post-Ruta", value: "65g HC · 30g PRO" },
];

/**
 * Full-bleed background — the real `public/login-bg.mp4` loop. `autoPlay`/
 * `muted`/`playsInline` together are what actually let this autoplay on
 * mobile Safari/Chrome — any one missing and the browser blocks autoplay
 * outright. `object-cover` at every breakpoint — the column is filled
 * edge-to-edge with zero visible bars, accepting the crop on the 9:16 clip
 * instead of letterboxing it. Mobile sits at a slightly lower `opacity-80`
 * since the elevated white card above it (see `LoginHeroLayout` below) needs
 * the video dimmed just enough to stay a clearly secondary layer; the
 * desktop split screen's video *is* the entire left column with no card
 * competing against it, so it runs brighter at `lg:opacity-90`.
 *
 * `fixed` (not `absolute`) + explicit `h-dvh`/`min-h-screen` on mobile — an
 * `absolute inset-0` wrapper sizes against its *containing block*, and on
 * iOS Safari that measurement doesn't reliably keep up with the toolbar's
 * own collapse/expand animation, leaving a black/white strip at the very
 * bottom once the toolbar settles into its collapsed state. `fixed`
 * positions against the true viewport directly instead.
 *
 * At `lg:` this becomes a normal in-flow grid column (`lg:relative`, taking
 * the grid's first implicit column) rather than a fixed overlay — `relative`
 * rather than `static` specifically so it stays the containing block for
 * the `bg-black/20` overlay's `absolute inset-0` below, keeping that tint
 * scoped to this column instead of resolving against the page root and
 * bleeding across the whole split screen.
 *
 * Wrapped in `memo` and takes zero props — a guardrail against ever clicking
 * "Conectar con Strava" restarting the loop from frame 0. Verified via a real
 * click (with the actual OAuth navigation blocked so the page stays mounted):
 * the video's own DOM node identity and `currentTime` are both untouched by
 * `StravaLoginButton`'s `setConnecting(true)` call — this component and the
 * CTA button already sit in fully independent parts of the tree (this file
 * has no `"use client"` directive at all, so its output is server-rendered,
 * static HTML that React never re-renders on the client; `StravaLoginButton`
 * is the one Client Component here, and a Client Component's own state
 * update only ever re-renders that component's own subtree, never a sibling
 * passed in through a parent's `cta` prop). `memo` costs nothing given that,
 * but makes the "must never re-render alongside the CTA" contract explicit
 * rather than implicit in the file structure, in case a future edit ever
 * moves this component somewhere that isn't naturally isolated. The one
 * thing that *does* stop this video is the real, unavoidable browser
 * navigation away from `/login` once the OAuth redirect actually completes —
 * that's the same tab leaving for Strava's own domain, not a bug.
 */
const BackgroundMedia = memo(function BackgroundMedia() {
  return (
    <div className="fixed inset-0 z-0 h-dvh min-h-screen w-full overflow-hidden bg-neutral-950 lg:relative lg:z-auto lg:h-full lg:min-h-dvh lg:w-full">
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 h-full w-full object-cover opacity-80 lg:opacity-90"
        aria-hidden="true"
      >
        <source src="/login-bg.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-black/20" aria-hidden="true" />
    </div>
  );
});

/**
 * Brand mark — plain icon + wordmark in flow, no pill/capsule. Sits as the
 * first child inside the centered card (mobile) / centered column (desktop)
 * rather than a separate global overlay.
 */
function BrandMark() {
  return (
    <div className="flex items-center justify-center gap-3">
      <RatioLogo className="size-6 text-terracotta sm:size-8" />
      <span className="font-mono text-sm font-bold tracking-[0.35em] whitespace-nowrap text-neutral-900 uppercase sm:text-base">
        RATIO
      </span>
    </div>
  );
}

/**
 * Shared PNS-style frame for every unauthenticated screen that needs the
 * full-bleed video + "mobile elevated card / desktop borderless split"
 * layout — `/login` (`app/login/page.tsx`) and the Strava OAuth transition
 * at `/auth/callback` (`app/auth/callback/page.tsx`) render the *exact*
 * same background, brand mark, hero copy, and illustrative telemetry
 * readout. The only thing that ever differs between the two screens is the
 * CTA slot — a real "Conectar con Strava" button vs. a disabled
 * "Conectando..." state — so that's the one thing this component takes as a
 * prop rather than baking in a fixed button. Extracting this once both
 * screens need genuinely *identical* markup means a future layout change to
 * either can't accidentally drift the two apart the way two independent
 * copies could.
 *
 * Plain component — no `"use client"`, no server-only APIs — safe to import
 * from `/login`'s async Server Component or `/auth/callback`'s Client
 * Component alike.
 */
export function LoginHeroLayout({ cta, error }: { cta: ReactNode; error?: string | null }) {
  return (
    <div className="relative grid min-h-dvh w-full grid-cols-1 bg-neutral-950 lg:grid-cols-2 lg:bg-white">
      <BackgroundMedia />

      {/* Mobile (< lg) keeps the elevated white contrast card over the
          moving video — the "Rediseño Integral" pass reinstated a real
          border + `shadow-xl` + `rounded-2xl` here (explicitly requested,
          reversing a run of earlier "no hard edges" passes documented in
          this file's own history), so the card now reads as a genuine
          floating panel rather than a blur-only tint. Desktop (>= lg) still
          drops every bit of card chrome (`lg:rounded-none lg:border-0
          lg:bg-transparent lg:p-0 lg:shadow-none`) — the right column *is*
          already a clean white field with no video behind it to contrast
          against, so a border/shadow there would just outline empty space;
          the content sits directly on that column's own background,
          spaced by `lg:px-12 lg:py-16` alone. */}
      <div className="relative z-10 flex min-h-dvh w-full items-center justify-center overflow-hidden p-3 sm:p-4 lg:p-12">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200/80 bg-white/95 p-6 text-center shadow-xl backdrop-blur-md sm:p-8 lg:max-w-lg lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:px-12 lg:py-16 lg:backdrop-blur-none">
          {/* Three explicit sections (branding, physiological preview,
              auth action) rather than one flat stack — `gap-4 sm:gap-6`
              between them is the *only* separation mechanism (no per-block
              `mb-*`/`mt-*`), and grouping into 3 top-level children instead
              of 5 actually keeps the total gap budget roughly flat versus
              the previous tighter-but-more-numerous gaps, so this doesn't
              reopen the mobile-scroll issue fixed earlier (verified below).
              Section 2's own internal spacing is untouched. */}
          <div className="flex flex-col gap-4 sm:gap-6">
            {/* SECTION 1 — Branding & Header. The gap below `BrandMark` is
                deliberately much larger than every other gap on this screen
                (`gap-8 sm:gap-10`, vs. the `gap-4 sm:gap-6` separating the 3
                top-level sections themselves) — "RATIO" reads as this
                screen's own app-level header, not just the first line of
                the hero copy, so it needs to visually detach from the title
                block beneath it rather than sitting at the same rhythm as
                everything else. */}
            <div className="flex flex-col items-center gap-8 sm:gap-10">
              <BrandMark />

              <div>
                <h1 className="mb-1 font-mono text-base leading-snug font-bold tracking-tight text-neutral-900 uppercase sm:text-xl">
                  Nutrición de precisión para ciclistas
                </h1>

                <p className="block font-mono text-xs leading-snug text-neutral-500 normal-case sm:text-sm">
                  {headerTagline}
                </p>
              </div>
            </div>

            {/* SECTION 2 — Vista previa fisiológica: a real mockup of the
                app's own visual language (the Post-Ride telemetry card's
                stat-grid pattern, the Fueling Planner's terracotta-accented
                recommendation block). The 3 sub-blocks (route header, stat
                row, ingesta block) are separated by thin `divide-y
                divide-zinc-200/80` rules, each with generous `py-4 sm:py-5`
                padding so text never sits flush against a line. A
                continuous `border-l-2 border-terracotta` runs down the
                *outside* of the whole group (not on any one sub-block) —
                one elegant accent marking this entire data section as a
                single unit, rather than the left-accent bar an earlier
                design put on just the ingesta block alone. 100%
                typographic — no icons, no emoji — and every figure here is
                illustrative/static. */}
            <div className="w-full divide-y divide-zinc-200/80 border-l-2 border-terracotta pl-4 text-left sm:pl-5">
              <div className="py-4 sm:py-5">
                <p className="truncate font-mono text-xs font-bold text-neutral-900 sm:text-sm">
                  Sa Calobra – Coll dels Reis
                </p>
                <p className="font-mono text-[10px] text-neutral-500 sm:text-xs">
                  9.5 km · 670m D+ · 7% avg
                </p>

                {/* Mini map preview — a dimmed, illustrative "base map" (no
                    real tiles/Leaflet here, this screen renders before any
                    auth exists and has zero client-side data of its own)
                    with the Sa Calobra route traced in the app's own Taupe
                    Táctico accent, matching the real route-map treatment
                    every authenticated screen uses (`RouteMapPreview`). */}
                <div className="relative mt-3 mb-4 h-32 w-full overflow-hidden rounded-xl border border-zinc-200/80 shadow-xs">
                  <div className="absolute inset-0 bg-[#EDEBE4]" aria-hidden="true" />
                  <svg
                    viewBox="0 0 300 130"
                    preserveAspectRatio="none"
                    className="absolute inset-0 h-full w-full"
                    aria-hidden="true"
                  >
                    <path
                      d="M12,112 C45,100 55,58 82,54 C112,50 118,92 150,86 C182,80 188,38 222,34 C248,30 262,18 288,14"
                      fill="none"
                      stroke="#70685b"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="absolute top-2 left-2 rounded-md bg-white/90 px-2.5 py-1 font-mono text-[10px] font-bold text-zinc-700 uppercase backdrop-blur-md">
                    Ejemplo · Sa Calobra
                  </span>
                </div>

                <span className="inline-flex items-center rounded-md border border-amber-200/80 bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-medium text-amber-900">
                  27°C · CALOR ALTO
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 py-4 text-center sm:gap-6 sm:py-5">
                {telemetryStats.map((stat) => (
                  <div key={stat.label}>
                    <p
                      className={cn(
                        "truncate font-mono text-[9px] uppercase sm:text-[10px]",
                        stat.accent ? "text-[#70685b]" : "text-neutral-400"
                      )}
                    >
                      {stat.label}
                    </p>
                    <p className="font-mono text-xs font-bold text-neutral-800 sm:text-sm">
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="py-4 sm:py-5">
                <span className="mb-2 block font-mono text-[9px] font-bold tracking-wider text-[#70685b] uppercase sm:text-[10px]">
                  Pauta de ingesta (tolerancia media)
                </span>

                {/* Micro-grid de telemetría nutricional — Card 03's own
                    stat-tile pattern (porcelain `#F6F5F0` fill, bold
                    `zinc-900` figure), one box per figure instead of a
                    single run-on line. */}
                <div className="grid grid-cols-2 gap-2">
                  {nutritionMicroGrid.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-xl border border-zinc-200/80 bg-[#F6F5F0] p-3 shadow-xs"
                    >
                      <p className="font-mono text-[9px] tracking-wider text-neutral-400 uppercase sm:text-[10px]">
                        {item.label}
                      </p>
                      <p className="mt-0.5 font-mono text-xs font-bold text-zinc-900 sm:text-sm">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* SECTION 3 — Acción / Autenticación. The error banner (an
                auth failure surfaced via `?strava_error=`) lives here too,
                not as its own top-level section — it's part of this same
                auth-flow concern, not a fourth structural block. */}
            <div className="flex flex-col gap-2">
              {error && (
                <div className="flex w-full items-center gap-2 border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-left text-xs text-status-warning sm:px-4 sm:py-3 sm:text-sm">
                  <TriangleAlert className="size-4 shrink-0" />
                  {error}
                </div>
              )}

              {cta}

              {/* A single condensed line replaces the previous 4-line
                  OAuth/data-use/privacy paragraph — still links to
                  `/privacidad` (Strava's API Agreement requires the privacy
                  policy be reachable from here, see "Strava API compliance"
                  in CLAUDE.md), just no longer spelling out every clause
                  inline on a screen that needs to fit in one mobile
                  viewport. */}
              <p className="mt-2 block text-center font-mono text-[9px] leading-tight text-neutral-400">
                Conexión segura vía OAuth con Strava ·{" "}
                <Link href="/privacidad" className="underline underline-offset-2 hover:text-neutral-600">
                  Política de Privacidad
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

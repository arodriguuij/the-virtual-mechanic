/**
 * Shared button/field/badge classes — the app's design-system baseline.
 * Every hand-rolled `<button>`/`<input>`/`<select>` across the Dashboard,
 * Pre-Ride planner, Post-Ride analysis, and Physiological Profile form
 * imports from here instead of defining its own local class string, so
 * "every button/input shares the same radius/padding/style" is a real
 * shared constant, not just visually-similar independent definitions.
 * Plain strings (not a component) since every call site already composes
 * them with `cn()` for its own state-dependent classes (disabled, active,
 * etc.) — a component wrapper would need to re-expose every one of those
 * as props for no real benefit over the existing convention.
 */

/** The one accent color for every primary action button — CALCULAR
 * ESTRATEGIA, ANALIZAR, GUARDAR. `min-h-11` (44px) keeps every button a
 * comfortable thumb target on mobile regardless of its own padding/text
 * size. */
export const primaryButtonClass =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-terracotta bg-terracotta px-4 py-2.5 font-mono text-xs font-semibold tracking-wider text-white uppercase shadow-sm transition-all duration-150 hover:bg-terracotta-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-terracotta";

/** The unselected/outline counterpart — secondary actions (Copiar receta,
 * Descargar GPX, Sincronizar). */
export const secondaryButtonClass =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 font-mono text-xs font-medium tracking-wider text-neutral-700 uppercase transition-all duration-150 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50";

/** Every plain `<input>`/`<select>` — profile form fields, quick-mode
 * duration/watts, GPX duration override. White by default (not `bg-surface`,
 * which is reserved for genuinely read-only/calculated containers — see
 * that token's own comment in `app/globals.css`) so an editable field never
 * reads as disabled/read-only next to the surrounding beige page chrome; a
 * visible `border-neutral-300` (darker than the old `neutral-200`) plus
 * `shadow-sm` is what gives it definition against a white card instead.
 * `min-h-11` (44px) matches the shared button/segmented-control touch
 * target. */
export const fieldClass =
  "min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2.5 text-sm font-sans text-neutral-900 shadow-sm transition-all duration-150 hover:border-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900";

/** Same field treatment plus a pointer cursor — `<select>`s and date/time
 * inputs are "pick one" controls, unlike a free-typed number field sharing
 * `fieldClass` alone. */
export const selectableFieldClass = `${fieldClass} cursor-pointer`;

/** A small data-pill — weather readouts, Gut Training level, and other
 * short label+value chips that read as a distinct "tag" rather than a
 * full stat block. */
export const badgeClass =
  "inline-flex items-center gap-1 rounded-md border border-badge-border bg-badge px-2.5 py-1 font-mono text-badge-foreground";

/**
 * Technical button row — a Pas Normal Studios-style editorial replacement
 * for the app's earlier Apple/Fuelin-style tinted "pill toggle" segmented
 * control (a `bg-[#EAE7DF]` rounded track holding equal-weight buttons).
 * That tinted track read as too soft/consumer-app for this app's sober,
 * technical identity — this is a transparent row of independent bordered
 * buttons instead, each its own discrete control rather than a shared
 * pill lifting off a common background. Used for every exclusive choice
 * with a handful of options: fueling mode, route/quick/GPX mode, departure
 * day, ride intensity, sweat rate, bottle count/capacity. `flex-wrap` on
 * the container lets a longer option set (ride intensity, 5 options) wrap
 * to a second row on a narrow phone instead of cramming/truncating.
 */
export const segmentedControlClass = "flex w-full flex-wrap gap-2";
export const segmentedControlButtonClass =
  "min-h-11 flex-1 cursor-pointer rounded-md border border-neutral-300 bg-white px-3.5 py-2 font-mono text-xs font-semibold text-neutral-700 transition-colors duration-150 hover:border-neutral-900";
export const segmentedControlButtonActiveClass =
  "border-neutral-900 bg-neutral-900 font-bold text-white shadow-none hover:border-neutral-900";
/** Same active look as `segmentedControlButtonActiveClass`, expressed as
 * `has-checked:` variants for a segmented control built from plain radio
 * `<label>`s (an `sr-only` native `<input type="radio">` inside each label)
 * rather than client-state `<button>`s — used on Server Component forms with
 * no JS (Physiological Profile's sweat rate/bottle count/capacity) where the
 * "active" pill still has to be a real, submittable form control. */
export const segmentedControlButtonActiveHasCheckedClass =
  "flex items-center justify-center text-center has-checked:border-neutral-900 has-checked:bg-neutral-900 has-checked:font-bold has-checked:text-white has-checked:shadow-none";

/**
 * Multi-card selector (Fenotipo metabólico, Gut Training level) — every
 * card stays `bg-white` regardless of state; only the border/shadow and a
 * small terracotta corner dot mark the active one, rather than a tinted
 * background, so the "selected" signal reads as a clean UI state rather
 * than a colored block. `relative` is required on the card for the dot's
 * `absolute` positioning to anchor correctly.
 */
export const selectionCardClass =
  "relative rounded-xl border border-neutral-200/80 bg-white p-4 transition-all duration-150 hover:border-neutral-300";
export const selectionCardActiveClass = "border-2 border-terracotta shadow-md";
export const selectionCardDotClass = "absolute right-3 top-3 size-2.5 rounded-full bg-terracotta";

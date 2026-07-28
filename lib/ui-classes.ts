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

/** The one accent color for every primary action button, active tab, and
 * active segmented-control pill — CALCULAR ESTRATEGIA, ANALIZAR, GUARDAR,
 * Pre-Ride/Post-Ride's active tab, ÓPTIMO/RUTA STRAVA's selected pill. */
export const primaryButtonClass =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-terracotta bg-terracotta px-4 py-2.5 font-mono text-xs font-semibold tracking-wider text-white uppercase shadow-sm transition-all duration-150 hover:bg-terracotta-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-terracotta";

/** The unselected/outline counterpart — inactive segmented-control pills,
 * secondary actions. */
export const secondaryButtonClass =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 font-mono text-xs font-medium tracking-wider text-neutral-700 uppercase transition-all duration-150 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50";

/** Every plain `<input>`/`<select>` — profile form fields, quick-mode
 * duration/watts, GPX duration override. White by default (not `bg-surface`,
 * which is reserved for genuinely read-only/calculated containers — see
 * that token's own comment in `app/globals.css`) so an editable field never
 * reads as disabled/read-only next to the surrounding beige page chrome; a
 * visible `border-neutral-300` (darker than the old `neutral-200`) plus
 * `shadow-sm` is what gives it definition against a white card instead. */
export const fieldClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2.5 text-sm font-sans text-neutral-900 shadow-sm transition-all duration-150 hover:border-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900";

/** Same field treatment plus a pointer cursor — `<select>`s and the
 * `datetime-local` inputs are "pick one" controls, unlike a free-typed
 * number field sharing `fieldClass` alone. */
export const selectableFieldClass = `${fieldClass} cursor-pointer`;

/** A small data-pill — weather readouts, Gut Training level, and other
 * short label+value chips that read as a distinct "tag" rather than a
 * full stat block. */
export const badgeClass =
  "inline-flex items-center gap-1 rounded-md border border-badge-border bg-badge px-2.5 py-1 font-mono text-badge-foreground";

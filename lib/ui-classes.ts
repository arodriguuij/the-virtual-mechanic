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
 * Pre-Ride/Post-Ride's active tab, ÓPTIMO/RUTA STRAVA's selected pill. No
 * border — this app's 100%-frameless pass dropped the `border-terracotta`
 * this used to carry (redundant anyway against a solid `bg-terracotta`
 * fill); the solid fill alone is what differentiates it now. */
export const primaryButtonClass =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-sm bg-terracotta px-4 py-2.5 font-mono text-xs font-semibold tracking-wider text-white uppercase shadow-sm transition-all duration-150 hover:bg-terracotta-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-terracotta";

/** The secondary-action treatment — Copiar Receta, Descargar GPX,
 * Sincronizar, Recargar rutas. A muted `--terracotta`-tinted pill on the
 * resting `--surface` tone, filling solid on hover — replacing an earlier
 * plain `border-neutral-200 bg-white text-neutral-700` treatment that read as
 * a generic gray button disconnected from this app's own PNS accent color,
 * then a `border-terracotta/30`-outlined version of this same tint. No
 * border either way now — this app's 100%-frameless pass dropped the
 * outline, relying on `bg-surface`'s own tonal contrast against whatever
 * page/card background surrounds it (never pure white, never pure
 * porcelain) to read as a distinct button with no line needed. Any icon
 * inside inherits this button's text color automatically as long as it has
 * no hardcoded color class of its own (`text-current` or, more commonly,
 * simply no color class at all). */
export const secondaryButtonClass =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-sm bg-surface px-4 py-2.5 font-mono text-xs font-medium tracking-wider text-terracotta uppercase shadow-sm transition-all duration-150 hover:bg-terracotta hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface disabled:hover:text-terracotta";

/** Every plain `<input>` — profile form fields, quick-mode duration/watts,
 * GPX duration override, the custom-date picker. White by default (not
 * `bg-surface`, which is reserved for genuinely read-only/calculated
 * containers — see that token's own comment in `app/globals.css`) so an
 * editable field never reads as disabled/read-only next to the surrounding
 * beige page chrome. Ultra-thin `border-zinc-200/80` with no drop shadow —
 * a deliberately lighter, less "commercial form" treatment than an earlier
 * pass's `border-zinc-300 shadow-sm`, matched by `selectableFieldClass`
 * below so an `<input>` and an adjacent `<select>` (e.g. the custom-date
 * input next to the departure-hour select) never look like two different
 * design systems sitting side by side. */
export const fieldClass =
  "w-full rounded-sm border border-zinc-200/80 bg-white px-4 py-2 text-sm font-sans text-zinc-800 transition-colors duration-150 hover:border-zinc-300 focus:border-terracotta focus:outline-none";

/** Every `<select>`. `appearance-none` strips the browser's own native
 * dropdown arrow — every call site pairs this with a `<ChevronDown>`
 * (`lucide-react`) absolutely positioned inside a `relative` wrapper, since
 * a bare `<select>` can't host an icon of its own; `pr-9` reserves the room
 * that icon sits in so the selected option's own text never runs underneath
 * it. Otherwise the same field treatment as `fieldClass` plus a pointer
 * cursor, since a `<select>` is a "pick one" control, not a free-typed
 * field. */
export const selectableFieldClass =
  "w-full cursor-pointer appearance-none rounded-sm border border-zinc-200/80 bg-white px-4 py-2 pr-9 text-sm font-sans text-zinc-800 transition-colors duration-150 hover:border-zinc-300 focus:border-terracotta focus:outline-none";

/** Pairs with every `selectableFieldClass` — the `<ChevronDown>` that
 * replaces the native dropdown arrow stripped by `appearance-none`.
 * Positioned inside whatever `relative` wrapper the call site already has
 * around its `<select>`. */
export const selectChevronClass =
  "pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-zinc-400";

/** Every plain-text field label in the Dashboard's Fueling Planner (Ruta,
 * Intensidad objetivo, Fecha y hora de salida, Paradas previstas en ruta,
 * Configuración de bidones, Comida en bolsillo, Duración/Vatios) and the
 * Physiological Profile form (Peso, FTP, Fenotipo metabólico, Tasa de
 * sudoración, etc.) — centralized here specifically so both surfaces share
 * one literal definition instead of two independent, same-looking consts
 * that could silently drift apart. Fine, attenuated style — no
 * `uppercase`/`font-semibold` shouting, and the labels' own source text is
 * real sentence case ("Peso (kg)," not "PESO (KG)"), which a CSS
 * `text-transform` would otherwise override regardless. */
export const formFieldLabelClass = "text-xs font-mono text-zinc-500 tracking-wide";

/** A small data-pill — weather readouts, Gut Training level, and other
 * short label+value chips that read as a distinct "tag" rather than a
 * full stat block. */
export const badgeClass =
  "inline-flex items-center gap-1 rounded-md border border-badge-border bg-badge px-2.5 py-1 font-mono text-badge-foreground";

/** Flattens the Fueling Planner's/Post-Ride Analysis's own root `<Card>` on
 * mobile — no border, no background, no shadow, no padding, so the card's
 * content sits flush against the page's own edges instead of a "card inside
 * the Dashboard's own page padding" doubled-up look (the "muñeca rusa"/
 * Russian-doll effect). Reappears as a real card at `sm:` and up, where the
 * extra width means a boxed container reads as organized structure rather
 * than lost horizontal space — but background alone is the differentiator,
 * not a border or a shadow: a 100% flat-UI pass (Pas Normal Studios' own
 * "white cards, no borders, no shadows" system) settled on `bg-card` (pure
 * white) against the porcelain canvas as the *only* differentiator, after an
 * intermediate pass had briefly added a diffuse `cardShadowClass` shadow —
 * removed again outright once a later request asked for strictly flat,
 * shadow-free layering everywhere. `sm:rounded-xl` matches the base `Card`
 * primitive's own radius exactly (both bumped together in the same pass).
 * Overrides `Card`'s own `border`/`bg-card`/`rounded-xl` defaults (`cn()`
 * lets the later, more specific utility win) and, via the `--card-spacing`
 * custom property `Card`/`CardHeader`/`CardContent` all key off, zeroes
 * their internal `py-`/`px-` padding at the same breakpoint rather than
 * needing a separate override on each. */
export const flatMobileCardClass =
  "rounded-none border-0 bg-transparent shadow-none [--card-spacing:0px] sm:rounded-sm sm:border-0 sm:bg-card sm:shadow-none sm:[--card-spacing:--spacing(5)]";

"use client";

import {
  Bike,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Droplet,
  Droplets,
  FlaskConical,
  Gauge,
  Lightbulb,
  Lock,
  MapPin,
  Moon,
  Pencil,
  RefreshCw,
  ShoppingBag,
  Snowflake,
  Sun,
  TriangleAlert,
  Upload,
  Utensils,
  Zap,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { stripEmoji } from "@/lib/gpx-export";
import { parseGpxFile, type ParsedGpxRoute } from "@/lib/gpx-import";
import { decodePolyline } from "@/lib/polyline";
import { refreshStravaRoutes } from "@/lib/strava-actions";
import { ElevationSparkline } from "@/components/elevation-sparkline";
import { GpxAltimetryPreview } from "@/components/gpx-altimetry-modal";
import { WeatherImpactCard } from "@/components/weather-impact-card";
import { FuelingContextTooltips } from "@/components/fueling-context-tooltip";
import { InfoTooltip } from "@/components/info-tooltip";
import { ProfileRequiredBanner } from "@/components/profile-required-banner";
import {
  fieldClass,
  formFieldLabelClass,
  selectableFieldClass,
  selectChevronClass,
} from "@/lib/ui-classes";
import {
  calculateHouseholdMeasures,
  estimateRideDurationHours,
  getBottlePlan,
  getElectrolyteRecommendation,
  getPocketFoodTotalCarbsG,
  getProjectedSpeedKmh,
  getTableSaltGrams,
  HYPERTONIC_THRESHOLD_PCT,
  MANUAL_TERRAIN_OPTIONS,
  pocketFoodCarbsG as POCKET_FOOD_CARBS_G,
  pocketFoodLabels,
  type ExperienceMode,
  type FuelingMode,
  type IntensityLevel,
  type LastMealTiming,
  type ManualCalcMode,
  type ManualTerrain,
  type PocketFoodItemType,
  type PocketFoodSelection,
  type PreRideGlycogenLoad,
} from "@/lib/metabolic-engine";
import type { StravaRoute } from "@/lib/strava-routes";
import { COMMERCIAL_PRODUCTS } from "@/lib/constants/nutrition-brands";
import {
  CommercialProductsSheet,
  CommercialProductStepperRow,
} from "@/components/commercial-products-sheet";

// "Estandarización de Tarjetas (Cards 01 a 05)" — every numbered card
// wrapper in this component (01 Selección y origen de ruta, 02 Condiciones
// de la salida, 03 Metabolismo y objetivos calculados, 04 Logística de
// salida, 05 Manifiesto de salida) now shares this exact visual chrome at
// every breakpoint — a real, visible `border-zinc-200/90` border,
// `rounded-2xl` corners, a white fill, and a soft shadow, both on mobile
// and desktop. This is a deliberate reversal of this app's earlier
// "100%-frameless, mobile-flattened" card system for *this specific
// component* — 01 and 02 used to have no border at all (relying on
// `flatMobileCardClass`'s mobile-flattening + background contrast alone),
// and 02 used the app-wide `rounded-sm` scale while 01/03/04/05 already
// used `rounded-xl`/`rounded-2xl` — a real, reported inconsistency, not a
// stylistic nuance. `mb-5 sm:mb-6` gives each card its own spacing from the
// next, so the two containers that used to supply that spacing (the root
// `<Card>`'s `CardContent` `gap-6`, the results wrapper's own `gap-4`) were
// both dropped in favor of letting each card manage its own margin,
// exactly like `/perfil`'s numbered cards already do.
const numberedCardClass = "mb-5 rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-sm sm:mb-6 sm:p-5 md:p-6";

// Leaflet reads `window`/`document` at module scope, which breaks Next's
// server render pass — `ssr: false` is what actually prevents that, not
// just this file's own top-level `"use client"` (every client component
// still renders once on the server for the initial HTML unless its import
// is wrapped like this).
const RouteMapPreview = dynamic(
  () => import("@/components/route-map-preview").then((mod) => mod.RouteMapPreview),
  {
    ssr: false,
    loading: () => <Skeleton className="mt-3 h-48 w-full rounded-sm" />,
  }
);

// Matches `components/post-ride-analysis.tsx`'s own local copy of this same
// helper exactly ("1h 29m", not the padded "01 h 29 min" this used to
// print) — a raw decimal like "1.48 h" doesn't read as a duration at a
// glance, and the two screens should format time identically.
function formatHoursMinutes(hours: number): string {
  const totalMinutes = Math.round(Math.max(0, hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Converts a decimal-hours figure into whole Horas/Minutos strings for the
 * "Tiempo estimado" dual-input fields (Ruta and GPX mode both use this) —
 * rounds to the nearest whole minute and rolls a rounded-up "60" over into
 * the next whole hour instead of ever displaying "X h 60 min". */
function decimalHoursToParts(hours: number): { hours: string; minutes: string } {
  let wholeHours = Math.floor(hours);
  let wholeMinutes = Math.round((hours - wholeHours) * 60);
  if (wholeMinutes === 60) {
    wholeHours += 1;
    wholeMinutes = 0;
  }
  return { hours: String(wholeHours), minutes: String(wholeMinutes) };
}

// "Limpieza de Despensa Genérica" — the 4 generic gel dose tiers
// (`gel_small`/`gel_standard`/`gel_high`/`gel_ultra`) were removed from this
// catalog outright: a rider reaching for a gel now picks the *real* branded
// product (Maurten/226ERS/SiS/etc., with its own real sodium figure) from
// `CommercialProductsSheet` instead, or falls back to the always-available
// "Personalizado" free-grams entry — a generic placeholder gel duplicated
// both of those without adding anything real of its own.
//
// "Logística de Salida (Carga desde Casa)" — `pastry`/`energy_bar`/
// `rice_cake` were dropped from this list too (a second, later pass), down
// to 5 real-food items shown then (`soda`/`banana`/`milk_bread` visible by
// default, `gummies`/`dates` behind "Más comida real").
//
// "Ajuste de Realismo" — `soda`/`milk_bread` were removed a third time:
// neither is something a rider actually carries in a jersey pocket *from
// home* (a can of soda is a road-side café/gasolinera purchase, not a
// pantry item; "Pan de leche/Membrillo" never had a strong real-world
// pocket-food precedent to begin with) — see the Estrategia de Ruta alert
// in Card 05 below, which now names a refresco explicitly as the road-side
// purchase example instead. Card 04's own catalog is down to exactly the 3
// items a rider genuinely stuffs in a jersey pocket before leaving the
// house (`banana`/`dates`/`gummies`), all visible by default with no
// "Más comida real" accordion needed anymore — `PocketFoodItemType` itself
// — every one of these, `soda`/`milk_bread`, plus every `gel_*` member — is
// untouched in `lib/metabolic-engine.ts`: that type still backs the
// server-only "Óptimo"/"Híbrido" fueling modes (unreachable from this UI
// since the "Reestructuración Integral..." pass, see that section's own doc
// history, but still real API surface), so only this file's own catalog
// array stopped offering the dropped items, not the shared type.
const POCKET_FOOD_TYPES: PocketFoodItemType[] = ["banana", "dates", "gummies"];
const MAX_POCKET_FOOD_QTY = 6;

// "Balance de Sodio (Bici + Bolsillos)" — Card 05 flags a real sodium gap
// only on a genuinely hot ride (where under-replacing sodium is a real
// cramping/hyponatremia risk, see `getSodiumLossMgPerHour` in
// `lib/metabolic-engine.ts`) — a cool ride sweats far less sodium to begin
// with, so a shortfall there isn't a gap worth flagging. Used to be scoped
// to commercial-product sodium alone (assuming a DIY-only athlete's bottle
// always covered the full target) — a real bug once "Configuración de
// bidones" could genuinely be set to "Solo Agua" (zero mix bottles, zero
// bottle sodium): that athlete's real sodium coverage could fall well short
// with no warning ever firing, since the check only ever looked at
// `commercialSodiumMg`. Now compares against the *combined* real coverage
// (bottle-mix sodium + commercial products, see `getBottleSodiumContributionMg`
// above), so it fires whenever that combined total falls short, regardless
// of whether the athlete touched the optional commercial-products selector
// at all.
const SODIUM_SUGGESTION_HOT_ROUTE_THRESHOLD_C = 28;
const SODIUM_SUGGESTION_COVERAGE_FRACTION = 0.8;

// "Traducción de Déficit a Unidades Operativas" — plain reference doses for
// translating a raw sodium-deficit milligram figure into something an
// athlete can actually go buy/measure: a standard electrolyte salt capsule
// (~450mg Na+ each, a commonly-cited figure across mainstream electrolyte-
// capsule products) and this app's own Evolytes-style powder concentration
// (~280mg Na+ per gram — the same ratio the DIY bottle's own real sodium
// dose is built from, see `getBottleSodiumContributionMg` above). Purely a
// unit conversion for the suggestion banner below, not a second sodium
// target model — the deficit itself is still `sodiumDeficitMg`.
const SALT_CAPSULE_SODIUM_MG = 450;
const EVOLYTES_SODIUM_MG_PER_G = 280;

// "Receta Mezcla Casera: Especificación de Evolytes" — the "Ver en cazos"
// reveal used to show a generic "Sal común: Xg (~Y cdta.)" line, derived
// from the athlete's own computed sodium target — "sal" (table salt) reads
// as plain sodium chloride, which invites confusion with literal kitchen
// salt rather than a complete electrolyte complex (Na/K/Mg/Ca). Replaced
// with the app's own official Evolytes dosing table, a fixed reference
// gram figure per the app's 3 supported bottle sizes (`BOTTLE_CAPACITY_
// QUICK_OPTIONS`) — a practical, real-world serving suggestion (how a
// rider actually doses electrolyte powder into a bottle) rather than the
// mg-precise sodium target used elsewhere (Card 03/05's own sodium
// balance, unaffected by this table). The fallback for a bottle size
// outside the fixed 3 keeps the same ~2g-per-550ml ratio as the reference
// values, rather than assuming one of them.
const EVOLYTES_GRAMS_BY_BOTTLE_SIZE: Record<number, number> = {
  550: 2,
  750: 3,
  950: 4,
};
function getEvolytesGramsForBottleSize(bottleSizeMl: number): number {
  return EVOLYTES_GRAMS_BY_BOTTLE_SIZE[bottleSizeMl] ?? Math.round((bottleSizeMl / 550) * 2);
}

interface CalculatedInputsSnapshot {
  mode: "route" | "quick" | "gpx";
  selectedRouteId: string;
  gpxIdentifier: string;
  durationHours: number;
  intensity: IntensityLevel | "";
  departureDayMode: DepartureDayMode;
  departureCustomDate: string;
  departureHour: string;
  isTargetEvent: boolean;
  trainLowEffective: boolean;
  cafeteriaStopCount: CafeteriaStopCount;
  manualTerrain: ManualTerrain;
  manualCalcMode: ManualCalcMode;
  manualDistanceKm: number;
  preRideGlycogenLoad?: PreRideGlycogenLoad;
  lastMealTiming?: LastMealTiming;
}

function areInputsEqual(a: CalculatedInputsSnapshot, b: CalculatedInputsSnapshot): boolean {
  if (a.mode !== b.mode) return false;
  if (a.intensity !== b.intensity) return false;
  if (a.departureDayMode !== b.departureDayMode) return false;
  if (a.departureCustomDate !== b.departureCustomDate) return false;
  if (a.departureHour !== b.departureHour) return false;
  if (a.isTargetEvent !== b.isTargetEvent) return false;
  if (a.trainLowEffective !== b.trainLowEffective) return false;
  if (a.cafeteriaStopCount !== b.cafeteriaStopCount) return false;
  if (a.preRideGlycogenLoad !== b.preRideGlycogenLoad) return false;
  if (a.lastMealTiming !== b.lastMealTiming) return false;
  if (Math.abs(a.durationHours - b.durationHours) > 0.001) return false;

  if (a.mode === "route") {
    if (a.selectedRouteId !== b.selectedRouteId) return false;
  } else if (a.mode === "gpx") {
    if (a.gpxIdentifier !== b.gpxIdentifier) return false;
  } else if (a.mode === "quick") {
    if (a.manualTerrain !== b.manualTerrain) return false;
    if (a.manualCalcMode !== b.manualCalcMode) return false;
    if (Math.abs(a.manualDistanceKm - b.manualDistanceKm) > 0.01) return false;
  }
  return true;
}

/** "Flujo Deliberado de Generación para Card 05" — a snapshot of exactly
 * Card 04's own inventory controls (bottle role, pocket food, custom
 * carbs, real branded products, the in-situ bottle-capacity override) —
 * deliberately *not* `cafeteriaStopCount`/route/intensity/etc., since those
 * are Paso 01/02-level concerns already tracked by `CalculatedInputsSnapshot`/
 * `isInputsChanged` above. Taken the moment "Generar Manifiesto de Salida"
 * is pressed, compared against the *current* live inventory on every
 * render to decide whether Card 05's already-generated manifest is stale. */
interface InventorySnapshot {
  pocketFood: Partial<Record<PocketFoodItemType, number>>;
  customCarbsG: number;
  bottleConfig: BottleConfigOption;
  commercialProducts: Record<string, number>;
  bottleCapacityOverrideMl: number | null;
}

function isRecordEqual(a: Record<string, number | undefined>, b: Record<string, number | undefined>): boolean {
  const aKeys = Object.keys(a).filter((k) => (a[k] ?? 0) !== 0);
  const bKeys = Object.keys(b).filter((k) => (b[k] ?? 0) !== 0);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => (a[k] ?? 0) === (b[k] ?? 0));
}

function isInventoryEqual(a: InventorySnapshot, b: InventorySnapshot): boolean {
  return (
    a.customCarbsG === b.customCarbsG &&
    a.bottleConfig === b.bottleConfig &&
    a.bottleCapacityOverrideMl === b.bottleCapacityOverrideMl &&
    isRecordEqual(a.pocketFood, b.pocketFood) &&
    isRecordEqual(a.commercialProducts, b.commercialProducts)
  );
}

// "Tip de Eficiencia: Mix vs. Solo Agua" — a demanding ride (long or hot)
// run entirely on plain water leaves the athlete carrying their whole carb
// target as pocket food, when dissolving even one bottle into a Mix would
// free up jersey space and deliver carbs/hydration together. Purely
// advisory (never changes the actual recipe/bottle-plan math) and only
// worth surfacing once the ride is genuinely demanding — a short, cool
// spin has no real efficiency gain from switching.
const WATER_ONLY_TIP_DURATION_THRESHOLD_HOURS = 2;
const WATER_ONLY_TIP_HEAT_THRESHOLD_C = 28;

// "Lista Definitiva de Casa" — Card 04's own pocket-food catalog is a fixed,
// always-visible 4-row list (Plátano/Dátiles/Gominolas + "Personalizado"),
// no toggle/accordion/editor needed: every catalog item is already
// "default visible," so a "Mi Despensa" on/off editor over a 3-item catalog
// had nothing left to actually narrow — removed outright as genuinely dead
// UI rather than kept "just in case" (see the deleted `PantryEditorModal`).
const MAX_CUSTOM_CARBS_G = 500;

// Offline fallback for "en medio de un puerto sin cobertura" — the last
// successfully calculated strategy, so the athlete still has *something*
// actionable instead of a blank/broken screen with no signal.
const LAST_FUELING_STRATEGY_KEY = "last_fueling_strategy";

/** Plain, no-emoji name for the pocket-food matrix — `pocketFoodLabels` keeps
 * its friendly emoji-prefixed copy for the clipboard/GPX exports, this derives
 * the clean-label variant from the same source at render time. */
function pocketFoodName(type: PocketFoodItemType): string {
  return stripEmoji(pocketFoodLabels[type]);
}

// "Ración Física de Gominolas" — a gram figure alone (20g HC) doesn't tell
// the athlete how much to actually grab from the bag; Card 04's own stepper
// row for this one item states the real physical serving size it corresponds
// to, so pocketFoodLabels' shared "🍬 Gominolas / Haribo (bolsita)" copy
// (still used as-is everywhere else — clipboard export, timeline milestones)
// stays untouched.
function pocketFoodDisplayName(type: PocketFoodItemType): string {
  if (type === "gummies") return "Gominolas (~25g)";
  return pocketFoodName(type);
}

// "Normalización Tipográfica" — every field label in the planner (Ruta,
// Intensidad objetivo, Fecha y hora de salida, Paradas previstas en ruta,
// Configuración de bidones, Comida en bolsillo, Duración/Vatios) shares
// `formFieldLabelClass`, imported from `lib/ui-classes.ts` — centralized
// there (not a local const here) specifically so the Physiological Profile
// form's own field labels can share this exact same definition byte-for-byte
// rather than an independent, same-looking copy that could drift apart.
// Shared with every other field/button across the app (`lib/ui-classes.ts`) —
// aliased to these file-local names since they're already used at every
// input/select/date call site below.
const inputClass = fieldClass;
const selectableInputClass = selectableFieldClass;
// Shared sizing/typography/shape for every segmented control in this file
// (the Ruta/GPX vs. Entreno Manual mode toggle, Salida's Hoy/Mañana/Elegir
// fecha, Estrategia nutricional's Óptimo/Mi Inventario/Híbrido) — rectangular
// buttons (PNS editorial style), not a pill/track, so each call site only
// adds its own active/inactive color ternary via `cn()`, not the shape/
// sizing rules — a narrow-viewport fix to one can't silently drift from the
// other two. A real `border` (color supplied per call site's own ternary —
// see each one's own comment) is back on the base class: this app's
// briefly-tried "zero-border" pass removed it in favor of pure background-
// fill differentiation, reversed on a later, explicit request for the
// inactive/secondary state to read as a clearly bordered, shadow-free
// control again — `shadow-none` stays explicit here for the same reason,
// even though no shadow utility was ever actually applied. Sentence case,
// not uppercase/mono — these are real UI actions ("Ruta Strava", "Hoy",
// "Óptimo"), not technical data labels (see `eyebrow` for that convention).
// `min-w-0` is what lets a CSS grid column actually shrink below its
// content's natural width — a grid item defaults to `min-width: auto`,
// which would otherwise force the column (and the whole row) wider than its
// share of the grid instead of ever truncating.
const segmentedButtonClass =
  "flex h-9 w-full min-w-0 cursor-pointer items-center justify-center rounded-sm border px-1 text-center text-xs font-medium shadow-none transition-colors duration-150 sm:px-3 sm:text-sm";
// Applied to the label text itself, not the button — `overflow-hidden`/
// `text-ellipsis` on a `flex items-center justify-center` button clips
// symmetrically from *both* sides of the centered content (verified live:
// "Mi Inventario" rendered as the nonsensical "i Inventario" at 320px), since
// the flex box centers the overflow before ever clipping it. Tailwind's
// `truncate` utility on a `block w-full` child instead gives the label its
// own left-aligned single-line box to truncate against, so an overflow
// always reads as "Mi Inventari…" — a real ellipsis at the end, never a
// garbled double-sided clip — while non-overflowing labels stay visually
// centered exactly as before (there's no slack for `text-center` to act on
// once the label is genuinely truncated).
const segmentedButtonLabelClass = "block w-full truncate";
// "Jerarquía de Color: Selectores vs. Acción Principal" — every selector/
// toggle (Card 01's mode toggle, Card 02's date/paradas pills, Card 04's
// bottle selectors) shares one Taupe/Bronce Apagado (`#70685b`, hover
// `#60594e`) accent for "selected/active" — a muted, secondary tone that
// reads as "chosen among options," not an action. The final "Calcular
// Estrategia Nutricional" CTA deliberately does *not* share that color: it's
// the one action on the whole screen, not a selection among options. Earlier
// passes gave it Card 03's own Verde Oliva (`#222A23`), then a Bronce
// Táctico (`#8C6D46`) — both reverted in favor of Negro Obsidiana
// (`#18181B`, hover `#27272A`) instead, so the CTA reads as the single most
// authoritative, highest-contrast action on the screen, distinct from every
// selector's now-lighter taupe fill. Still a deliberate, scoped one-off
// departure from the shared `primaryButtonClass` token (still `bg-terracotta`
// everywhere else — Copiar receta, Guardar cambios, Guardar consumo real,
// etc.). `rounded-xl` is a deliberate, explicit exception to this app's
// otherwise-global `rounded-sm` control radius (same precedent as Card 05's
// own `rounded-xl` result cards) — scoped to this one button, not a change
// to the shared radius scale. No `uppercase` here (unlike every other shared
// button token) — the label itself is real Title Case ("Calcular Estrategia
// Nutricional"), and a CSS `text-transform` would silently force it back to
// all-caps regardless of the source string's actual casing.
const bronzeCtaButtonClass =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#18181B] px-4 font-mono text-sm font-bold tracking-wider text-white shadow-sm transition-colors duration-150 hover:bg-[#27272A] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#18181B]";
// Card 05 ("Manifiesto de Salida") — every subtitle inside it (Cadencia de
// hidratación, Equipamiento y bici, Comida de bolsillo, Paradas en ruta,
// Plan de agua en ruta) shares this exact class rather than each carrying
// its own near-identical string — "todos los subtítulos comparten
// exactamente el mismo estilo visual" is trivially true when they're all
// one constant. No `uppercase`/`tracking-widest` — Sentence Case, matching
// this app's "no ALL CAPS outside a genuine technical readout" convention.
const manifestSubtitleClass = "font-mono text-[11px] text-zinc-500";
// "Salida" quick-select: a day pill (Hoy/Mañana) plus a plain hour `<select>`
// replaces the old `datetime-local` input — that native control's per-browser
// chrome (and iOS Safari's multi-segment month/day/year/hour/minute/AM-PM
// rendering in particular) was more precision than a rider picking "tomorrow
// morning" actually needs, and needed its own overflow-defense classes to
// avoid forcing the field wider than its grid column on a narrow phone. Hour
// options cover the range a rider would plausibly start a ride at.
const DEPARTURE_HOUR_OPTIONS = [
  "05:00", "06:00", "07:00", "08:00", "09:00", "10:00",
  "11:00", "12:00", "13:00", "14:00", "15:00", "16:00",
  "17:00", "18:00", "19:00", "20:00",
];

/** The current local hour, rounded to the nearest whole hour and clamped
 * into `DEPARTURE_HOUR_OPTIONS`' own 05:00-20:00 range — a reasonable
 * "now-ish" default for the hour `<select>` (replacing a fixed "08:00"
 * regardless of when the athlete actually opened the planner) without
 * introducing a genuinely empty/required field for something as low-stakes
 * as which hour option starts selected. */
function getRoundedCurrentHour(): string {
  const now = new Date();
  let hour = now.getMinutes() >= 30 ? now.getHours() + 1 : now.getHours();
  hour = Math.min(20, Math.max(5, hour));
  return `${String(hour).padStart(2, "0")}:00`;
}

/** "Scroll Inmediato al Primer Clic" — every `handleCalculate` early-return
 * branch below already called `document.getElementById(...)?.scrollIntoView`
 * directly, which should already fire on the very first click (it's a plain
 * synchronous DOM call, not gated on a React re-render having flushed) —
 * wrapping it in `requestAnimationFrame` here is a defensive belt-and-
 * suspenders fix, deferring the call to the next paint so it can never race
 * a same-tick layout change (e.g. the amber-border `error` state applying)
 * that could otherwise leave `scrollIntoView` computing against stale
 * geometry. Deliberately does *not* call `.focus()` on the target — the one
 * `<input>` case that needs a real keyboard (Duración) still calls its own
 * `.focus()` separately at its call site, since a `<select>` must never be
 * programmatically focused here (that pops iOS Safari's native picker wheel
 * open uninvited — see `handleCalculate`'s own top-level comment). */
function scrollToFieldError(elementId: string) {
  requestAnimationFrame(() => {
    document.getElementById(elementId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

// The one "Intensidad Objetivo" selector shared verbatim across all 3
// planner modes — Ruta, Subir GPX, and Entreno Manual all now render the
// exact same label, tooltip, placeholder, and option list via
// `IntensityObjectiveSelect` below, rather than each mode carrying its own
// slightly different copy (Entreno Manual used to have a separate "Tipo de
// Entreno" selector with only 4 options and a different tooltip).
const INTENSITY_SELECT_OPTIONS: { value: IntensityLevel; label: string }[] = [
  { value: "recovery", label: "Recuperación (Z1)" },
  { value: "endurance", label: "Fondo Aeróbico (Z2)" },
  { value: "tempo", label: "Tempo / Sweetspot (Z3)" },
  { value: "threshold", label: "Umbral (Z4)" },
  { value: "vo2max", label: "Intervalos / VO2 Max (Z5-Z7)" },
  { value: "competition", label: "Competición / Carrera" },
];

// "Monocromo/Bronce" — a brief rainbow-per-zone pass (blue→green→amber→
// orange→red→purple) read as too loud/playful for this app's sober PNS
// palette; reverted to a quiet, technical monochrome instead. Z1-Z4 stay
// plain `text-zinc-900`, and only Z5-Z7/Competición — the genuine
// "maximum effort" zones — pick up the app's own Bronce Táctico accent
// (`#70685b`, the same color every active selector state already uses)
// as the one deliberate highlight, rather than a 6-color gradient.
const INTENSITY_ZONE_TOOLTIP_NOTE = (
  <div className="space-y-1.5 text-left text-xs font-mono text-zinc-500">
    <p>
      <strong className="font-bold text-zinc-900">Recuperación (Z1):</strong> &lt;55% FTP
      (Gasto glucogénico mínimo, oxidación de grasas).
    </p>
    <p>
      <strong className="font-bold text-zinc-900">Fondo Aeróbico (Z2):</strong> 55-75% FTP
      (Ritmo base, consumo moderado de glucógeno).
    </p>
    <p>
      <strong className="font-bold text-zinc-900">Tempo / Sweetspot (Z3):</strong> 76-90% FTP
      (Ritmo exigente sostenible, consumo alto).
    </p>
    <p>
      <strong className="font-bold text-zinc-900">Umbral (Z4):</strong> 91-105% FTP (Series
      al límite, consumo glucogénico elevado).
    </p>
    <p>
      <strong className="font-bold text-[#70685b]">Intervalos / VO2 Max (Z5-Z7):</strong>{" "}
      &gt;106% FTP (Series explosivas de alta intensidad).
    </p>
    <p>
      <strong className="font-bold text-[#70685b]">Competición / Carrera:</strong>{" "}
      Variabilidad alta y máximo vaciado metabólico.
    </p>
  </div>
);

/** The shared label + `(?)` zone-guide tooltip + placeholder + 6-option
 * `<select>`, identical at every one of its 3 call sites (Ruta mode, GPX
 * mode, Entreno Manual) — extracted specifically so "unify the selector
 * across tabs" can't silently drift back into 3 near-identical copies the
 * next time any one of them needs a tweak. */
function IntensityObjectiveSelect({
  id,
  value,
  onChange,
  error,
  disabled = false,
  isModified = false,
}: {
  id: string;
  value: IntensityLevel | "";
  onChange: (value: IntensityLevel) => void;
  /** "Validación Secuencial Inteligente" — set once `handleCalculate`
   * (`FuelingPlanner`) finds Paso 01 complete but this select still empty.
   * Purely a border/micro-text highlight, same amber treatment as the
   * route select below — never forces the native picker open itself. */
  error?: boolean;
  /** "Bloqueo de Formulario durante isCalculating" — true for the whole
   * duration of `handleCalculate`'s in-flight request, so the athlete can't
   * change the very inputs a calculation is already running against. */
  disabled?: boolean;
  isModified?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <label htmlFor={id} className={cn(formFieldLabelClass, "block")}>
          Intensidad objetivo
        </label>
        {isModified && (
          <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">
            <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
            Modificado
          </span>
        )}
        <InfoTooltip label="Guía de zonas de intensidad" note={INTENSITY_ZONE_TOOLTIP_NOTE} />
      </div>
      <div className="relative">
        <select
          id={id}
          disabled={disabled}
          className={cn(
            selectableInputClass,
            error && "border-2 border-amber-400 bg-amber-50/20",
            disabled && "cursor-not-allowed opacity-60"
          )}
          value={value}
          onChange={(e) => onChange(e.target.value as IntensityLevel)}
        >
          <option value="" disabled>
            Seleccionar intensidad...
          </option>
          {INTENSITY_SELECT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className={selectChevronClass} />
      </div>
      {error && (
        <span className="mt-1 block font-mono text-[10px] text-amber-700">
          * Por favor, selecciona una intensidad
        </span>
      )}
    </div>
  );
}

type PlanResult = {
  durationHours: number;
  carbsGPerHour: number;
  sodiumMgPerHour: number;
  fluidLossMlPerHour: number;
  recipe: {
    maltodextrinG: number;
    fructoseG: number;
    sodiumMg: number;
    waterMl: number;
    totalCarbsG: number;
  };
  totalRideCarbsG: number;
  pocketFood: Partial<Record<PocketFoodItemType, number>> & { customCarbsG?: number };
  pocketFoodCarbsG: number;
  fuelingMode: FuelingMode;
  hybridGelSuggestion: number | null;
  weather: {
    temperatureC: number;
    temperatureMaxC: number | null;
    humidityPct: number;
    windSpeedKmh: number;
    source: "dynamic" | "planning_default" | "seasonal_average";
    multiPointSample: boolean;
    lapseRateAdjustmentC: number;
    /** Only present on a route with a significant climb (real elevation
     * range cota máxima − cota mínima ≥ 400m, or a known summit ≥ 500m) —
     * see `WeatherImpactCard`'s comparative "Valle / Salida" vs. "Cima del
     * Puerto" cards. `null` on a flat route or Entreno Manual, where the
     * single blended reading above is the whole story. */
    altitude: {
      base: {
        temperatureC: number;
        humidityPct: number;
        windSpeedKmh: number;
        elevationM: number | null;
      };
      peak: {
        temperatureC: number;
        humidityPct: number;
        windSpeedKmh: number;
        elevationM: number | null;
      };
    } | null;
    /** "Cronograma Térmico por Puertos/Valles" — real Salida/Valle/Cima/
     * Llegada milestones (see `detectElevationMilestones`), each with its
     * own weather sample and (for a "peak") an Overpass-resolved name.
     * `[]` on a flat/short route with nothing to detect, in which case
     * `WeatherImpactCard` falls back to the 2-point `altitude` comparison
     * (or the single blended reading, if that's `null` too). */
    weatherPoints: {
      key: string;
      locationName: string;
      elevationM: number;
      distanceKm: number;
      distanceFraction: number;
      temperatureC: number;
      humidityPct: number;
      windSpeedKmh: number;
    }[];
    /** Thinned `{distanceFraction, elevationM}` elevation curve for the same
     * carousel's altitude-profile SVG — `[]` when no real per-point profile
     * was resolved. */
    elevationProfile: { distanceFraction: number; elevationM: number }[];
  };
  gutTraining: {
    isGutLimited: boolean;
    gutCapGPerHour: number;
    uncappedGPerHour: number;
  };
  bottlePlan: {
    bottleSizeMl: number;
    fuelBottles: {
      count: number;
      maltodextrinGPerBottle: number;
      fructoseGPerBottle: number;
      sodiumMgPerBottle: number;
      concentrationPct: number;
    };
    waterBottles: { count: number };
    totalBottles: number;
  };
  /** The athlete's real `athlete_profiles.bottle_count` (1 or 2 cages) —
   * see `getBottleCarbsContributionG` below. */
  athleteBottleCount: number;
  reloadStrategy: {
    startingFuelBottleCount: number;
    startingWaterBottleCount: number;
    startingBottleCount: number;
    ziplocBagsCount: number;
    ziplocDose: { maltodextrinG: number; fructoseG: number; sodiumMg: number };
    waterRefillCount: number;
    waterRefillLiters: number;
    reloadAtKm: number | null;
    reloadAtHours: number;
    isImpractical: boolean;
  } | null;
  nutritionMilestones: {
    label: string;
    atKm: number | null;
    atHours: number;
  }[];
  timingTimeline: {
    hydrationIntervalMinutes: number;
    entries: {
      type: "solid" | "gel" | "caffeine";
      label: string;
      atFractionOfRide: number;
      atMinutes: number;
      atKm: number | null;
    }[];
  };
  netCarbDeficit: {
    estimatedBurnG: number;
    plannedIntakeG: number;
    netDeficitG: number;
  };
  carbLoading: {
    minCarbsG: number;
    maxCarbsG: number;
    guidelines: string[];
  } | null;
  /** "Modo Eficiencia Metabólica" — `true` once the server actually applied
   * the Train Low carb-target override (see `TrainLowCheckbox` below). */
  trainLow: boolean;
  /** "Adaptación Térmica Extrema" — cold/heat thresholds evaluated against
   * the ride's final (lapse-rate/altitude-adjusted) temperature. */
  thermalAdaptation: {
    isExtremeCold: boolean;
    isExtremeHeat: boolean;
  };
  /** "Sensibilidad a Cafeína e Horario Nocturno" — `true` when the server
   * dropped every caffeine milestone because the estimated arrival lands at
   * or after 18:30 local. */
  caffeineSuppressed: boolean;
  /** "Rutas Multipuerto de Alta Montaña" — how many real summits the server
   * detected along the route (0 for Entreno Manual or a flat route). */
  mountainPassesDetected: number;
};

// "Micro-Edición In-Situ de Capacidad de Bidón" — "Estandarización
// Unificada de Bidones": the app's 3 official capacities only (550/750/
// 950ml) — 500/600/1000 were dropped outright, matching the same
// standardization applied to the persisted `bottle_capacity_ml` selector
// on `/perfil`.
const BOTTLE_CAPACITY_QUICK_OPTIONS = [550, 750, 950];


// "Semáforo Dinámico" — the one place Card 04's sticky bar decides
// RESTANTE's traffic-light color, so a future call site can't invent a
// second, disagreeing threshold. "Logística de Salida" simplified this to
// 2 states, matching RESTANTE RUTA's own framing — a nonzero remainder
// isn't an error to escalate through rose/amber tiers, it's simply the
// share of the target Card 05 expects to be covered on the road (a
// planned stop, or more load in the pockets); only the fully-covered case
// (0g) gets its own distinct, positive color.
function getRemainingCarbsTextClass(remainingCarbsG: number): string {
  if (remainingCarbsG > 0) return "text-amber-700 font-bold";
  return "text-emerald-700 font-bold";
}

const ALERT_BANNER_TONE_CLASSES: Record<
  "info" | "warning" | "success",
  { border: string; bg: string; icon: string; text: string; label: string }
> = {
  info: {
    border: "border-neutral-300",
    bg: "bg-neutral-50",
    icon: "text-neutral-900",
    text: "text-neutral-700",
    label: "text-neutral-900",
  },
  warning: {
    border: "border-amber-500",
    bg: "bg-amber-500/5",
    icon: "text-amber-700",
    text: "text-neutral-700",
    label: "text-amber-700",
  },
  success: {
    border: "border-emerald-500",
    bg: "bg-emerald-500/5",
    icon: "text-emerald-700",
    text: "text-neutral-700",
    label: "text-emerald-700",
  },
};

function AlertBanner({
  tone,
  icon,
  label,
  className,
  children,
}: {
  tone: "info" | "warning" | "success";
  icon: ReactNode;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const c = ALERT_BANNER_TONE_CLASSES[tone];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-r-md border-l-2 p-3 font-mono text-xs shadow-xs", c.border, c.bg, className)}>
      <span className={cn("shrink-0 pt-0.5 text-sm", c.icon)}>{icon}</span>
      <p className={cn("leading-snug", c.text)}>
        <span className={cn("mr-1 font-bold uppercase tracking-wide", c.label)}>{label}:</span>
        {children}
      </p>
    </div>
  );
}

// "Rediseño de Barras de Progreso" — this used to be a proportional 0-100%
// fill (a `pct` prop sized against a fixed physiological reference ceiling
// per metric), which read as an incomplete loading bar with no visible
// scale to judge it against — nothing on screen told a viewer whether a
// half-filled bar meant "using half of a sane physiological ceiling" or
// "still loading." Rather than adding a micro-legend spelling out each
// metric's own max (which would clutter an already-dense 2x2 grid, and risk
// disagreeing with whichever reference ceiling this app's own engine
// actually uses for that metric — see `getCarbOxidationRateGPerHour`'s real
// 100g/h gut-absorption ceiling, e.g.), this is now a plain, always-full
// solid accent line instead: it reads as a deliberate divider/underline
// beneath each tile's own figure, never as an ambiguous progress meter.
function MetricAccentLine() {
  return <div className="mt-1.5 h-0.5 w-full rounded-full bg-[#70685b]" aria-hidden />;
}

// "Configuración de bidones" — a lightweight planning preference, not a
// parameter that re-drives `getBottlePlan`'s own GI/solubility-capped math
// server-side (that engine already computes the real, optimal bottle split
// — see `lib/metabolic-engine.ts` — and re-architecting it to accept a
// manual override was out of scope for what is fundamentally a UX-flow
// pass). It *does*, though, drive the live CUBIERTO/RESTANTE balance pill —
// see `getBottleCarbsContributionG` below — entirely client-side, no
// network round-trip, the same way a pocket-food stepper tap already does.
// Defaults to "water_only" ("Solo Agua") rather than an unset value: the
// safest, most conservative starting assumption (zero bottle carbs until
// the athlete actively opts into a mix), and the value the "Reseteo
// Automático" effect below returns to on every Paso 01/02 change.
type BottleConfigOption = "water_only" | "one_mix" | "both_mix";
const DEFAULT_BOTTLE_CONFIG: BottleConfigOption = "water_only";

// Title Case, short — fits a fixed row even on a narrow phone (unlike the
// earlier, longer "1 Agua + 1 Mix"/"Ambos con Mix" labels). Two variants,
// picked at render time off the athlete's real `athlete_profiles.bottle_count`
// (`getBottleConfigOptions` below) — "Ambos Mix" is physically impossible on
// a 1-cage bike, so it's dropped entirely rather than shown disabled, and
// the remaining mix option is relabeled "Con Mix" once it's the only one
// left (a lone "1 Mix" reads oddly without a second option to contrast it
// against).
const TWO_CAGE_BOTTLE_CONFIG_OPTIONS: { value: BottleConfigOption; label: string }[] = [
  { value: "water_only", label: "Solo Agua" },
  { value: "one_mix", label: "1 Mix" },
  { value: "both_mix", label: "Ambos Mix" },
];
const ONE_CAGE_BOTTLE_CONFIG_OPTIONS: { value: BottleConfigOption; label: string }[] = [
  { value: "water_only", label: "Solo Agua" },
  { value: "one_mix", label: "Con Mix" },
];

function getBottleConfigOptions(athleteBottleCount: number, isHotWeather: boolean = false) {
  const mixLabel = isHotWeather ? "Mix Calor" : "Mix Estándar";
  if (athleteBottleCount === 1) {
    return [
      { value: "water_only" as const, label: "Solo Agua" },
      { value: "one_mix" as const, label: `Con ${mixLabel}` },
    ];
  }
  return [
    { value: "water_only" as const, label: "Solo Agua" },
    { value: "one_mix" as const, label: `1 ${mixLabel}` },
    { value: "both_mix" as const, label: `Ambos ${mixLabel}` },
  ];
}

/** How many grams of the ride's carb target the selected bottle
 * configuration itself contributes — the piece that makes the CUBIERTO/
 * RESTANTE pill reactive to the bottle selector, not just the pocket-food
 * steppers. Built from `singleBottleCarbsG` — the last calculation's own
 * per-bottle dose (`maltodextrinGPerBottle + fructoseGPerBottle`) — times
 * how many bottles the selection actually puts mix in: 0 for "Solo Agua,"
 * 1 for "1 Mix," 2 for "Ambos Mix."
 *
 * **Deliberately *not* `result.recipe.totalCarbsG` for "Ambos Mix"** — an
 * earlier version used that figure directly, which was a real bug: since
 * `recipe.totalCarbsG` is itself already the ride's target *minus*
 * whatever pocket food was selected at the last calculation
 * (`totalRideCarbsG - pocketFoodCarbsG`, see `POST /api/fueling/plan`),
 * adding it on top of the *live* `pocketFoodCarbsPreview` double-counted
 * that same pocket-food coverage — the pill read CUBIERTO as ~100% of the
 * objetivo the instant "Ambos Mix" was picked, before the athlete had
 * touched a single pocket-food stepper. `singleBottleCarbsG × 2` is
 * grounded in the bottle's own real per-bottle dose instead, with no
 * dependency on whatever pocket-food figure happened to be selected when
 * the strategy was last calculated — same "lightweight planning
 * preference, no re-derivation of `getBottlePlan`'s own math" convention
 * as the bottle selector itself, just no longer silently reusing a
 * pocket-food-adjusted total for a figure that must stay independent of
 * it.
 *
 * "Ambos Mix" credits `athleteBottleCount` bottles, not a hardcoded `2` —
 * an athlete with only 1 real cage configured on their profile
 * (`athlete_profiles.bottle_count`) physically can't run 2 mix bottles at
 * once, so crediting a second one they don't have would silently overstate
 * CUBIERTO. */
function getBottleCarbsContributionG(
  config: BottleConfigOption,
  bottlePlan: PlanResult["bottlePlan"],
  athleteBottleCount: number
): number {
  const { fuelBottles } = bottlePlan;
  if (fuelBottles.count === 0) return 0;
  const singleBottleCarbsG = fuelBottles.maltodextrinGPerBottle + fuelBottles.fructoseGPerBottle;
  switch (config) {
    case "water_only":
      return 0;
    case "one_mix":
      return singleBottleCarbsG;
    case "both_mix":
      return singleBottleCarbsG * athleteBottleCount;
    default:
      return 0;
  }
}

/** "Corrección de Lógica de Sodio: Inclusión de Mezcla Casera" — the sodium
 * mirror of `getBottleCarbsContributionG` above, same exact shape and same
 * reasoning: a Mezcla Casera bottle's own real per-bottle sodium split
 * (`fuelBottles.sodiumMgPerBottle`, driven by the athlete's actual sweat
 * rate/salty-sweater flag — see `getSodiumLossMgPerHour` in
 * `lib/metabolic-engine.ts`) genuinely contributes sodium toward the ride's
 * target, exactly like it already contributes carbs — but until now, only
 * `commercialSodiumMg` (real branded products) fed the "sodium covered"
 * figure below, silently crediting 0mg Na+ to whatever real Evolytes/salt
 * the athlete's own homemade bottle carries. Deliberately *not* a second,
 * hardcoded per-bottle-size sodium table — this app already computes a
 * real, athlete-specific sodium dose for the DIY bottle; a second, brand-
 * specific figure would just be two competing sodium models disagreeing
 * with each other. */
function getBottleSodiumContributionMg(
  config: BottleConfigOption,
  bottlePlan: PlanResult["bottlePlan"],
  athleteBottleCount: number
): number {
  const { fuelBottles } = bottlePlan;
  if (fuelBottles.count === 0) return 0;
  switch (config) {
    case "water_only":
      return 0;
    case "one_mix":
      return fuelBottles.sodiumMgPerBottle;
    case "both_mix":
      return fuelBottles.sodiumMgPerBottle * athleteBottleCount;
    default:
      return 0;
  }
}

/** "Rediseño Estructural de la Lista de Equipamiento" — one structured row
 * for Card 05's "Resumen de Carga" manifest, replacing the old pre-baked
 * single-string lines (`"2x Bidón de 750ml (con Mezcla Casera)"`) that
 * forced a 2-column right-aligned layout to either wrap badly or clip a
 * trailing unit. `quantity` (`null` when the row has no natural count —
 * e.g. a single "Personalizado" gram entry) renders as its own compact
 * bronze badge; `name` is the bold primary line; `specs` is an optional
 * micro-sized secondary line (macros, a prep note) — all left-aligned,
 * never forced into a right-hand column. */
type ManifestItem = { key: string; quantity: number | null; name: string; specs?: string };

/** One "En bici" manifest row — `kind` lets the caller special-case the
 * mix-bottle row with an inline "[ Ver en cazos ]" reveal (see Card 05's
 * render below) while every other row (plain water, a Maurten/Beta Fuel
 * sachet bidón) renders as a plain manifest item like everything else. */
type BikeManifestItem = ManifestItem & { kind: "mix" | "water" | "gel_ultra" };

/** Tarjeta 05's "Checklist de preparación para llevar" — what to physically
 * grab before rolling out, split into "En bici" (bottles, driven by the
 * same `bottleConfig` preference the balance pill reacts to) and "En
 * bolsillo" (whatever pocket-food quantities are currently selected).
 *
 * The mix bottle's own line now spells out its exact scaled recipe
 * ("Bidón de 550ml (con Mezcla Casera: 24g Malto + 20g Fructosa + 1.0g
 * Sal)") — "Eliminación de la Caja Negra 'Dosis Ejecutiva'" moved this
 * card's entire recipe disclosure here, so an athlete mixing straight from
 * this list doesn't need a separate hero box above it for the numbers.
 * `fuelBottles.maltodextrinGPerBottle`/`fructoseGPerBottle` are always the
 * fixed `getBaseBottleRecipe` dose for the athlete's real bottle size (see
 * `lib/metabolic-engine.ts`); the salt figure is still the real per-bottle
 * sodium split (`fuelBottles.sodiumMgPerBottle`, driven by the athlete's
 * own sweat rate/salty-sweater flag), not a fixed table value — sodium
 * loss is genuinely athlete-specific in a way the carb dose intentionally
 * isn't.
 *
 * The bottle count listed here is capped at what actually fits in the
 * athlete's real cages (`reloadStrategy.startingBottleCount` whenever the
 * ride needs more bottles than the bike can carry at once — with no
 * overflow, every bottle the recipe needs already fits, so
 * `bottlePlan.totalBottles` itself is the cap). Before this cap existed,
 * this list could show more physical bottles than a bike has cages for
 * (e.g. "3x Bidón (Agua / Electrolitos)" on a 2-cage bike) — any water need
 * beyond that cap is a fountain refill, not a bottle to carry from home,
 * and is listed separately by `getWaterPlanLine` below instead.
 *
 * The "Productos Comerciales de Alta Densidad" sachet prep line (a
 * Maurten/Beta Fuel 80g HC sachet dissolved into its own bottle) used to
 * live inside the removed hero box; it belongs here too now, since it's
 * just another bottle to prepare before rolling out. */
function getBikeManifestItems(
  result: PlanResult,
  bottleConfig: BottleConfigOption,
  bottlePlan: PlanResult["bottlePlan"]
): BikeManifestItem[] {
  const { fuelBottles, bottleSizeMl } = bottlePlan;
  const maxOnBike = result.reloadStrategy?.startingBottleCount ?? bottlePlan.totalBottles;
  const items: BikeManifestItem[] = [];

  let mixBottleCount = 0;
  if (bottleConfig !== "water_only" && fuelBottles.count > 0) {
    // Matches `getBottleCarbsContributionG`'s own bottle count exactly —
    // "Ambos Mix" means the athlete's real cage count
    // (`result.athleteBottleCount`, 1 or 2), not a hardcoded 2 — capped at
    // `maxOnBike` so this can never exceed what's actually mounted.
    mixBottleCount = Math.min(bottleConfig === "one_mix" ? 1 : result.athleteBottleCount, maxOnBike);
    items.push({
      key: "mix",
      kind: "mix",
      quantity: mixBottleCount,
      name: `Bidón de ${bottleSizeMl}ml`,
      // "Race Day Manifest" — the explicit Malto/Fructosa/Sal formula
      // doesn't live in this line's own text; the real grams only surface
      // one tap away via "[ Ver en cazos ]" below, unchanged.
      specs: "Mezcla Casera",
    });
  }

  // "Corrección de Bug: Bidón de Solo Agua desaparecido en '1 Mix'" — this
  // used to cap the water-bottle line at `waterBottles.count`, the
  // *physiological* residual fluid need beyond what a mix bottle's own
  // liquid volume already covers. That figure can legitimately be 0 when
  // the fuel bottle(s) alone already hold most of the ride's fluid
  // target — which silently dropped the second bottle from the checklist
  // entirely on a 2-cage bike running "1 Mix," even though the athlete
  // still has a real, physical second cage that isn't carrying mix. A
  // bottle checklist is about what's actually mounted on the bike, not
  // just what the fluid math says is strictly necessary — a rider doesn't
  // leave a cage empty just because the model says the extra water isn't
  // needed, they fill it anyway. So every cage not assigned to a mix
  // bottle (`maxOnBike - mixBottleCount`, `mixBottleCount` staying `0`
  // under "Solo agua") now gets a plain-water line, regardless of
  // `waterBottles.count`.
  const waterBottlesOnBike = Math.max(0, maxOnBike - mixBottleCount);
  if (waterBottlesOnBike > 0) {
    items.push({
      key: "water",
      kind: "water",
      quantity: waterBottlesOnBike,
      name: `Bidón de ${bottleSizeMl}ml`,
      specs: "Solo Agua",
    });
  }

  const gelUltraCount = result.pocketFood.gel_ultra ?? 0;
  if (gelUltraCount > 0) {
    items.push({
      key: "gel_ultra",
      kind: "gel_ultra",
      quantity: gelUltraCount,
      name: "Bidón + Sobre comercial 80g HC",
      specs: "Maurten / Beta Fuel + 500ml agua",
    });
  }

  return items;
}

/** Tarjeta 05's "Plan de agua en ruta" — plain water beyond what fits in
 * the athlete's real installed bottle capacity is never a Ziploc powder
 * concern (concentrate isn't available at a fountain — see
 * `getReloadStrategy`'s own `ziplocBagsCount`/`ziplocDose`, for mix bottles
 * specifically), so it's listed here as a fountain-refill action instead of
 * a phantom bottle in the "En bici" checklist above.
 *
 * "Plan de Agua por Botellas Completas" — a rider refills at a fountain or
 * gasolinera in whole bottles, never a fractional volume ("939ml") they'd
 * need a measuring cup for on the road. Takes `stopsNeeded` (already
 * computed live from the athlete's real cage count × the *current* bottle
 * size, see that computation's own doc comment above) and states the plan
 * purely in terms of full bottles — `${bottleCount}x ${bottleCapacityMl}ml
 * completos` — rather than a per-stop ml figure. Always returns a real
 * message (never `[]`) so the athlete sees an explicit "ya te alcanza"
 * confirmation when no refill is needed, not silence. */
function getWaterPlanLine(stopsNeeded: number, bottleCount: number, bottleCapacityMl: number): string {
  if (stopsNeeded <= 0) return "Suficiente con el agua instalada en la bici.";
  return `${stopsNeeded} ${stopsNeeded === 1 ? "parada" : "paradas"} en ruta (rellenar ${bottleCount}x ${bottleCapacityMl}ml completos)`;
}

function getPocketManifestItems(
  pocketFood: Partial<Record<PocketFoodItemType, number>>,
  customCarbsG: number
): ManifestItem[] {
  const items: ManifestItem[] = [];
  for (const type of POCKET_FOOD_TYPES) {
    const qty = pocketFood[type] ?? 0;
    if (qty > 0) {
      items.push({
        key: type,
        quantity: qty,
        name: pocketFoodName(type),
        // Total for the whole line (per-unit carbs × quantity), not a
        // per-unit figure — the quantity badge already shows "Nx", so the
        // spec line answers "how many carbs is this line carrying" at a
        // glance rather than making the athlete multiply it themselves.
        specs: `${POCKET_FOOD_CARBS_G[type] * qty}g HC`,
      });
    }
  }
  // No natural count for a free-grams entry — no quantity badge, the gram
  // figure itself is already the one number that matters here.
  if (customCarbsG > 0) {
    items.push({ key: "custom", quantity: null, name: "Personalizado", specs: `${customCarbsG}g HC` });
  }
  return items;
}

/** "Desvinculación de Paradas del Cálculo de Carbohidratos" — a planned
 * café/gasolinera/fuente stop used to auto-generate a suggested purchase
 * ("1 Refresco + 1 Bollo, ~171g HC") and silently credit that estimate
 * toward `coveredCarbsG`, which meant Card 04 could show a fully-covered
 * RESTANTE: 0g HC the moment the athlete picked "1 Parada" — before
 * choosing a single real bottle or pocket-food item. Removed outright, not
 * just hidden: `cafeteriaStopCount` is now a pure logistics input (how many
 * road-side stops are planned, full stop) with no carb-suggestion engine
 * behind it at all — see `coveredCarbsG`'s own doc comment below for what
 * still counts toward home-load coverage. */
type CafeteriaStopCount = 0 | 1 | 2;

// "Botones de Selección Rápida" — no sub-menus, one tap picks the whole
// plan. The "(Sugerido)" suffix on "1 Parada" was dropped outright (not
// abbreviated) — "Bug Fix de Botones e Inputs" found it truncating to
// "1 Parada (Sug..." on a real iPhone, since the label had to share a
// 3-column row with "Sin paradas"/"2 Paradas" with no room to spare.
const CAFETERIA_STOP_COUNT_OPTIONS: { value: CafeteriaStopCount; label: string }[] = [
  { value: 0, label: "Sin paradas" },
  { value: 1, label: "1 Parada" },
  { value: 2, label: "2 Paradas" },
];

type DepartureDayMode = "today" | "tomorrow" | "custom";

const DEPARTURE_DAY_MODE_OPTIONS: { value: DepartureDayMode; label: string }[] = [
  { value: "today", label: "Hoy" },
  { value: "tomorrow", label: "Mañana" },
  { value: "custom", label: "Elegir fecha" },
];

/** `YYYY-MM-DD` for today — the `<input type="date">`'s `min` (no planning
 * into the past) and the initial value when switching into "Elegir fecha". */
function todayIsoDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Combines a day mode (today/tomorrow/a specific `YYYY-MM-DD`) and an
 * "HH:mm" hour selection into the local datetime string the calculation
 * request expects. Planning a ride weeks or months out (an event, a trip)
 * is exactly what "Elegir fecha" is for — unlike the two quick pills, it
 * isn't bounded to the next day. */
function buildDepartureLocal(dayMode: DepartureDayMode, customDate: string, hour: string): string {
  const date =
    dayMode === "custom" && customDate ? new Date(`${customDate}T00:00:00`) : new Date();
  if (dayMode === "tomorrow") date.setDate(date.getDate() + 1);
  const [h, m] = hour.split(":").map(Number);
  date.setHours(h, m, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function DeparturePicker({
  dayMode,
  onDayModeChange,
  customDate,
  onCustomDateChange,
  hour,
  onHourChange,
  disabled = false,
  isModified = false,
}: {
  dayMode: DepartureDayMode;
  onDayModeChange: (mode: DepartureDayMode) => void;
  customDate: string;
  onCustomDateChange: (date: string) => void;
  hour: string;
  onHourChange: (hour: string) => void;
  disabled?: boolean;
  isModified?: boolean;
}) {
  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={formFieldLabelClass}>Fecha y hora de salida</span>
        {isModified && (
          <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">
            <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
            Modificado
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 *:min-w-0">
        {DEPARTURE_DAY_MODE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onDayModeChange(opt.value)}
            className={cn(
              segmentedButtonClass,
              dayMode === opt.value
                ? "border-transparent bg-[#70685b] text-white hover:bg-[#60594e]"
                : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400",
              disabled && "cursor-not-allowed opacity-60"
            )}
          >
            <span className={segmentedButtonLabelClass}>{opt.label}</span>
          </button>
        ))}
      </div>
      {dayMode === "custom" && (
        // "Corrección de Fecha Móvil" — iOS Safari's native `<input
        // type="date">` renders an internal day/month/year shadow-DOM
        // layout with its own intrinsic minimum content width, which a
        // bare `w-full` (a percentage) doesn't override: the browser still
        // takes `max(100%, that intrinsic min-content)`, so the field can
        // render wider than its flex-column parent and overflow the card's
        // right edge. `min-w-0` overrides the flex item's own default
        // `min-width: auto` (which otherwise refuses to shrink below its
        // content's natural size), `max-w-full` caps it against the
        // wrapper regardless, and `box-sizing: border-box` (already
        // Tailwind's Preflight default, restated here via `box-border` for
        // an explicit, defensive guarantee) keeps the border/padding
        // inside that width rather than adding to it. Applied to both the
        // input itself and its own wrapping `<div>`, since either one
        // alone left room for the shadow-DOM content to still force an
        // overflow on a narrow phone. Kept on the shared `fieldClass`
        // (white background, `px-4 py-2`) rather than switching to a
        // one-off `bg-[#F8F7F5]`/`px-3` — the hour `<select>` right below
        // it also renders via the shared `fieldClass`/`selectableFieldClass`
        // pair (both white), so matching that real sibling exactly is what
        // keeps the two fields' borders/fill genuinely identical.
        //
        // A follow-up report found the overflow still reproducing on real
        // mobile Safari despite all of the above — the underlying cause is
        // that Safari's internal day/month/year segments can render past
        // their own box's CSS width regardless of `box-sizing`/`min-width`
        // (a known engine quirk, not something any width/min-width value
        // can fully constrain from the outside). `overflow-hidden` on the
        // wrapper is a belt-and-suspenders backstop: it guarantees the
        // rendered box can never visually break the card's right edge no
        // matter what width Safari's shadow DOM insists on internally. This
        // is safe specifically because the native date *picker* itself
        // (the wheel/calendar overlay a tap opens) is OS chrome rendered
        // outside normal document flow — like a `<select>`'s own dropdown —
        // so clipping this wrapper's box never clips that overlay too.
        //
        // A second follow-up report ("Aug 1, 2026" visibly breaking the
        // card's right edge) means even that clip wasn't the whole story —
        // every fix up to here constrains this element only *relative* to
        // its own parent chain (`w-full`/`max-w-full`, both percentages),
        // which is only as reliable as every ancestor between here and the
        // viewport also resolving its own width correctly. `max-w-[calc(
        // 100vw-4rem)]` replaces that relative ceiling with an *absolute*
        // one anchored directly to the true viewport width, immune to any
        // percentage-resolution or native shadow-DOM sizing quirk further
        // up the tree — `4rem` (64px) matches this exact nesting's real
        // horizontal padding on mobile (`<main>`'s own `px-4` in
        // `components/dashboard-shell.tsx` + this card's own `p-4`, 16px +
        // 16px per side). Applied to both the wrapper *and* the input
        // itself, since either alone left room for the other to still
        // compute its own width against a bad ancestor value.
        //
        // A third follow-up report, still on real iOS Safari, traced this to
        // its actual root cause rather than another sizing ceiling: WebKit
        // renders this input's day/month/year value through its own
        // internal `::-webkit-date-and-time-value` pseudo-element, which
        // carries its own default intrinsic width/margin that every
        // `width`/`max-width` value set on the *input itself* simply doesn't
        // reach — those constrain the input's own box, not the shadow
        // pseudo-element painted inside it. `appearance-none` (dropping
        // WebKit's default chrome around the field) plus explicit
        // `[&::-webkit-date-and-time-value]:...` Tailwind arbitrary
        // variants — a no-op on every non-WebKit browser, since the
        // pseudo-element selector itself simply doesn't match there — reset
        // that inner value to `w-full`/`m-0`/`text-left` so it's finally
        // constrained by the *same* box the outer width rules above already
        // pin to the viewport. `app/globals.css` carries the same reset as
        // a plain-CSS fallback (see the `input[type="date"]` rule there) in
        // case a future refactor moves this input outside Tailwind's own
        // arbitrary-variant reach.
        <div className="w-full max-w-[calc(100vw-4rem)] min-w-0 overflow-hidden box-border">
          <input
            type="date"
            aria-label="Fecha de salida"
            min={todayIsoDate()}
            value={customDate}
            disabled={disabled}
            onChange={(e) => onCustomDateChange(e.target.value)}
            className={cn(
              fieldClass,
              "block w-full max-w-[calc(100vw-4rem)] min-w-0 box-border appearance-none",
              "[&::-webkit-date-and-time-value]:m-0 [&::-webkit-date-and-time-value]:w-full [&::-webkit-date-and-time-value]:min-w-0 [&::-webkit-date-and-time-value]:p-0 [&::-webkit-date-and-time-value]:text-left",
              disabled && "cursor-not-allowed opacity-60"
            )}
          />
        </div>
      )}
      <div className="relative">
        <select
          aria-label="Hora de salida"
          disabled={disabled}
          className={cn(selectableFieldClass, disabled && "cursor-not-allowed opacity-60")}
          value={hour}
          onChange={(e) => onHourChange(e.target.value)}
        >
          {DEPARTURE_HOUR_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <ChevronDown className={selectChevronClass} />
      </div>
    </div>
  );
}

// Generalized off `PocketFoodItemType` (a plain `label`/`carbsG`/`ariaLabel`
// triad instead) so this row's own props stay decoupled from the catalog's
// own `PocketFoodItemType` union — every call site still resolves its
// figures from the real catalog (`pocketFoodName`/`POCKET_FOOD_CARBS_G`/
// `pocketFoodLabels`), but the component itself doesn't need to know that.
// "Limpieza de Badges Redundantes" — this row used to lead with a
// `[ GEL ]`/`[ SÓLIDO ]`/`[ LÍQUIDO ]`/`[ FÓRMULA ]` category tag before the
// item's own name; removed outright (not just visually — the whole
// `PocketFoodCategory` classification/lookup is gone) so the product name
// gets the full available width and the eye lands on it immediately rather
// than on a bracketed label first. The carb figure stays, in the same
// muted monospace it already had.
function PocketFoodStepperRow({
  label,
  carbsG,
  ariaLabel,
  qty,
  onChange,
  disabled = false,
}: {
  label: string;
  carbsG: number;
  ariaLabel: string;
  qty: number;
  onChange: (qty: number) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        // One consistent list-row treatment at every breakpoint — a thin
        // `border-zinc-100` divider, `last:border-b-0` so the final item
        // doesn't carry a trailing rule. Replaces an earlier "full border
        // box at md:" variant (this row sat in a plain `border-b`-only list
        // on mobile, but gained a `md:border` full box once the grid became
        // 2 columns) — that asymmetry read as two different components at
        // different widths; a uniform list row is simpler and matches every
        // other list treatment in this app. `py-2.5` is strictly symmetric
        // (Tailwind's `py-*` always sets top and bottom equally) — the
        // original imbalance bug traced back to *switching* padding values
        // across breakpoints (`py-2.5` mobile / `md:py-1.5` desktop, paired
        // with a border-b-only-vs-full-border switch too), not to `2.5`
        // itself; a single flat `py-2.5` at every width (down from an
        // intermediate `py-3.5`, per a later "reduce and equalize" request)
        // is just as symmetric and reads as a tighter, less congested list.
        // Stepped down once more to `py-2` ("Diseño Compacto Móvil" —
        // the inventory now always shows the full catalog unconditionally,
        // so trimming each row's own footprint matters more for minimizing
        // scroll on a small screen than it used to).
        "flex items-center justify-between gap-2 border-b border-zinc-100 py-2 last:border-b-0",
        disabled && "opacity-50"
      )}
    >
      {/* No category badge anymore — the name gets the full available
          width. `truncate` (not `whitespace-normal`) on the name itself so
          a long product name stays on one line rather than wrapping the
          row taller; the carb figure is `shrink-0` so it's never what gets
          squeezed. */}
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 truncate text-sm text-neutral-900">{label}</span>
        <span className="shrink-0 font-mono text-xs text-zinc-500">{carbsG}g HC</span>
      </span>
      {/* Compact, transparent, delineated stepper — a hairline
          `border-zinc-200` is what defines this control now (the prior
          `bg-zinc-100` solid fill was dropped in favor of a clean outline on
          a transparent background), reduced to `h-7`/`min-w-[80px]` and
          tighter `px-2 py-0.5` so it reads as a small compact widget rather
          than a full-size button. `rounded-sm` — a later "radio de bordes
          pequeño global" pass reversed this control's earlier `rounded-full`
          capsule geometry (itself a deliberate exception to every other
          selector's `rounded-lg`) back to the same flat, technical
          `rounded-sm` every other selector in the app now shares, so the
          stepper no longer reads as a categorically different control type. */}
      <div className="flex h-7 min-w-20 items-center justify-between rounded-sm border border-zinc-200 bg-transparent px-2 py-0.5">
        <button
          type="button"
          onClick={() => onChange(qty - 1)}
          disabled={disabled}
          className="flex size-5 cursor-pointer items-center justify-center text-sm leading-none font-normal text-zinc-600 transition-colors hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Quitar ${ariaLabel}`}
        >
          −
        </button>
        <span className="min-w-4 px-1 text-center font-sans text-xs font-medium text-zinc-800 tabular-nums">
          {qty}
        </span>
        <button
          type="button"
          onClick={() => onChange(qty + 1)}
          disabled={disabled}
          className="flex size-5 cursor-pointer items-center justify-center text-sm leading-none font-normal text-zinc-600 transition-colors hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Añadir ${ariaLabel}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function StintStrategyTimeline({
  cafeteriaStopCount,
  durationHours,
  distanceKm,
  entries,
  remainingCarbsG,
}: {
  cafeteriaStopCount: CafeteriaStopCount;
  durationHours: number;
  distanceKm: number | null;
  entries: {
    key: string;
    atMinutes: number;
    atKm: number | null;
    icon: string;
    label: string;
    approx: boolean;
  }[];
  remainingCarbsG: number;
}) {
  const totalMins = Math.round(durationHours * 60);

  const formatMins = (mins: number) => {
    if (mins < 60) return `Min ${Math.round(mins)}`;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const renderEntry = (entry: (typeof entries)[0], i: number, arrLen: number) => (
    <li key={entry.key} className="relative flex gap-3 pb-3 last:pb-0">
      {i < arrLen - 1 && (
        <span aria-hidden className="absolute top-3 left-1.25 h-full w-px bg-neutral-200" />
      )}
      <span
        aria-hidden
        className="relative z-10 mt-1 size-2.5 shrink-0 rounded-full bg-neutral-900"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-[10px] font-semibold text-neutral-400">
          {entry.approx ? "~" : ""}
          {entry.atKm != null ? `Km ${entry.atKm}` : `Min ${entry.atMinutes}`}
        </span>
        <span className="flex items-center gap-2 font-mono text-xs text-neutral-900">
          {entry.icon === "solid" && <Utensils className="size-3.5 shrink-0 text-neutral-700" />}
          {entry.icon === "gel" && <Zap className="size-3.5 shrink-0 text-neutral-700" />}
          {entry.icon === "caffeine" && <FlaskConical className="size-3.5 shrink-0 text-neutral-700" />}
          {entry.label}
        </span>
      </div>
    </li>
  );

  const renderStopCard = (stopNum: number, stopMins: number, stopKm: number | null) => (
    <div className="my-3 rounded-md border border-neutral-200/80 bg-neutral-50/90 p-3.5 shadow-xs">
      <div className="flex items-center gap-2">
        <span className="rounded-xs bg-neutral-900 px-2 py-0.5 font-mono text-[10px] font-semibold text-white uppercase tracking-wide">
          Parada {stopNum}
        </span>
        <span className="font-mono text-xs font-semibold text-neutral-900">
          {stopKm != null ? `Km ~${stopKm}` : ""} · ~{formatMins(stopMins)}
        </span>
      </div>
      <div className="mt-2.5 space-y-1.5 pl-0.5">
        <div className="flex items-center gap-2 font-mono text-xs text-neutral-700">
          <Droplets className="size-3.5 shrink-0 text-neutral-900" />
          <span>Rellenar bidones con agua + electrolitos</span>
        </div>
        {remainingCarbsG > 0 ? (
          <div className="flex items-center gap-2 font-mono text-xs text-neutral-700">
            <ShoppingBag className="size-3.5 shrink-0 text-neutral-900" />
            <span>Comprar reposición de carbohidratos (~{remainingCarbsG}g HC)</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 font-mono text-xs font-semibold text-neutral-900">
            <CheckCircle2 className="size-3.5 shrink-0 text-amber-500" />
            <span>Solo rellenar bidones de agua (cobertura de carbohidratos completa desde casa)</span>
          </div>
        )}
      </div>
    </div>
  );

  if (cafeteriaStopCount === 0) {
    return (
      <div className="mt-3 border-t border-zinc-200 pt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between font-mono text-[11px] font-bold text-zinc-600">
          <span>Tramo Único (Salida → Meta)</span>
          <span className="font-normal text-zinc-400">100% de la salida</span>
        </div>
        {entries.length > 0 ? (
          <ol className="mt-1 flex flex-col">
            {entries.map((entry, i) => renderEntry(entry, i, entries.length))}
          </ol>
        ) : (
          <p className="font-mono text-xs text-zinc-400">Sin ingestas programadas para este tramo.</p>
        )}
      </div>
    );
  }

  if (cafeteriaStopCount === 1) {
    const halfMins = totalMins * 0.5;
    const halfKm = distanceKm != null ? Math.round(distanceKm * 0.5) : null;
    const stint1Entries = entries.filter((e) => e.atMinutes <= halfMins);
    const stint2Entries = entries.filter((e) => e.atMinutes > halfMins);

    return (
      <div className="mt-3 border-t border-zinc-200 pt-3 flex flex-col gap-4">
        {/* Tramo 1 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between font-mono text-[11px] font-bold text-zinc-700">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-zinc-700" />
              Tramo 1 (Salida → Parada 1)
            </span>
            <span className="text-zinc-400 font-normal">0% - 50%</span>
          </div>
          {stint1Entries.length > 0 ? (
            <ol className="mt-1 flex flex-col">
              {stint1Entries.map((entry, i) => renderEntry(entry, i, stint1Entries.length))}
            </ol>
          ) : (
            <p className="font-mono text-xs text-zinc-400 pl-3">Sin ingestas en este tramo.</p>
          )}
        </div>

        {/* Hito Intermedio: Parada 1 */}
        {renderStopCard(1, halfMins, halfKm)}

        {/* Tramo 2 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between font-mono text-[11px] font-bold text-zinc-700">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-zinc-700" />
              Tramo 2 (Parada 1 → Meta)
            </span>
            <span className="text-zinc-400 font-normal">50% - 100%</span>
          </div>
          {stint2Entries.length > 0 ? (
            <ol className="mt-1 flex flex-col">
              {stint2Entries.map((entry, i) => renderEntry(entry, i, stint2Entries.length))}
            </ol>
          ) : (
            <p className="font-mono text-xs text-zinc-400 pl-3">Sin ingestas en este tramo.</p>
          )}
        </div>
      </div>
    );
  }

  // cafeteriaStopCount === 2
  const third1Mins = totalMins * 0.33;
  const third2Mins = totalMins * 0.66;
  const stop1Km = distanceKm != null ? Math.round(distanceKm * 0.33) : null;
  const stop2Km = distanceKm != null ? Math.round(distanceKm * 0.66) : null;

  const stint1Entries = entries.filter((e) => e.atMinutes <= third1Mins);
  const stint2Entries = entries.filter((e) => e.atMinutes > third1Mins && e.atMinutes <= third2Mins);
  const stint3Entries = entries.filter((e) => e.atMinutes > third2Mins);

  return (
    <div className="mt-3 border-t border-zinc-200 pt-3 flex flex-col gap-4">
      {/* Tramo 1 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between font-mono text-[11px] font-bold text-zinc-700">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-zinc-700" />
            Tramo 1 (Salida → Parada 1)
          </span>
          <span className="text-zinc-400 font-normal">0% - 33%</span>
        </div>
        {stint1Entries.length > 0 ? (
          <ol className="mt-1 flex flex-col">
            {stint1Entries.map((entry, i) => renderEntry(entry, i, stint1Entries.length))}
          </ol>
        ) : (
          <p className="font-mono text-xs text-zinc-400 pl-3">Sin ingestas en este tramo.</p>
        )}
      </div>

      {/* Parada 1 */}
      {renderStopCard(1, third1Mins, stop1Km)}

      {/* Tramo 2 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between font-mono text-[11px] font-bold text-zinc-700">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-zinc-700" />
            Tramo 2 (Parada 1 → Parada 2)
          </span>
          <span className="text-zinc-400 font-normal">33% - 66%</span>
        </div>
        {stint2Entries.length > 0 ? (
          <ol className="mt-1 flex flex-col">
            {stint2Entries.map((entry, i) => renderEntry(entry, i, stint2Entries.length))}
          </ol>
        ) : (
          <p className="font-mono text-xs text-zinc-400 pl-3">Sin ingestas en este tramo.</p>
        )}
      </div>

      {/* Parada 2 */}
      {renderStopCard(2, third2Mins, stop2Km)}

      {/* Tramo 3 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between font-mono text-[11px] font-bold text-zinc-700">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-zinc-700" />
            Tramo 3 (Parada 2 → Meta)
          </span>
          <span className="text-zinc-400 font-normal">66% - 100%</span>
        </div>
        {stint3Entries.length > 0 ? (
          <ol className="mt-1 flex flex-col">
            {stint3Entries.map((entry, i) => renderEntry(entry, i, stint3Entries.length))}
          </ol>
        ) : (
          <p className="font-mono text-xs text-zinc-400 pl-3">Sin ingestas en este tramo.</p>
        )}
      </div>
    </div>
  );
}

export function FuelingPlanner({
  routes,
  ftp,
  weightKg,
  experienceMode: initialExperienceMode = "standard",
  isProfileComplete,
}: {
  routes: StravaRoute[];
  ftp: number;
  weightKg: number;
  experienceMode?: ExperienceMode;
  isProfileComplete: boolean;
}) {
  const [experienceMode, _setExperienceMode] = useState<ExperienceMode>(initialExperienceMode);

  /** Persists `experienceMode` to localStorage so that a page reload keeps
   *  the selection intact without requiring another DB round-trip. */
  const setExperienceMode = (mode: ExperienceMode) => {
    _setExperienceMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("ratio_experience_mode", mode);
    }
  };

  // On mount: if the server-rendered prop is the "standard" fallback but the
  // athlete actually saved "advanced" in localStorage on a prior visit, honour
  // the local preference (prevents a flash of wrong mode before rehydration).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("ratio_experience_mode") as ExperienceMode | null;
    if (stored === "standard" || stored === "advanced") {
      _setExperienceMode(stored);
    }
    // Only runs once on mount — intentional empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const [mode, setMode] = useState<"route" | "quick" | "gpx">(routes.length > 0 ? "route" : "quick");
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [gpxUploadOpen, setGpxUploadOpen] = useState(false);

  const [routeIntensity, setRouteIntensity] = useState<IntensityLevel | "">("");
  const [manualIntensity, setManualIntensity] = useState<IntensityLevel | "">("");
  const intensity = mode === "quick" ? manualIntensity : routeIntensity;
  const setIntensity = (val: IntensityLevel | "") => {
    if (mode === "quick") {
      setManualIntensity(val);
    } else {
      setRouteIntensity(val);
    }
  };

  const [manualTerrain, setManualTerrain] = useState<ManualTerrain>("medium_mountain");
  const [manualCalcMode, setManualCalcMode] = useState<ManualCalcMode>("time");
  const [quickHoursInput, setQuickHoursInput] = useState("");
  const [quickMinutesInput, setQuickMinutesInput] = useState("");
  const [manualDistanceKmInput, setManualDistanceKmInput] = useState("");
  const [manualCustomDistanceInput, setManualCustomDistanceInput] = useState("");
  const [manualDurationOverride, setManualDurationOverride] = useState<{ hours: string; minutes: string } | null>(null);

  const [routeResult, setRouteResult] = useState<PlanResult | null>(null);
  const [routeHasCalculatedOnce, setRouteHasCalculatedOnce] = useState(false);
  const [routeLastCalculatedInputs, setRouteLastCalculatedInputs] = useState<CalculatedInputsSnapshot | null>(null);

  const [manualResult, setManualResult] = useState<PlanResult | null>(null);
  const [manualHasCalculatedOnce, setManualHasCalculatedOnce] = useState(false);
  const [manualLastCalculatedInputs, setManualLastCalculatedInputs] = useState<CalculatedInputsSnapshot | null>(null);

  const activeModeGroup = mode === "quick" ? "manual" : "route";
  const result = activeModeGroup === "manual" ? manualResult : routeResult;
  const hasCalculatedOnce = activeModeGroup === "manual" ? manualHasCalculatedOnce : routeHasCalculatedOnce;
  const activeLastCalculatedInputs = activeModeGroup === "manual" ? manualLastCalculatedInputs : routeLastCalculatedInputs;

  const [routeDepartureDayMode, setRouteDepartureDayMode] = useState<DepartureDayMode>("today");
  const [routeDepartureCustomDate, setRouteDepartureCustomDate] = useState(todayIsoDate);
  const [routeDepartureHour, setRouteDepartureHour] = useState(getRoundedCurrentHour);
  const [routeIsTargetEvent, setRouteIsTargetEvent] = useState(false);
  const [routeTrainLow, setRouteTrainLow] = useState(false);
  const [routeCafeteriaStopCount, setRouteCafeteriaStopCount] = useState<CafeteriaStopCount>(0);

  const [manualDepartureDayMode, setManualDepartureDayMode] = useState<DepartureDayMode>("today");
  const [manualDepartureCustomDate, setManualDepartureCustomDate] = useState(todayIsoDate);
  const [manualDepartureHour, setManualDepartureHour] = useState(getRoundedCurrentHour);
  const [manualIsTargetEvent, setManualIsTargetEvent] = useState(false);
  const [manualTrainLow, setManualTrainLow] = useState(false);
  const [manualCafeteriaStopCount, setManualCafeteriaStopCount] = useState<CafeteriaStopCount>(0);

  const [routePreRideGlycogenLoad, setRoutePreRideGlycogenLoad] = useState<PreRideGlycogenLoad>("normal");
  const [routeLastMealTiming, setRouteLastMealTiming] = useState<LastMealTiming>("1_2h");

  const [manualPreRideGlycogenLoad, setManualPreRideGlycogenLoad] = useState<PreRideGlycogenLoad>("normal");
  const [manualLastMealTiming, setManualLastMealTiming] = useState<LastMealTiming>("1_2h");

  const preRideGlycogenLoad = mode === "quick" ? manualPreRideGlycogenLoad : routePreRideGlycogenLoad;
  const setPreRideGlycogenLoad = mode === "quick" ? setManualPreRideGlycogenLoad : setRoutePreRideGlycogenLoad;

  const lastMealTiming = mode === "quick" ? manualLastMealTiming : routeLastMealTiming;
  const setLastMealTiming = mode === "quick" ? setManualLastMealTiming : setRouteLastMealTiming;

  const departureDayMode = mode === "quick" ? manualDepartureDayMode : routeDepartureDayMode;
  const setDepartureDayMode = mode === "quick" ? setManualDepartureDayMode : setRouteDepartureDayMode;

  const departureCustomDate = mode === "quick" ? manualDepartureCustomDate : routeDepartureCustomDate;
  const setDepartureCustomDate = mode === "quick" ? setManualDepartureCustomDate : setRouteDepartureCustomDate;

  const departureHour = mode === "quick" ? manualDepartureHour : routeDepartureHour;
  const setDepartureHour = mode === "quick" ? setManualDepartureHour : setRouteDepartureHour;

  const isTargetEvent = mode === "quick" ? manualIsTargetEvent : routeIsTargetEvent;
  const setIsTargetEvent = mode === "quick" ? setManualIsTargetEvent : setRouteIsTargetEvent;

  const trainLow = mode === "quick" ? manualTrainLow : routeTrainLow;
  const setTrainLow = mode === "quick" ? setManualTrainLow : setRouteTrainLow;

  const cafeteriaStopCount = mode === "quick" ? manualCafeteriaStopCount : routeCafeteriaStopCount;
  const setCafeteriaStopCount = mode === "quick" ? setManualCafeteriaStopCount : setRouteCafeteriaStopCount;

  const departureLocal = useMemo(
    () => buildDepartureLocal(departureDayMode, departureCustomDate, departureHour),
    [departureDayMode, departureCustomDate, departureHour]
  );
  const trainLowIncompatible =
    isTargetEvent || (intensity !== "" && intensity !== "recovery" && intensity !== "endurance");
  const trainLowEffective = trainLow && !trainLowIncompatible;
  // "Aislamiento Total de Estado de Logística (Paso 04)" (Strava/GPX vs Entreno Manual)
  const [routePocketFood, setRoutePocketFood] = useState<Partial<Record<PocketFoodItemType, number>>>({});
  const [routeCustomCarbsG, setRouteCustomCarbsG] = useState(0);
  const [routeCommercialProducts, setRouteCommercialProducts] = useState<Record<string, number>>({});
  const [routeBottleConfig, setRouteBottleConfig] = useState<BottleConfigOption>(DEFAULT_BOTTLE_CONFIG);
  const [routeBottleCapacityOverrideMl, setRouteBottleCapacityOverrideMl] = useState<number | null>(null);

  const [manualPocketFood, setManualPocketFood] = useState<Partial<Record<PocketFoodItemType, number>>>({});
  const [manualCustomCarbsG, setManualCustomCarbsG] = useState(0);
  const [manualCommercialProducts, setManualCommercialProducts] = useState<Record<string, number>>({});
  const [manualBottleConfig, setManualBottleConfig] = useState<BottleConfigOption>(DEFAULT_BOTTLE_CONFIG);
  const [manualBottleCapacityOverrideMl, setManualBottleCapacityOverrideMl] = useState<number | null>(null);

  const pocketFood = mode === "quick" ? manualPocketFood : routePocketFood;
  const setPocketFood: React.Dispatch<React.SetStateAction<Partial<Record<PocketFoodItemType, number>>>> = (action) => {
    if (mode === "quick") {
      setManualPocketFood(action);
    } else {
      setRoutePocketFood(action);
    }
  };

  const customCarbsG = mode === "quick" ? manualCustomCarbsG : routeCustomCarbsG;
  const setCustomCarbsG: React.Dispatch<React.SetStateAction<number>> = (action) => {
    if (mode === "quick") {
      setManualCustomCarbsG(action);
    } else {
      setRouteCustomCarbsG(action);
    }
  };

  const commercialProducts = mode === "quick" ? manualCommercialProducts : routeCommercialProducts;
  const setCommercialProducts: React.Dispatch<React.SetStateAction<Record<string, number>>> = (action) => {
    if (mode === "quick") {
      setManualCommercialProducts(action);
    } else {
      setRouteCommercialProducts(action);
    }
  };

  const bottleConfig = mode === "quick" ? manualBottleConfig : routeBottleConfig;
  const setBottleConfig: React.Dispatch<React.SetStateAction<BottleConfigOption>> = (action) => {
    if (mode === "quick") {
      setManualBottleConfig(action);
    } else {
      setRouteBottleConfig(action);
    }
  };

  const bottleCapacityOverrideMl = mode === "quick" ? manualBottleCapacityOverrideMl : routeBottleCapacityOverrideMl;
  const setBottleCapacityOverrideMl: React.Dispatch<React.SetStateAction<number | null>> = (action) => {
    if (mode === "quick") {
      setManualBottleCapacityOverrideMl(action);
    } else {
      setRouteBottleCapacityOverrideMl(action);
    }
  };

  const [commercialProductsSheetOpen, setCommercialProductsSheetOpen] = useState(false);
  const fuelingMode: FuelingMode = "inventory";
  const [bottleCapacityEditorOpen, setBottleCapacityEditorOpen] = useState(false);
  const [showBikeScoops, setShowBikeScoops] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Validación Secuencial Inteligente" — `handleCalculate` below checks
  // Paso 01 (route/GPX/duration) before Paso 02 (intensity), one at a
  // time, rather than reporting both gaps in one combined check — so the
  // athlete is always guided to fix exactly one thing at a time, in the
  // order the form itself reads top to bottom.
  const [routeError, setRouteError] = useState(false);
  const [intensityError, setIntensityError] = useState(false);
  const [isOfflineCache, setIsOfflineCache] = useState(false);
  const [parsedGpx, setParsedGpx] = useState<ParsedGpxRoute | null>(null);
  // "Tiempo Estimado Condicionado a la Intensidad" — blank (no default
  // duration guessed at all) until an intensity zone is chosen, then
  // auto-computed via `estimateRideDurationHours()` (this app's own real
  // FTP/peso/VAM physics model, using the athlete's actual profile —
  // `ftp`/`weightKg` props) — for both Ruta and GPX mode. Deliberately
  // *not* synced via a `useEffect` (React's own `set-state-in-effect` lint
  // rule flags a synchronous `setState` used purely to derive one value
  // from another — see https://react.dev/learn/you-might-not-need-an-effect):
  // the default is recomputed fresh during render (`gpxDurationDefault`/
  // `routeDurationDefault` below), tagged with whichever route/GPX +
  // intensity it belongs to, so switching either automatically reverts to
  // a fresh estimate for the new inputs with no reset call needed. Only an
  // actual manual edit is ever written to state — and only then does
  // `handleCalculate` send a real `durationHoursOverride`, leaving
  // `estimateRideDurationHours()` in charge of every calculation the
  // athlete hasn't explicitly overridden.
  const [gpxDurationOverride, setGpxDurationOverride] = useState<{
    intensity: IntensityLevel | "";
    hoursInput: string;
    minutesInput: string;
  } | null>(null);
  const [routeDurationOverride, setRouteDurationOverride] = useState<{
    routeId: string;
    intensity: IntensityLevel | "";
    hoursInput: string;
    minutesInput: string;
  } | null>(null);
  const [gpxError, setGpxError] = useState<string | null>(null);
  const [isDraggingGpx, setIsDraggingGpx] = useState(false);
  const [refreshingRoutes, setRefreshingRoutes] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // "Flujo Deliberado de Generación para Card 05" — `isManifestGenerated`
  // gates Card 05's entire body behind an explicit "Generar Manifiesto de
  // Salida" click (see the button at the foot of Card 04 and
  // `handleGenerateManifest` below) rather than rendering live off every
  // Card 04 inventory edit. `manifestSnapshot` is the inventory as it stood
  // at that click — compared against the *current* live inventory on every
  // render (`isPlanDirty` below) to decide whether the already-generated
  // manifest needs a deliberate refresh. Both reset to their initial state
  // whenever a brand-new calculation succeeds (see `handleCalculate`'s
  // success branch) — a new `result` has no manifest generated against it
  // yet, regardless of whether the previous one did.
  //
  // Split into `route*`/`manual*` pairs — same "Aislamiento Total de Estado"
  // convention every other Card 03/04 field already follows (`pocketFood`,
  // `bottleConfig`, etc.) and the same `activeModeGroup` grouping `result`
  // itself already uses — so switching Strava/GPX ↔ Manual can never leak
  // one mode's "ya generado"/stale-inventory state onto the other mode's
  // own (possibly already-calculated) `result`.
  const [routeIsManifestGenerated, setRouteIsManifestGenerated] = useState(false);
  const [routeManifestSnapshot, setRouteManifestSnapshot] = useState<InventorySnapshot | null>(null);
  const [manualIsManifestGenerated, setManualIsManifestGenerated] = useState(false);
  const [manualManifestSnapshot, setManualManifestSnapshot] = useState<InventorySnapshot | null>(null);
  const isManifestGenerated =
    activeModeGroup === "manual" ? manualIsManifestGenerated : routeIsManifestGenerated;
  const setIsManifestGenerated = (value: boolean) => {
    if (activeModeGroup === "manual") setManualIsManifestGenerated(value);
    else setRouteIsManifestGenerated(value);
  };
  const manifestSnapshot =
    activeModeGroup === "manual" ? manualManifestSnapshot : routeManifestSnapshot;
  const setManifestSnapshot = (value: InventorySnapshot | null) => {
    if (activeModeGroup === "manual") setManualManifestSnapshot(value);
    else setRouteManifestSnapshot(value);
  };
  const card05Ref = useRef<HTMLDivElement>(null);

  // Bypasses `getStravaRoutes()`'s 24h cache (see `lib/dashboard-data.ts`) on
  // demand — an athlete who just starred a new route on Strava shouldn't
  // have to wait up to a day for it to show up here.
  async function handleRefreshRoutes() {
    setRefreshingRoutes(true);
    try {
      await refreshStravaRoutes();
      router.refresh();
    } finally {
      setRefreshingRoutes(false);
    }
  }

  // "Entreno Manual Avanzado: Cálculo Bidireccional de Velocidad y Duración/Distancia"
  const projectedSpeedKmh = useMemo(
    () => getProjectedSpeedKmh({ ftp, weightKg, intensity: manualIntensity, terrain: manualTerrain }),
    [ftp, weightKg, manualIntensity, manualTerrain]
  );

  const manualCalcResults = useMemo(() => {
    if (manualCalcMode === "time") {
      const timeDurationHours = (Number(quickHoursInput) || 0) + (Number(quickMinutesInput) || 0) / 60;
      const customDist = Number(manualCustomDistanceInput);
      const isDistanceEdited = manualCustomDistanceInput !== "" && !isNaN(customDist) && customDist > 0;
      const distanceKm = isDistanceEdited ? customDist : Math.round(timeDurationHours * projectedSpeedKmh * 10) / 10;
      const effectiveSpeed = timeDurationHours > 0 ? Math.round((distanceKm / timeDurationHours) * 10) / 10 : projectedSpeedKmh;
      return {
        durationHours: timeDurationHours,
        distanceKm,
        effectiveSpeedKmh: effectiveSpeed,
        isDistanceEdited,
        isDurationEdited: false,
        hoursInput: quickHoursInput,
        minutesInput: quickMinutesInput,
      };
    } else {
      const distKm = Number(manualDistanceKmInput) || 0;
      const terrainOpt = MANUAL_TERRAIN_OPTIONS.find((t) => t.id === manualTerrain) ?? MANUAL_TERRAIN_OPTIONS[1];
      const elevationGainM = distKm * terrainOpt.elevationMPerKm;
      const estHours = distKm > 0
        ? estimateRideDurationHours({
            distanceKm: distKm,
            elevationGainM,
            ftp: ftp || 200,
            weightKg: weightKg || 70,
            intensity: manualIntensity || "endurance",
          })
        : 0;
      const isDurationEdited = manualDurationOverride !== null;
      const hoursInput = isDurationEdited ? manualDurationOverride.hours : (distKm > 0 ? decimalHoursToParts(estHours).hours : "");
      const minutesInput = isDurationEdited ? manualDurationOverride.minutes : (distKm > 0 ? decimalHoursToParts(estHours).minutes : "");
      const durationHours = isDurationEdited
        ? (Number(hoursInput) || 0) + (Number(minutesInput) || 0) / 60
        : estHours;
      const effectiveSpeed = durationHours > 0 ? Math.round((distKm / durationHours) * 10) / 10 : projectedSpeedKmh;
      return {
        durationHours,
        distanceKm: distKm,
        effectiveSpeedKmh: effectiveSpeed,
        isDistanceEdited: false,
        isDurationEdited,
        hoursInput,
        minutesInput,
      };
    }
  }, [
    manualCalcMode,
    quickHoursInput,
    quickMinutesInput,
    manualCustomDistanceInput,
    manualDistanceKmInput,
    manualTerrain,
    manualDurationOverride,
    projectedSpeedKmh,
    ftp,
    weightKg,
    manualIntensity,
  ]);

  const quickDurationHours = manualCalcResults.durationHours;
  const quickValid = quickDurationHours > 0 && manualIntensity !== "";

  // "Algoritmo Físico Dinámico" — blank (`{ hours: "", minutes: "" }`) until
  // an intensity zone is actually chosen; once it is, `estimateRideDurationHours()`
  // combines the athlete's real FTP/peso with the zone's own %FTP and the
  // file's real distance/desnivel — the same VAM-based climb estimate +
  // aerodynamic flat-speed model this app's server already uses for a
  // saved Strava route, now also driving this on-screen estimate the
  // instant intensity changes, rather than a generic distance/speed guess
  // with no relationship to how hard the athlete says they'll actually
  // ride.
  const gpxDurationDefault = useMemo(() => {
    if (!parsedGpx || !intensity || !ftp || !weightKg) return { hours: "", minutes: "" };
    const estimatedHours = estimateRideDurationHours({
      distanceKm: parsedGpx.distanceKm,
      elevationGainM: parsedGpx.elevationGainM,
      ftp,
      weightKg,
      intensity,
    });
    return decimalHoursToParts(estimatedHours);
  }, [parsedGpx, intensity, ftp, weightKg]);
  // `gpxDurationOverride` only ever holds a genuine manual edit, tagged
  // with the intensity it was made against — switching intensity makes
  // this tag stop matching, so the two fields below revert to the fresh
  // default above automatically, with no reset needed.
  const gpxDurationOverridden = gpxDurationOverride?.intensity === intensity;
  const gpxHoursInput = gpxDurationOverridden ? gpxDurationOverride.hoursInput : gpxDurationDefault.hours;
  const gpxMinutesInput = gpxDurationOverridden ? gpxDurationOverride.minutesInput : gpxDurationDefault.minutes;
  const gpxDurationHours = Math.max(0.25, (Number(gpxHoursInput) || 0) + (Number(gpxMinutesInput) || 0) / 60);

  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === selectedRouteId) ?? null,
    [routes, selectedRouteId]
  );
  // Decoded once per route change, not on every render — a long ride's
  // polyline can be a few hundred points.
  const selectedRoutePoints = useMemo(
    () => (selectedRoute?.summaryPolyline ? decodePolyline(selectedRoute.summaryPolyline) : null),
    [selectedRoute]
  );
  // "Mini-Gráfico de Altimetría Universal" — a selected Strava route has no
  // per-point elevation available client-side the way a parsed GPX file
  // does (see `ElevationSparkline`'s own doc comment), so this fetches it
  // on demand, exactly once per *explicit* route selection (never eagerly
  // for every route in the list), via `GET /api/strava/route-elevation` —
  // a deliberate, scoped exception to this app's usual "never call Strava
  // streams before the athlete actually calculates" rule, made specifically
  // so Step 01's sparkline can render for a Strava route the same way it
  // already does for GPX mode. The fetched profile is tagged with the
  // `routeId` it belongs to, so switching routes hides the stale sparkline
  // immediately (the tag no longer matches `selectedRouteId`) purely by
  // re-deriving `stravaElevationPoints` below — no synchronous "reset to
  // null" setState call at the top of the effect, which is what React's
  // own lint rule flags as an unnecessary render-triggering pattern; every
  // `setState` here only ever happens inside a genuinely async callback.
  const [stravaElevationProfile, setStravaElevationProfile] = useState<{
    routeId: string;
    profile: { distanceFraction: number; elevationM: number }[];
  } | null>(null);
  useEffect(() => {
    if (mode !== "route" || !selectedRouteId) return;
    let cancelled = false;
    fetch(`/api/strava/route-elevation?routeId=${encodeURIComponent(selectedRouteId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { elevationProfile?: { distanceFraction: number; elevationM: number }[] } | null) => {
        if (!cancelled) setStravaElevationProfile({ routeId: selectedRouteId, profile: data?.elevationProfile ?? [] });
      })
      .catch(() => {
        if (!cancelled) setStravaElevationProfile({ routeId: selectedRouteId, profile: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [mode, selectedRouteId]);
  const stravaElevationPoints =
    mode === "route" && stravaElevationProfile?.routeId === selectedRouteId
      ? stravaElevationProfile.profile
      : null;
  // "Algoritmo Físico Dinámico" — blank until an intensity zone is chosen
  // (no generic distance/average-speed guess shown in the meantime), then
  // `estimateRideDurationHours()` combines the athlete's real FTP/peso with
  // the zone's own %FTP and the route's real distance/desnivel — the exact
  // same VAM-based climb estimate + aerodynamic flat-speed model
  // `POST /api/fueling/plan` itself already runs server-side for a route
  // with no historical Strava moving-time to lean on, now also driving
  // this on-screen estimate live as intensity changes.
  const routeDurationDefault = useMemo(() => {
    if (!selectedRoute || !intensity || !ftp || !weightKg) return { hours: "", minutes: "" };
    const estimatedHours = estimateRideDurationHours({
      distanceKm: selectedRoute.distanceKm,
      elevationGainM: selectedRoute.elevationGainM,
      ftp,
      weightKg,
      intensity,
    });
    return decimalHoursToParts(estimatedHours);
  }, [selectedRoute, intensity, ftp, weightKg]);
  // `routeDurationOverride` only ever holds a genuine manual edit, tagged
  // with the route + intensity it was made against — switching either
  // makes this tag stop matching, so the two fields below revert to the
  // fresh default above automatically, with no reset needed.
  const routeDurationOverridden =
    routeDurationOverride?.routeId === selectedRouteId && routeDurationOverride?.intensity === intensity;
  const routeHoursInput = routeDurationOverridden ? routeDurationOverride.hoursInput : routeDurationDefault.hours;
  const routeMinutesInput = routeDurationOverridden
    ? routeDurationOverride.minutesInput
    : routeDurationDefault.minutes;
  const routeDurationHours = Math.max(0.25, (Number(routeHoursInput) || 0) + (Number(routeMinutesInput) || 0) / 60);

  const effectiveDurationHours = useMemo(() => {
    if (mode === "route") return routeDurationHours;
    if (mode === "gpx") return gpxDurationHours;
    return manualCalcResults.durationHours;
  }, [mode, routeDurationHours, gpxDurationHours, manualCalcResults.durationHours]);

  const gpxIdentifier = useMemo(() => {
    if (mode === "gpx" && parsedGpx) {
      return `${parsedGpx.name}_${parsedGpx.distanceKm}_${parsedGpx.elevationGainM}`;
    }
    return "";
  }, [mode, parsedGpx]);

  const currentInputs = useMemo<CalculatedInputsSnapshot>(() => ({
    mode,
    selectedRouteId: mode === "route" ? selectedRouteId : "",
    gpxIdentifier,
    durationHours: effectiveDurationHours,
    intensity,
    departureDayMode,
    departureCustomDate,
    departureHour,
    isTargetEvent,
    trainLowEffective,
    cafeteriaStopCount,
    manualTerrain,
    manualCalcMode,
    manualDistanceKm: mode === "quick" ? manualCalcResults.distanceKm : 0,
    preRideGlycogenLoad,
    lastMealTiming,
  }), [
    mode,
    selectedRouteId,
    gpxIdentifier,
    effectiveDurationHours,
    intensity,
    departureDayMode,
    departureCustomDate,
    departureHour,
    isTargetEvent,
    trainLowEffective,
    cafeteriaStopCount,
    manualTerrain,
    manualCalcMode,
    manualCalcResults.distanceKm,
    preRideGlycogenLoad,
    lastMealTiming,
  ]);

  const isInputsChanged = useMemo(() => {
    if (!activeLastCalculatedInputs) return false;
    return !areInputsEqual(currentInputs, activeLastCalculatedInputs);
  }, [currentInputs, activeLastCalculatedInputs]);

  const changedFields = useMemo(() => {
    if (!activeLastCalculatedInputs) {
      return {
        mode: false,
        route: false,
        terrain: false,
        duration: false,
        intensity: false,
        stops: false,
        trainLow: false,
        departure: false,
        isTargetEvent: false,
        preRideGlycogenLoad: false,
        lastMealTiming: false,
      };
    }
    return {
      mode: currentInputs.mode !== activeLastCalculatedInputs.mode,
      route:
        currentInputs.selectedRouteId !== activeLastCalculatedInputs.selectedRouteId ||
        currentInputs.gpxIdentifier !== activeLastCalculatedInputs.gpxIdentifier,
      terrain: mode === "quick" && currentInputs.manualTerrain !== activeLastCalculatedInputs.manualTerrain,
      duration: Math.abs(currentInputs.durationHours - activeLastCalculatedInputs.durationHours) > 0.01,
      intensity: currentInputs.intensity !== activeLastCalculatedInputs.intensity,
      stops: currentInputs.cafeteriaStopCount !== activeLastCalculatedInputs.cafeteriaStopCount,
      trainLow: currentInputs.trainLowEffective !== activeLastCalculatedInputs.trainLowEffective,
      departure:
        currentInputs.departureDayMode !== activeLastCalculatedInputs.departureDayMode ||
        currentInputs.departureCustomDate !== activeLastCalculatedInputs.departureCustomDate ||
        currentInputs.departureHour !== activeLastCalculatedInputs.departureHour,
      isTargetEvent: currentInputs.isTargetEvent !== activeLastCalculatedInputs.isTargetEvent,
      preRideGlycogenLoad: currentInputs.preRideGlycogenLoad !== activeLastCalculatedInputs.preRideGlycogenLoad,
      lastMealTiming: currentInputs.lastMealTiming !== activeLastCalculatedInputs.lastMealTiming,
    };
  }, [currentInputs, activeLastCalculatedInputs, mode]);

  const changedFieldLabels = useMemo(() => {
    const labels: string[] = [];
    if (changedFields.route) labels.push("Ruta");
    if (changedFields.terrain) labels.push("Terreno");
    if (changedFields.intensity) labels.push("Intensidad");
    if (changedFields.duration) labels.push("Duración/Distancia");
    if (changedFields.departure) labels.push("Fecha/Hora");
    if (changedFields.stops) labels.push("Paradas");
    if (changedFields.trainLow) labels.push("Train Low");
    if (changedFields.preRideGlycogenLoad || changedFields.lastMealTiming) labels.push("Carga Previa");
    if (changedFields.isTargetEvent) labels.push("Ruta Objetivo");
    return labels;
  }, [changedFields]);
  // Drives the CTA's gating/helper-text/tooltip for the two route-based
  // modes — a route (or GPX) alone isn't enough to calculate against
  // without an intensity too, and vice versa.
  const routeModeIncomplete =
    (mode === "route" && (!selectedRoute || !intensity)) ||
    (mode === "gpx" && (!parsedGpx || !intensity));

  // Sub-bloque A's own ride-*total* fluid/sodium figures — the API only
  // ever returns per-hour rates (`fluidLossMlPerHour`/`sodiumMgPerHour`),
  // same as `totalRideCarbsG` itself started out as a client-derived total
  // before it was promoted to a real API field; simple enough here not to
  // need one too.
  const totalFluidMl = result ? Math.round(result.fluidLossMlPerHour * result.durationHours) : 0;
  const totalSodiumMg = result ? Math.round(result.sodiumMgPerHour * result.durationHours) : 0;

  // "Micro-Edición In-Situ de Capacidad de Bidón" — whenever the athlete
  // overrides the bottle size for this one preview, `getBottlePlan` (the
  // same pure function the server already ran) re-derives the per-bottle
  // grams/bottle-count instantly, client-side, with no recalculation
  // round-trip — every display below reads this instead of
  // `result.bottlePlan` directly, so the override reaches the hero recipe,
  // the checklist, and the reload-strategy Ziploc bag dose all at once.
  const displayBottlePlan = useMemo(
    () =>
      result && bottleCapacityOverrideMl && bottleCapacityOverrideMl !== result.bottlePlan.bottleSizeMl
        ? getBottlePlan(result.recipe, bottleCapacityOverrideMl, {
            coldWeatherReduction: result.thermalAdaptation.isExtremeCold,
            minWaterBottles: result.thermalAdaptation.isExtremeHeat ? 1 : 0,
          })
        : (result?.bottlePlan ?? null),
    [result, bottleCapacityOverrideMl]
  );

  // "Fix Matemático del Plan de Agua en Ruta" — this used to read
  // `result.reloadStrategy.waterRefillCount`/`waterRefillLiters`, both
  // frozen at whatever bottle size the *server* used for the last
  // calculation. Once the athlete overrides the bottle size for this one
  // preview (`bottleCapacityOverrideMl`, above), `installedBottleVolumeMl`
  // recomputed off the *live* `displayBottlePlan.bottleSizeMl` while the
  // recommended refill count/volume stayed pinned to the old, now-stale
  // `reloadStrategy` — a real, reported incoherence (a 2600ml deficit
  // shown next to "1 recarga de 600ml," an amount the real deficit would
  // need ~5 of). Recomputed directly and consistently from the same two
  // live figures instead: real cage count (`result.athleteBottleCount`,
  // never affected by a bottle-size override) × the current bottle size —
  // both always in sync with each other and with `totalFluidMl` above,
  // so this can never drift the way reading a separately-computed,
  // possibly-stale `reloadStrategy` could. Each "recarga" tops up the
  // *entire* installed capacity again (a fountain stop isn't limited to
  // one bottle's worth), so the deficit splits evenly across however many
  // full refills are actually needed.
  const installedCapacityMl =
    result && displayBottlePlan ? result.athleteBottleCount * displayBottlePlan.bottleSizeMl : 0;
  const waterDeficitMl = Math.max(0, totalFluidMl - installedCapacityMl);
  // "Plan de Agua por Botellas Completas" — a rider always refills from a
  // fountain/gasolinera in whole bottles, never a fractional volume like
  // "939ml" a kitchen measuring cup would be needed for on the road. Each
  // stop tops the *entire* installed capacity back up again (every cage,
  // not one bottle at a time), so the number of stops is simply the
  // deficit divided by that whole capacity, rounded up — no per-stop
  // partial-volume figure needed at all.
  const fullRefillsNeeded =
    waterDeficitMl > 0 && installedCapacityMl > 0 ? Math.ceil(waterDeficitMl / installedCapacityMl) : 0;
  const needsWaterRefill = fullRefillsNeeded > 0;
  // Kept under its old name for the "Déficit hídrico" bullet below, which
  // already reads it — now sourced from the live, consistent figure above
  // instead of a stale `reloadStrategy.startingBottleCount`-derived one.
  const installedBottleVolumeMl = installedCapacityMl;

  // "Conversión Dinámica a Medidas Caseras" — recomputed from the last
  // calculated result whenever it changes; cheap pure arithmetic, no memo
  // needed. Card 05's "Dosis ejecutiva" is scoped to the per-bottle figure.
  const fuelBottleMeasures = displayBottlePlan
    ? calculateHouseholdMeasures({
        saltG: getTableSaltGrams(displayBottlePlan.fuelBottles.sodiumMgPerBottle),
        maltodextrinG: displayBottlePlan.fuelBottles.maltodextrinGPerBottle,
        fructoseG: displayBottlePlan.fuelBottles.fructoseGPerBottle,
      })
    : null;

  // Always the athlete's own manual selection now that "Estrategia
  // nutricional" no longer gates it behind a server-computed Óptimo mode —
  // feeds the live "Objetivo/Cubierto/Restante" balance pill in Card 04.
  const effectivePocketFood: PocketFoodSelection = { ...pocketFood, customCarbsG };
  const pocketFoodCarbsPreview = getPocketFoodTotalCarbsG(effectivePocketFood);
  // Pocket food *plus* whatever the selected bottle configuration itself
  // contributes — picking "Solo Agua" vs. "1 Mix" vs. "Ambos Mix" updates
  // this instantly, the same as tapping a pocket-food stepper +/- already
  // did, with zero network round-trip either way.
  const bottleCarbsContributionG =
    result && displayBottlePlan
      ? getBottleCarbsContributionG(bottleConfig, displayBottlePlan, result.athleteBottleCount)
      : 0;
  // "Selector Opcional de Marcas Reales" — every selected commercial
  // product contributes both HC and Na+ independently: the carb side feeds
  // the same CUBIERTO/RESTANTE pill as every other coverage source below,
  // the sodium side is only ever compared against the ride's own sodium
  // target in Card 05 (see `showSodiumSuggestion` further down), never
  // folded into any carb figure.
  const commercialCarbsG = COMMERCIAL_PRODUCTS.reduce(
    (sum, product) => sum + (commercialProducts[product.id] ?? 0) * product.carbs,
    0
  );
  const commercialSodiumMg = COMMERCIAL_PRODUCTS.reduce(
    (sum, product) => sum + (commercialProducts[product.id] ?? 0) * product.sodium,
    0
  );
  // What Card 04's own "bolsillo" actually renders — only the products the
  // athlete has already given a real quantity to, same "the list shows
  // what's selected" contract as every other pocket-food row. The full
  // catalog lives inside `CommercialProductsSheet` instead.
  const selectedCommercialProducts = COMMERCIAL_PRODUCTS.filter(
    (product) => (commercialProducts[product.id] ?? 0) > 0
  );
  const bottlesAndPocketCoveredCarbsG =
    pocketFoodCarbsPreview + bottleCarbsContributionG + commercialCarbsG;
  // "Desvinculación de Paradas del Cálculo de Carbohidratos" — CASA
  // (`coveredCarbsG`) is 100% derived from what the athlete has actually
  // configured to carry from home: bottles + pocket food + commercial
  // products. A planned "Parada en ruta" (`cafeteriaStopCount`) used to
  // auto-inject an estimated purchase into this same sum, which meant Card
  // 04 could open on RESTANTE: 0g HC the instant "1 Parada" was picked,
  // before a single real bottle/food item was chosen — a real bug, not a
  // feature. `cafeteriaStopCount` still exists as a pure logistics input
  // (still shown to the athlete, still read by the "Estrategia de Ruta"/
  // "Reposición en ruta necesaria" banners in Card 05 to decide *which*
  // message to show), it just never contributes a gram to this formula.
  const coveredCarbsG = bottlesAndPocketCoveredCarbsG;
  const remainingCarbsG = result ? Math.max(0, result.totalRideCarbsG - coveredCarbsG) : 0;

  // "Corrección de Lógica de Sodio: Inclusión de Mezcla Casera" — the
  // selected bottle configuration's own real sodium content (Evolytes/salt
  // dissolved into a Mix bottle) now counts toward the ride's sodium
  // coverage, exactly like it already counts toward carbs via
  // `bottleCarbsContributionG` above — previously silently 0mg regardless
  // of how much sodium the DIY bottle actually carried.
  const bottleSodiumContributionMg =
    result && displayBottlePlan
      ? getBottleSodiumContributionMg(bottleConfig, displayBottlePlan, result.athleteBottleCount)
      : 0;
  const totalSodiumCoveredMg = commercialSodiumMg + bottleSodiumContributionMg;
  // "Balance de Sodio (Bici + Bolsillos)" — see the module-level doc comment
  // above `SODIUM_SUGGESTION_HOT_ROUTE_THRESHOLD_C` for the full reasoning.
  // `isHotRouteForSodium` defaults to `false` with no `result` (falls back
  // to `-Infinity` against the threshold).
  const isHotRouteForSodium =
    (result?.weather.temperatureMaxC ?? result?.weather.temperatureC ?? -Infinity) >=
    SODIUM_SUGGESTION_HOT_ROUTE_THRESHOLD_C;
  const sodiumDeficitMg = Math.max(0, totalSodiumMg - totalSodiumCoveredMg);
  const showSodiumSuggestion =
    result != null &&
    isHotRouteForSodium &&
    totalSodiumCoveredMg < totalSodiumMg * SODIUM_SUGGESTION_COVERAGE_FRACTION;
  // "Traducción de Déficit a Unidades Operativas" — a raw milligram figure
  // ("faltan 340mg de sodio") gives the athlete nothing to actually act on;
  // both conversions are real, commonly-cited reference doses (a standard
  // electrolyte salt capsule, and this app's own Evolytes-style Na+/g
  // figure — see `getBottleSodiumContributionMg`'s own doc comment for why
  // this stays a conversion layer rather than a second competing sodium
  // model), so the suggestion can name a concrete number of capsules or
  // grams to add, not just a quantity with no unit a rider can measure.
  const saltCapsulesNeeded = sodiumDeficitMg > 0 ? Math.ceil(sodiumDeficitMg / SALT_CAPSULE_SODIUM_MG) : 0;
  const evolytesGramsNeeded =
    sodiumDeficitMg > 0 ? (sodiumDeficitMg / EVOLYTES_SODIUM_MG_PER_G).toFixed(1) : "0.0";

  const isHotWeather = useMemo(() => {
    if (!result) return false;
    const weatherTemp = result.weather?.temperatureMaxC ?? result.weather?.temperatureC ?? 0;
    return weatherTemp >= 25 || result.fluidLossMlPerHour >= 750 || result.sodiumMgPerHour >= 650;
  }, [result]);

  const bottleConfigOptions = useMemo(() => {
    const athleteBottleCount = result?.athleteBottleCount ?? 2;
    return getBottleConfigOptions(athleteBottleCount, isHotWeather);
  }, [result, isHotWeather]);

  const electrolyteRec = useMemo(() => {
    const bottleSizeMl = displayBottlePlan?.bottleSizeMl ?? 550;
    return getElectrolyteRecommendation(bottleSizeMl, isHotWeather);
  }, [displayBottlePlan?.bottleSizeMl, isHotWeather]);

  // "Tip de Eficiencia: Mix vs. Solo Agua" — see the constants' own doc
  // comment above. `false` with no `result` (nothing to evaluate yet).
  const isHighHeatOrLongDuration =
    result != null &&
    (result.durationHours > WATER_ONLY_TIP_DURATION_THRESHOLD_HOURS ||
      (result.weather.temperatureMaxC ?? result.weather.temperatureC) >= WATER_ONLY_TIP_HEAT_THRESHOLD_C);
  const showWaterOnlyMixTip = isHighHeatOrLongDuration && bottleConfig === "water_only";

  // Tarjeta 05's "Resumen de Carga" manifest — same source data as the
  // balance pill above, read fresh on every render so the on-screen list
  // stays in sync with what's currently selected.
  const bikeManifestItems =
    result && displayBottlePlan ? getBikeManifestItems(result, bottleConfig, displayBottlePlan) : [];
  // Real commercial products aren't part of `pocketFood` (see the
  // `commercialProducts` state comment above) — appended here so a selected
  // brand actually shows up in the "Bolsillos maillot" packing list,
  // sodium figure included in its own `specs` line.
  const commercialManifestItems: ManifestItem[] = COMMERCIAL_PRODUCTS.filter(
    (p) => (commercialProducts[p.id] ?? 0) > 0
  ).map((p) => ({
    key: p.id,
    quantity: commercialProducts[p.id],
    name: `${p.brand} ${p.name}`,
    specs: `${p.carbs}g HC · ${p.sodium}mg Na+`,
  }));
  const pocketManifestItems: ManifestItem[] = [
    ...getPocketManifestItems(pocketFood, customCarbsG),
    ...commercialManifestItems,
  ];
  const waterPlanLine =
    result && displayBottlePlan
      ? getWaterPlanLine(fullRefillsNeeded, result.athleteBottleCount, displayBottlePlan.bottleSizeMl)
      : "";

  // "Flujo Deliberado de Generación" — see `isManifestGenerated`'s own doc
  // comment above. `isPlanDirty` folds in the *existing* `isInputsChanged`
  // (a Paso 01/02 edit — route/intensity/duración/etc. — already
  // invalidates everything downstream, manifest included) alongside this
  // new, narrower inventory-only check (Card 04's bottle/pocket-food/
  // commercial-product edits, which don't need a server round-trip to
  // reflect but *do* need a deliberate "Actualizar Plan" before Card 05
  // shows them).
  const currentInventorySnapshot: InventorySnapshot = {
    pocketFood,
    customCarbsG,
    bottleConfig,
    commercialProducts,
    bottleCapacityOverrideMl,
  };
  const isInventoryDirty = manifestSnapshot ? !isInventoryEqual(currentInventorySnapshot, manifestSnapshot) : false;
  const isPlanDirty = isManifestGenerated && (Boolean(isInputsChanged) || isInventoryDirty);

  // Snapshots the current inventory and reveals Card 05's real content —
  // called both by Card 04's own "Generar Manifiesto de Salida" button (the
  // first generation) and Card 05's own "Actualizar Plan con Nuevos Datos"
  // veil button (every subsequent one) — same action either way, just a
  // different trigger. The smooth-scroll only matters the first time in
  // practice (subsequent clicks happen from inside Card 05 itself, already
  // in view), but re-running it is harmless.
  function handleGenerateManifest() {
    setManifestSnapshot(currentInventorySnapshot);
    setIsManifestGenerated(true);
    requestAnimationFrame(() => {
      card05Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // Unified "Recalcular Manifiesto" action behind Card 05's single
  // consolidated dirty banner (`isPlanDirty` — see its own doc comment
  // above) — this replaces what used to be two independent treatments (a
  // Paso 01/02 edit vs. a Card 04 inventory edit) with one button that
  // resolves whichever actually caused the staleness. A Paso 01/02 change
  // means the *server-computed* `result` itself is stale, so it needs a
  // real recalculation first; a pure inventory change doesn't (the recipe
  // math already reflects it live), so `handleGenerateManifest` alone —
  // re-snapshotting the inventory and re-arming `isManifestGenerated` — is
  // enough for that case.
  async function handleRecalculateManifest() {
    if (isInputsChanged) {
      const success = await handleCalculate();
      if (!success) return;
    }
    handleGenerateManifest();
  }

  // Card 05's "Cronograma Dinámico de Ingesta" — the server-computed solid/
  // gel/caffeine milestones (`result.timingTimeline.entries`, driven by
  // pocket food alone). Used to also merge in a synthetic entry per planned
  // "Parada en ruta" naming an estimated carb suggestion for that stop —
  // removed along with the rest of the auto-carb-suggestion system (see
  // `coveredCarbsG`'s own doc comment above): a logistics-only stop has no
  // nutritional content of its own to schedule into an *ingesta* timeline.
  const mergedTimelineEntries = useMemo(() => {
    if (!result) return [];
    return result.timingTimeline.entries
      .map((entry, i) => {
        let atMins = entry.atMinutes;
        if (experienceMode === "advanced" && i === 0) {
          atMins = lastMealTiming === "less_than_30m" ? 45 : lastMealTiming === "more_than_3h" ? 15 : 30;
        }
        return {
          key: `srv-${i}`,
          atMinutes: atMins,
          atKm: entry.atKm,
          icon: entry.type,
          label: stripEmoji(entry.label),
          approx: false,
        };
      })
      .sort((a, b) => a.atMinutes - b.atMinutes);
  }, [result, experienceMode, lastMealTiming]);

  const tacticalPoints = useMemo(() => {
    if (!result || mergedTimelineEntries.length === 0) return [];
    const totalMins = Math.max(1, result.durationHours * 60);
    const dist = selectedRoute?.distanceKm ?? parsedGpx?.distanceKm ?? 100;
    return mergedTimelineEntries.map((e) => {
      // Use km-based distance fraction when available (matches GPX elevation
      // profile's own distanceFraction coordinate space). Fall back to time
      // fraction only when atKm is null (manual mode with no distance data).
      const distFraction =
        e.atKm != null && dist > 0
          ? Math.min(1, Math.max(0, e.atKm / dist))
          : Math.min(1, Math.max(0, e.atMinutes / totalMins));
      return {
        key: e.key,
        distanceFraction: distFraction,
        km: e.atKm ?? Math.round(distFraction * dist),
        type: (e.icon === "gel" ? "gel" : e.icon === "solid" ? "solid" : "water") as "gel" | "solid" | "stop" | "water",
        title: e.label,
      };
    });
  }, [result, mergedTimelineEntries, selectedRoute, parsedGpx]);

  // "Modo Cobertura Limitada" — if the athlete opens the app with no
  // connection at all (mid-climb, no signal), load the last strategy that
  // did calculate successfully rather than showing an empty planner.
  useEffect(() => {
    function loadCachedStrategyIfOffline() {
      if (typeof navigator === "undefined" || navigator.onLine) return;
      try {
        const cached = localStorage.getItem(LAST_FUELING_STRATEGY_KEY);
        if (!cached) return;
        const parsed = JSON.parse(cached);
        if (activeModeGroup === "manual") {
          setManualResult(parsed);
          setManualHasCalculatedOnce(true);
        } else {
          setRouteResult(parsed);
          setRouteHasCalculatedOnce(true);
        }
        setIsOfflineCache(true);
      } catch {
        // Corrupt/unavailable cache — just leave the planner empty, same as
        // never having calculated a strategy before.
      }
    }

    loadCachedStrategyIfOffline();
    window.addEventListener("offline", loadCachedStrategyIfOffline);
    return () => window.removeEventListener("offline", loadCachedStrategyIfOffline);
  }, [activeModeGroup]);

  // A freshly calculated strategy renders below the fold on most phones —
  // without this, "Calcular estrategia" appears to do nothing until the
  // athlete notices they need to scroll down themselves.
  useEffect(() => {
    if (result) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  const isInitialInputRender = useRef(true);
  useEffect(() => {
    if (isInitialInputRender.current) {
      isInitialInputRender.current = false;
      return;
    }
    // Cleared error state on input changes
    setRouteError(false);
    setIntensityError(false);
  }, [
    mode,
    selectedRouteId,
    parsedGpx,
    quickDurationHours,
    gpxDurationHours,
    routeDurationHours,
    intensity,
    departureLocal,
    isTargetEvent,
    trainLow,
  ]);

  function setPocketFoodQty(type: PocketFoodItemType, qty: number) {
    setPocketFood((prev) => ({ ...prev, [type]: Math.max(0, Math.min(MAX_POCKET_FOOD_QTY, qty)) }));
  }

  function setCommercialProductQty(id: string, qty: number) {
    setCommercialProducts((prev) => ({ ...prev, [id]: Math.max(0, Math.min(MAX_POCKET_FOOD_QTY, qty)) }));
  }


  async function handleGpxFile(file: File) {
    setGpxError(null);
    try {
      const text = await file.text();
      const parsed = parseGpxFile(text, file.name);
      if (!parsed) {
        setParsedGpx(null);
        setGpxError("No se pudo leer el archivo — comprueba que sea un .gpx válido.");
        return;
      }
      setParsedGpx(parsed);
      setMode("gpx");
      setSelectedRouteId("");
      setGpxUploadOpen(false);
    } catch {
      setParsedGpx(null);
      setGpxError("No se pudo leer el archivo — comprueba que sea un .gpx válido.");
    }
  }

  // Returns whether the calculation actually succeeded — the unified Card
  // 05 "Recalcular Manifiesto" handler (see `handleRecalculateManifest`
  // below) needs to know this so it only re-arms `isManifestGenerated`
  // once a fresh `result` genuinely exists, not on a validation/API failure.
  async function handleCalculate(): Promise<boolean> {
    if (mode === "route") {
      if (!selectedRoute) {
        setRouteError(true);
        scrollToFieldError("route");
        return false;
      }
      setRouteError(false);
      if (!intensity) {
        setIntensityError(true);
        scrollToFieldError("intensity");
        return false;
      }
      setIntensityError(false);
    } else if (mode === "gpx") {
      if (!parsedGpx) {
        setRouteError(true);
        scrollToFieldError("gpx-dropzone");
        return false;
      }
      setRouteError(false);
      if (!intensity) {
        setIntensityError(true);
        scrollToFieldError("intensity-gpx");
        return false;
      }
      setIntensityError(false);
    } else if (mode === "quick") {
      if (quickDurationHours <= 0) {
        setRouteError(true);
        const targetId = manualCalcMode === "time" ? "duration-hours" : "distance-km";
        scrollToFieldError(targetId);
        requestAnimationFrame(() => document.getElementById(targetId)?.focus());
        return false;
      }
      setRouteError(false);
      if (!intensity) {
        setIntensityError(true);
        scrollToFieldError("intensity-quick");
        return false;
      }
      setIntensityError(false);
    }

    setLoading(true);
    setError(null);
    try {
      const departureIso = new Date(departureLocal).toISOString();
      const pocketFoodPayload = {
        ...pocketFood,
        customCarbsG,
      };
      const body =
        mode === "route" && selectedRoute
          ? {
              mode: "route",
              departureIso,
              distanceKm: selectedRoute.distanceKm,
              elevationGainM: selectedRoute.elevationGainM,
              startLat: selectedRoute.startLat,
              startLng: selectedRoute.startLng,
              endLat: selectedRoute.endLat,
              endLng: selectedRoute.endLng,
              routeId: selectedRoute.id,
              ...(routeDurationOverridden ? { durationHoursOverride: routeDurationHours } : {}),
              intensity,
              isTargetEvent,
              pocketFood: pocketFoodPayload,
              fuelingMode,
              trainLow: trainLowEffective,
            }
          : mode === "gpx" && parsedGpx
            ? {
                mode: "route",
                departureIso,
                distanceKm: parsedGpx.distanceKm,
                elevationGainM: parsedGpx.elevationGainM,
                startLat: parsedGpx.startLat,
                startLng: parsedGpx.startLng,
                endLat: parsedGpx.endLat,
                endLng: parsedGpx.endLng,
                durationHoursOverride: gpxDurationHours,
                peakLat: parsedGpx.peakLat,
                peakLng: parsedGpx.peakLng,
                peakDistanceFraction: parsedGpx.peakDistanceFraction,
                peakElevationM: parsedGpx.peakElevationM,
                troughLat: parsedGpx.troughLat,
                troughLng: parsedGpx.troughLng,
                troughDistanceFraction: parsedGpx.troughDistanceFraction,
                troughElevationM: parsedGpx.troughElevationM,
                mountainPasses: parsedGpx.mountainPasses,
                elevationMilestones: parsedGpx.elevationMilestones,
                elevationProfile: parsedGpx.elevationProfile,
                waypoints: parsedGpx.waypoints,
                intensity,
                isTargetEvent,
                pocketFood: pocketFoodPayload,
                fuelingMode,
                trainLow: trainLowEffective,
              }
            : {
                mode: "quick",
                departureIso,
                durationHours: quickDurationHours,
                intensity,
                isTargetEvent,
                pocketFood: pocketFoodPayload,
                fuelingMode,
                trainLow: trainLowEffective,
              };

      const res = await fetch("/api/fueling/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(
          data.error === "no_profile"
            ? "Configura tu perfil fisiológico antes de planificar una ruta."
            : "No se pudo calcular la estrategia de fueling."
        );
        if (activeModeGroup === "manual") {
          setManualResult(null);
        } else {
          setRouteResult(null);
        }
        return false;
      }

      const snapshot: CalculatedInputsSnapshot = { ...currentInputs };
      if (activeModeGroup === "manual") {
        setManualResult(data);
        setManualHasCalculatedOnce(true);
        setManualLastCalculatedInputs(snapshot);
      } else {
        setRouteResult(data);
        setRouteHasCalculatedOnce(true);
        setRouteLastCalculatedInputs(snapshot);
      }

      setIsOfflineCache(false);
      setBottleCapacityOverrideMl(null);
      setBottleCapacityEditorOpen(false);
      setShowBikeScoops(false);
      // A brand-new `result` has no manifest generated against it yet —
      // see `isManifestGenerated`'s own doc comment above.
      setIsManifestGenerated(false);
      setManifestSnapshot(null);
      try {
        localStorage.setItem(LAST_FUELING_STRATEGY_KEY, JSON.stringify(data));
      } catch {
        // Private browsing / quota exceeded — the offline fallback simply
        // won't have anything to load next time, not worth failing over.
      }
      return true;
    } catch {
      setError("No se pudo calcular la estrategia de fueling.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  return (
    // No more shared root `<Card>` — "Estandarización de Tarjetas" moved
    // every numbered card's own visual chrome (border/radius/bg/shadow/
    // margin) onto each card's own wrapper div (`numberedCardClass`), so a
    // shared outer Card supplying its own background/padding/gap would
    // just double up against that. A plain `<div>` has no `overflow-hidden`
    // of its own to begin with (unlike the base `Card` primitive), so
    // Card 04's sticky OBJETIVO/CUBIERTO/RESTANTE bar (see its own doc
    // comment further down) no longer needs the explicit `overflow-visible`
    // override this root used to carry just to fight that default.
    <div>
        {/* PASO 01 · Selección y origen de ruta — the mode toggle plus
            whichever source-specific fields that mode needs (Strava route
            select + map, manual duration/watts, or a GPX upload + map).
            other numbered card (`numberedCardClass`). */}
        <div className={cn(numberedCardClass, "overflow-hidden p-0 sm:p-0 md:p-0 transition-opacity duration-200", loading && "pointer-events-none opacity-50")}>
          <div className="p-4 sm:p-5 md:p-6">
            <span className="font-mono text-xs font-semibold tracking-wider text-zinc-500">
              01 · Selección y origen de ruta
            </span>

            <div className="mt-2 grid grid-cols-2 gap-2 *:min-w-0">
              <button
                type="button"
                disabled={loading}
                onClick={() => setMode(parsedGpx ? "gpx" : "route")}
                className={cn(
                  segmentedButtonClass,
                  mode === "route" || mode === "gpx"
                    ? "border-transparent bg-[#70685b] text-white hover:bg-[#60594e]"
                    : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400",
                  loading && "cursor-not-allowed opacity-60"
                )}
              >
                <span className={segmentedButtonLabelClass}>Strava / GPX</span>
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => setMode("quick")}
                className={cn(
                  segmentedButtonClass,
                  mode === "quick"
                    ? "border-transparent bg-[#70685b] text-white hover:bg-[#60594e]"
                    : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400",
                  loading && "cursor-not-allowed opacity-60"
                )}
              >
                <span className={segmentedButtonLabelClass}>Entreno Manual</span>
              </button>
            </div>

            {(mode === "route" || mode === "gpx") && (
              <div className="mt-4">
                {mode === "gpx" && parsedGpx ? (
                  <div className="flex items-center justify-between gap-3 rounded-sm bg-[#F8F7F5] px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900">{parsedGpx.name}</p>
                      <p className="font-mono text-xs text-zinc-500">
                        {parsedGpx.distanceKm}km · {parsedGpx.elevationGainM}m D+
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        setParsedGpx(null);
                        setGpxError(null);
                        setMode("route");
                        setSelectedRouteId("");
                      }}
                      className="shrink-0 cursor-pointer text-[11px] font-semibold tracking-widest text-zinc-500 uppercase transition-colors duration-150 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Quitar GPX
                    </button>
                  </div>
                ) : (
                  <>
                    {routes.length > 0 ? (
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <label htmlFor="route" className={formFieldLabelClass}>
                              Ruta
                            </label>
                            {changedFields.route && (
                              <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">
                                <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                                Modificado
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={handleRefreshRoutes}
                            disabled={refreshingRoutes || loading}
                            title="Recargar rutas desde Strava"
                            className="flex cursor-pointer items-center gap-1 text-[10px] font-mono font-semibold text-[#70685b] transition-colors duration-150 hover:text-[#585248] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <RefreshCw className={cn("size-3", refreshingRoutes && "animate-spin")} />
                            {refreshingRoutes ? "Sincronizando…" : "Recargar"}
                          </button>
                        </div>
                        <div className="relative mt-1.5">
                          <select
                            id="route"
                            className={cn(
                              selectableFieldClass,
                              (refreshingRoutes || loading) && "text-zinc-400",
                              routeError && "border-2 border-amber-400 bg-amber-50/20"
                            )}
                            value={refreshingRoutes ? "__syncing" : selectedRouteId}
                            onChange={(e) => {
                              setSelectedRouteId(e.target.value);
                              setRouteError(false);
                            }}
                            disabled={refreshingRoutes || loading}
                          >
                            {refreshingRoutes ? (
                              <option value="__syncing" className="font-mono text-xs text-neutral-400">
                                Sincronizando rutas de Strava...
                              </option>
                            ) : (
                              <>
                                <option value="" disabled>
                                  Seleccionar ruta de Strava...
                                </option>
                                {routes.map((route) => (
                                  <option key={route.id} value={route.id}>
                                    {route.name} · {route.distanceKm}km · {route.elevationGainM}m D+
                                  </option>
                                ))}
                              </>
                            )}
                          </select>
                          {refreshingRoutes ? (
                            <span
                              className="pointer-events-none absolute top-1/2 right-9 size-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700"
                              aria-hidden="true"
                            />
                          ) : (
                            <ChevronDown className={selectChevronClass} />
                          )}
                        </div>
                        {routeError && (
                          <span className="mt-1 block font-mono text-[10px] text-amber-700">
                            * Por favor, selecciona una ruta
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-start gap-2 border border-dashed border-neutral-300 px-4 py-3">
                        <p className="text-sm text-neutral-500">
                          Sin rutas en Strava — usa la calculadora rápida o sube un GPX.
                        </p>
                        <button
                          type="button"
                          onClick={handleRefreshRoutes}
                          disabled={refreshingRoutes || loading}
                          className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold tracking-widest text-neutral-600 uppercase transition-colors duration-150 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <RefreshCw className={cn("size-3.5", refreshingRoutes && "animate-spin")} />
                          {refreshingRoutes ? "Sincronizando…" : "Buscar rutas de nuevo"}
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => setGpxUploadOpen((v) => !v)}
                      className="mt-2 flex cursor-pointer items-center gap-1.5 font-mono text-[11px] font-semibold text-[#70685b] transition-colors duration-150 hover:text-[#585248] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Upload className="size-3.5" />
                      {gpxUploadOpen ? "Cancelar" : "+ Subir GPX"}
                    </button>

                    {gpxUploadOpen && (
                      <div className="mt-2">
                        <div
                          onDragOver={(e) => {
                            if (loading) return;
                            e.preventDefault();
                            setIsDraggingGpx(true);
                          }}
                          onDragLeave={() => setIsDraggingGpx(false)}
                          onDrop={(e) => {
                            if (loading) return;
                            e.preventDefault();
                            setIsDraggingGpx(false);
                            const file = e.dataTransfer.files?.[0];
                            if (file) handleGpxFile(file);
                          }}
                          id="gpx-dropzone"
                          className={cn(
                            "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-neutral-50/60 px-4 py-8 text-center transition-colors duration-150 hover:border-neutral-900",
                            isDraggingGpx
                              ? "border-neutral-900 bg-neutral-100"
                              : routeError
                                ? "border-amber-500 bg-amber-50/20"
                                : "border-neutral-300",
                            loading && "pointer-events-none opacity-50"
                          )}
                        >
                          <Upload className="size-5 text-neutral-500" />
                          <p className="font-mono text-[11px] uppercase tracking-wide text-neutral-500">
                            Arrastra tu archivo .gpx aquí, o{" "}
                            <label
                              htmlFor="gpx-upload"
                              className={cn(
                                "cursor-pointer font-bold text-neutral-900 underline underline-offset-2",
                                loading && "cursor-not-allowed"
                              )}
                            >
                              selecciona un archivo
                            </label>
                          </p>
                          <input
                            id="gpx-upload"
                            type="file"
                            accept=".gpx"
                            disabled={loading}
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleGpxFile(file);
                            }}
                          />
                        </div>
                        {gpxError && <p className="mt-2 text-sm text-status-warning">{gpxError}</p>}
                        {routeError && !gpxError && (
                          <span className="mt-1 block font-mono text-[10px] text-amber-700">
                            * Por favor, sube un archivo GPX
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {mode === "quick" && (
              <div className="mt-4 flex flex-col gap-4">
                {/* 1. Terreno de la Salida (Grid Horizontal 3 Columnas) */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <label className={formFieldLabelClass}>Terreno de la Salida</label>
                    {changedFields.terrain && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">
                        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Modificado
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 *:min-w-0">
                    {MANUAL_TERRAIN_OPTIONS.map((opt) => {
                      const isSelected = manualTerrain === opt.id;
                      const title =
                        opt.id === "flat"
                          ? "Llano"
                          : opt.id === "medium_mountain"
                            ? "M. Montaña"
                            : "G. Montaña";
                      const subtext =
                        opt.id === "flat"
                          ? "~300m D+"
                          : opt.id === "medium_mountain"
                            ? "~1000m D+"
                            : ">1800m D+";
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={loading}
                          onClick={() => setManualTerrain(opt.id)}
                          className={cn(
                            segmentedButtonClass,
                            "flex flex-col items-center justify-center py-2 px-1 text-center transition-all duration-200",
                            isSelected
                              ? "border-transparent bg-[#70685b] text-white hover:bg-[#60594e]"
                              : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400",
                            loading && "cursor-not-allowed opacity-60"
                          )}
                        >
                          <span className="font-semibold text-xs tracking-tight">{title}</span>
                          <span
                            className={cn(
                              "text-[11px] font-mono",
                              isSelected ? "text-zinc-200" : "text-neutral-400"
                            )}
                          >
                            {subtext}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Selector de Intensidad Objetivo (Posicionado inmediatamente después del Terreno) */}
                <IntensityObjectiveSelect
                  id="intensity-quick"
                  value={manualIntensity}
                  onChange={setManualIntensity}
                  error={intensityError}
                  disabled={loading}
                  isModified={changedFields.intensity}
                />

                {/* 3. Modo y Parámetros de Ruta (Tarjeta de Control Integrada) */}
                <div className="flex flex-col gap-3.5 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3.5 shadow-xs">
                  {/* Selector Segmentado: Por Tiempo vs Por Distancia */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <label className={formFieldLabelClass}>Parámetros de la Salida</label>
                      {changedFields.duration && (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">
                          <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                          Modificado
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 *:min-w-0">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => setManualCalcMode("time")}
                        className={cn(
                          segmentedButtonClass,
                          manualCalcMode === "time"
                            ? "border-transparent bg-[#70685b] text-white hover:bg-[#60594e]"
                            : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400",
                          loading && "cursor-not-allowed opacity-60"
                        )}
                      >
                        <span className={segmentedButtonLabelClass}>Por Tiempo (Horas)</span>
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => setManualCalcMode("distance")}
                        className={cn(
                          segmentedButtonClass,
                          manualCalcMode === "distance"
                            ? "border-transparent bg-[#70685b] text-white hover:bg-[#60594e]"
                            : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400",
                          loading && "cursor-not-allowed opacity-60"
                        )}
                      >
                        <span className={segmentedButtonLabelClass}>Por Distancia (km)</span>
                      </button>
                    </div>
                  </div>

                  {/* Inputs Unificados según Modo */}
                  {manualCalcMode === "time" ? (
                    <div className="flex flex-col gap-3">
                      <div className="grid grid-cols-2 gap-3 *:min-w-0">
                        <div className="relative flex items-center">
                          <input
                            id="duration-hours"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            placeholder="0"
                            aria-label="Horas"
                            disabled={loading}
                            className={cn(
                              inputClass,
                              "pr-8 font-mono text-sm",
                              routeError && "border-2 border-amber-400 bg-amber-50/20",
                              loading && "cursor-not-allowed opacity-60"
                            )}
                            value={quickHoursInput}
                            onChange={(e) => {
                              setQuickHoursInput(e.target.value);
                              setRouteError(false);
                            }}
                          />
                          <span className="pointer-events-none absolute right-3 font-mono text-xs text-zinc-400">
                            h
                          </span>
                        </div>
                        <div className="relative flex items-center">
                          <input
                            id="duration-minutes"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={59}
                            step={5}
                            placeholder="0"
                            aria-label="Minutos"
                            disabled={loading}
                            className={cn(
                              inputClass,
                              "pr-10 font-mono text-sm",
                              loading && "cursor-not-allowed opacity-60"
                            )}
                            value={quickMinutesInput}
                            onChange={(e) => {
                              setQuickMinutesInput(e.target.value);
                              setRouteError(false);
                            }}
                          />
                          <span className="pointer-events-none absolute right-3 font-mono text-xs text-zinc-400">
                            min
                          </span>
                        </div>
                      </div>

                      {/* Lectura limpia de Distancia Estimada + Ajuste opcional */}
                      {manualCalcResults.durationHours > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono text-zinc-500">
                              Distancia estimada:
                            </span>
                            <span className="font-mono font-bold text-zinc-900">
                              ~{manualCalcResults.distanceKm} km
                            </span>
                            <span className="text-[11px] font-mono text-zinc-400">| Ajustar:</span>
                            <input
                              id="custom-distance"
                              type="number"
                              inputMode="decimal"
                              step={0.5}
                              placeholder={`${Math.round(manualCalcResults.durationHours * projectedSpeedKmh * 10) / 10}`}
                              disabled={loading}
                              className={cn(
                                inputClass,
                                "h-7 text-xs px-2 py-0 w-20 font-mono text-center",
                                loading && "opacity-60"
                              )}
                              value={manualCustomDistanceInput}
                              onChange={(e) => setManualCustomDistanceInput(e.target.value)}
                            />
                            <span className="font-mono text-xs text-zinc-500">km</span>
                          </div>
                          {manualCustomDistanceInput !== "" && (
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => setManualCustomDistanceInput("")}
                              className="text-[10px] text-zinc-400 hover:text-zinc-700 underline font-mono"
                            >
                              Restablecer
                            </button>
                          )}
                        </div>
                      )}

                      {routeError && (
                        <span className="font-mono text-[10px] text-amber-700">
                          * Por favor, introduce una duración válida
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="relative flex items-center">
                        <input
                          id="distance-km"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={1}
                          placeholder="ej. 60"
                          aria-label="Distancia en km"
                          disabled={loading}
                          className={cn(
                            inputClass,
                            "pr-12 font-mono text-sm",
                            routeError && "border-2 border-amber-400 bg-amber-50/20",
                            loading && "cursor-not-allowed opacity-60"
                          )}
                          value={manualDistanceKmInput}
                          onChange={(e) => {
                            setManualDistanceKmInput(e.target.value);
                            setManualDurationOverride(null);
                            setRouteError(false);
                          }}
                        />
                        <span className="pointer-events-none absolute right-3 font-mono text-xs text-zinc-400">
                          km
                        </span>
                      </div>

                      {/* Lectura limpia de Tiempo Estimado + Ajuste opcional */}
                      {manualCalcResults.distanceKm > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono text-zinc-500">
                              Tiempo estimado:
                            </span>
                            <span className="font-mono font-bold text-zinc-900">
                              ~{formatHoursMinutes(manualCalcResults.durationHours)}
                            </span>
                            <span className="text-[11px] font-mono text-zinc-400">| Ajustar:</span>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                step={1}
                                placeholder="h"
                                disabled={loading}
                                className={cn(
                                  inputClass,
                                  "h-7 text-xs px-1.5 py-0 w-12 font-mono text-center",
                                  loading && "opacity-60"
                                )}
                                value={manualCalcResults.hoursInput}
                                onChange={(e) =>
                                  setManualDurationOverride({
                                    hours: e.target.value,
                                    minutes: manualCalcResults.minutesInput,
                                  })
                                }
                              />
                              <span className="font-mono text-[10px] text-zinc-400">h</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={59}
                                step={5}
                                placeholder="m"
                                disabled={loading}
                                className={cn(
                                  inputClass,
                                  "h-7 text-xs px-1.5 py-0 w-12 font-mono text-center",
                                  loading && "opacity-60"
                                )}
                                value={manualCalcResults.minutesInput}
                                onChange={(e) =>
                                  setManualDurationOverride({
                                    hours: manualCalcResults.hoursInput,
                                    minutes: e.target.value,
                                  })
                                }
                              />
                              <span className="font-mono text-[10px] text-zinc-400">m</span>
                            </div>
                          </div>
                          {manualCalcResults.isDurationEdited && (
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => setManualDurationOverride(null)}
                              className="text-[10px] text-zinc-400 hover:text-zinc-700 underline font-mono"
                            >
                              Restablecer
                            </button>
                          )}
                        </div>
                      )}

                      {routeError && (
                        <span className="font-mono text-[10px] text-amber-700">
                          * Por favor, introduce la distancia en km
                        </span>
                      )}
                    </div>
                  )}

                  {/* Badge Micro-Stat de Velocidad Proyectada */}
                  <div className="flex items-center justify-between border-t border-zinc-200/60 pt-2 font-mono text-[12px] text-zinc-500">
                    <span>Velocidad proyectada:</span>
                    <span className="font-semibold text-zinc-900">
                      {manualCalcResults.effectiveSpeedKmh} km/h
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {mode === "route" && routes.length > 0 && (
            <RouteMapPreview
              points={selectedRoutePoints}
              distanceKm={selectedRoute?.distanceKm ?? null}
              elevationGainM={selectedRoute?.elevationGainM ?? null}
              className="mt-0"
            />
          )}
          {mode === "gpx" && (
            <RouteMapPreview
              points={parsedGpx?.points ?? null}
              distanceKm={parsedGpx?.distanceKm ?? null}
              elevationGainM={parsedGpx?.elevationGainM ?? null}
              className="mt-0"
            />
          )}
          {/* "Perfil Altimétrico (Sparkline SVG)" — a GPX file already has
              its own elevation profile locally, so this renders the instant
              a file's parsed, zero extra cost. A selected Strava route
              instead reads from `stravaElevationPoints` (derived from the
              on-selection fetch above) — `null` while that request is in
              flight, before any route is picked, or right after switching
              to a different route (the fetched profile's own tagged
              `routeId` no longer matches), so the sparkline simply doesn't
              render yet rather than showing a stale/wrong shape. */}
          {mode === "gpx" && parsedGpx && parsedGpx.elevationProfile.length >= 2 && (
            <div className="border-t border-zinc-100 bg-white px-4 pt-2 pb-1">
              <ElevationSparkline points={parsedGpx.elevationProfile} />
            </div>
          )}
          {mode === "route" && stravaElevationPoints && stravaElevationPoints.length >= 2 && (
            <div className="border-t border-zinc-100 bg-white px-4 pt-2 pb-1">
              <ElevationSparkline points={stravaElevationPoints} />
            </div>
          )}
        </div>

        {/* PASO 02 · Condiciones de la salida — Intensidad Objetivo (Sub-
            sección A, skipped in Entreno Manual mode since real watts already
            *is* the intensity input there) and Fecha y Hora de Salida (Sub-
            sección B, every mode). Shares the same border/radius/bg/shadow/
            margin as every other numbered card (`numberedCardClass`) — no
            nested sub-cards, `gap-3` alone separates the sub-sections
            ("Jerarquía de Espaciado Editorial": related controls sitting
            side by side get the tighter `space-y-3` scale, not the looser
            `gap-5` this used to carry). The `mt-2` right under the eyebrow
            (down from `mt-4`) is that same pass's "título numerado → primer
            campo" micro-spacing rule.
            "Bloqueo de Formulario durante isCalculating" — every real
            control inside this card (`IntensityObjectiveSelect`/
            `DeparturePicker`'s own `disabled` props, the duration inputs,
            the Paradas previstas buttons, both checkboxes below) already
            gets `disabled={loading}` individually — genuinely inert to
            keyboard/programmatic interaction, not just a visual dim. The
            `pointer-events-none`/`opacity-60` pair on this wrapper is the
            belt-and-suspenders layer on top: an instant, uniform "this
            whole card is inert" cue the moment `handleCalculate` starts,
            with zero per-control flicker while `loading` flips. */}
        <div
          className={cn(
            numberedCardClass,
            "transition-opacity duration-200",
            loading && "pointer-events-none opacity-60"
          )}
        >
          <span className="font-mono text-xs font-semibold tracking-wider text-zinc-500">
            02 · Condiciones de la salida
          </span>

          {mode === "route" && (
            <div className={cn("mt-2 grid grid-cols-1 gap-3", selectedRoute && "sm:grid-cols-3")}>
              <IntensityObjectiveSelect
                id="intensity"
                value={intensity}
                onChange={setIntensity}
                error={intensityError}
                disabled={loading}
                isModified={changedFields.intensity}
              />
              <DeparturePicker
                dayMode={departureDayMode}
                onDayModeChange={setDepartureDayMode}
                customDate={departureCustomDate}
                onCustomDateChange={setDepartureCustomDate}
                hour={departureHour}
                onHourChange={setDepartureHour}
                disabled={loading}
                isModified={changedFields.departure}
              />
              {selectedRoute && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <label className={formFieldLabelClass}>
                      <Pencil className="mr-1 inline size-3" />
                      Tiempo estimado (editar)
                    </label>
                    {changedFields.duration && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">
                        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Modificado
                      </span>
                    )}
                  </div>
                  {intensity ? (
                    <>
                      <div className="grid grid-cols-2 gap-3 *:min-w-0">
                        <div className="relative flex items-center">
                          <input
                            id="route-duration-hours"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            placeholder="0"
                            aria-label="Horas"
                            disabled={loading}
                            className={cn(inputClass, "pr-8", loading && "cursor-not-allowed opacity-60")}
                            value={routeHoursInput}
                            onChange={(e) =>
                              setRouteDurationOverride({
                                routeId: selectedRouteId,
                                intensity,
                                hoursInput: e.target.value,
                                minutesInput: routeMinutesInput,
                              })
                            }
                          />
                          <span className="pointer-events-none absolute right-3 font-mono text-xs text-zinc-400">
                            h
                          </span>
                        </div>
                        <div className="relative flex items-center">
                          <input
                            id="route-duration-minutes"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={59}
                            step={5}
                            placeholder="0"
                            aria-label="Minutos"
                            disabled={loading}
                            className={cn(inputClass, "pr-10", loading && "cursor-not-allowed opacity-60")}
                            value={routeMinutesInput}
                            onChange={(e) =>
                              setRouteDurationOverride({
                                routeId: selectedRouteId,
                                intensity,
                                hoursInput: routeHoursInput,
                                minutesInput: e.target.value,
                              })
                            }
                          />
                          <span className="pointer-events-none absolute right-3 font-mono text-xs text-zinc-400">
                            min
                          </span>
                        </div>
                      </div>
                      <span className="font-mono text-xs whitespace-nowrap text-neutral-500">
                        {formatHoursMinutes(routeDurationHours)}
                        {!routeDurationOverridden && " (estimado)"}
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="flex h-9 items-center rounded-sm bg-zinc-100 px-3 font-mono text-sm text-zinc-400">
                        -- h -- min
                      </div>
                      <span className="font-mono text-xs text-neutral-500">
                        Selecciona la intensidad objetivo para calcular la duración prevista.
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === "quick" && (
            <div className="mt-2 grid grid-cols-1 gap-3">
              <DeparturePicker
                dayMode={departureDayMode}
                onDayModeChange={setDepartureDayMode}
                customDate={departureCustomDate}
                onCustomDateChange={setDepartureCustomDate}
                hour={departureHour}
                onHourChange={setDepartureHour}
                disabled={loading}
                isModified={changedFields.departure}
              />
            </div>
          )}

          {mode === "gpx" && !parsedGpx && (
            <p className="mt-2 text-xs text-neutral-500">
              Sube un archivo GPX en el Paso 01 para configurar la intensidad y la fecha de
              salida.
            </p>
          )}

          {mode === "gpx" && parsedGpx && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <IntensityObjectiveSelect
                  id="intensity-gpx"
                  value={intensity}
                  onChange={setIntensity}
                  error={intensityError}
                  disabled={loading}
                  isModified={changedFields.intensity}
                />
                <DeparturePicker
                  dayMode={departureDayMode}
                  onDayModeChange={setDepartureDayMode}
                  customDate={departureCustomDate}
                  onCustomDateChange={setDepartureCustomDate}
                  hour={departureHour}
                  onHourChange={setDepartureHour}
                  disabled={loading}
                  isModified={changedFields.departure}
                />
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <label className={formFieldLabelClass}>
                      <Pencil className="mr-1 inline size-3" />
                      Tiempo estimado (editar)
                    </label>
                    {changedFields.duration && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">
                        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Modificado
                      </span>
                    )}
                  </div>
                  {intensity ? (
                    <>
                      <div className="grid grid-cols-2 gap-3 *:min-w-0">
                        <div className="relative flex items-center">
                          <input
                            id="gpx-duration-hours"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            placeholder="0"
                            aria-label="Horas"
                            disabled={loading}
                            className={cn(inputClass, "pr-8", loading && "cursor-not-allowed opacity-60")}
                            value={gpxHoursInput}
                            onChange={(e) =>
                              setGpxDurationOverride({
                                intensity,
                                hoursInput: e.target.value,
                                minutesInput: gpxMinutesInput,
                              })
                            }
                          />
                          <span className="pointer-events-none absolute right-3 font-mono text-xs text-zinc-400">
                            h
                          </span>
                        </div>
                        <div className="relative flex items-center">
                          <input
                            id="gpx-duration-minutes"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={59}
                            step={5}
                            placeholder="0"
                            aria-label="Minutos"
                            disabled={loading}
                            className={cn(inputClass, "pr-10", loading && "cursor-not-allowed opacity-60")}
                            value={gpxMinutesInput}
                            onChange={(e) =>
                              setGpxDurationOverride({
                                intensity,
                                hoursInput: gpxHoursInput,
                                minutesInput: e.target.value,
                              })
                            }
                          />
                          <span className="pointer-events-none absolute right-3 font-mono text-xs text-zinc-400">
                            min
                          </span>
                        </div>
                      </div>
                      <span className="font-mono text-xs whitespace-nowrap text-neutral-500">
                        {formatHoursMinutes(gpxDurationHours)}
                        {!gpxDurationOverridden && " (estimado)"}
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="flex h-9 items-center rounded-sm bg-zinc-100 px-3 font-mono text-sm text-zinc-400">
                        -- h -- min
                      </div>
                      <span className="font-mono text-xs text-neutral-500">
                        Selecciona la intensidad objetivo para calcular la duración prevista.
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mt-4">
            <div className="mb-2 flex items-center gap-1.5">
              <span className={formFieldLabelClass}>Paradas previstas en ruta</span>
              {changedFields.stops && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">
                  <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Modificado
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 *:min-w-0">
              {CAFETERIA_STOP_COUNT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={loading}
                  onClick={() => setCafeteriaStopCount(opt.value)}
                  className={cn(
                    segmentedButtonClass,
                    cafeteriaStopCount === opt.value
                      ? "border-transparent bg-[#70685b] text-white hover:bg-[#60594e]"
                      : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400",
                    loading && "cursor-not-allowed opacity-60"
                  )}
                >
                  <span className={segmentedButtonLabelClass}>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 border-t border-zinc-100 pt-3">
            <label
              className={cn(
                "flex items-center gap-2 font-mono text-xs",
                loading ? "cursor-not-allowed text-zinc-400" : "cursor-pointer text-zinc-600"
              )}
            >
              <input
                type="checkbox"
                checked={isTargetEvent}
                disabled={loading}
                onChange={(e) => setIsTargetEvent(e.target.checked)}
                className="size-3.5 cursor-pointer accent-neutral-900 disabled:cursor-not-allowed"
              />
              <span className="font-semibold text-[#70685b]">
                Ruta objetivo / Competición
              </span>
              {changedFields.isTargetEvent && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">
                  <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Modificado
                </span>
              )}
            </label>
            {isTargetEvent && (
              <p className="mt-1.5 text-[11px] text-neutral-500">
                Ajusta la pauta al máximo límite de absorción intestinal (hasta 120g/h) y
                aplica un ratio Fructosa:Maltodextrina de 1:0.8 optimizado para alta
                intensidad.
              </p>
            )}
          </div>

          <div className="mt-3 border-t border-zinc-100 pt-3">
            <label
              className={cn(
                "flex items-center gap-2 font-mono text-xs",
                trainLowIncompatible || loading
                  ? "cursor-not-allowed text-zinc-400"
                  : "cursor-pointer text-zinc-600"
              )}
            >
              <input
                type="checkbox"
                checked={trainLowEffective}
                disabled={trainLowIncompatible || loading}
                onChange={(e) => setTrainLow(e.target.checked)}
                className="size-3.5 cursor-pointer accent-neutral-900 disabled:cursor-not-allowed"
              />
              <span className="font-semibold text-zinc-800">
                Modo Eficiencia Metabólica (Train Low / Ayunas)
              </span>
              {changedFields.trainLow && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">
                  <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Modificado
                </span>
              )}
            </label>
            {trainLowIncompatible ? (
              <p className="mt-1.5 text-[11px] text-neutral-400">
                El modo en ayunas (Train Low) solo es compatible con intensidades aeróbicas
                suaves (Z1-Z2). En alta intensidad o competición, los carbohidratos son
                indispensables para proteger tu masa muscular y rendimiento.
              </p>
            ) : (
              trainLowEffective && (
                <p className="mt-1.5 text-[11px] text-neutral-500">
                  Fija el objetivo de carbohidratos en 0-25g/h (solo electrolitos) para
                  estimular la oxidación de grasas — hidratación y sodio no se ven afectados.
                </p>
              )
            )}
          </div>

          {/* Modo Avanzado: Carga Previa & Timing de Ingesta */}
          {experienceMode === "advanced" && (
            <div className="mt-3 border-t border-zinc-100 pt-3">
              <span className="mb-2.5 block font-mono text-xs font-semibold uppercase tracking-wider text-neutral-800">
                Carga Previa & Timing de Ingesta
              </span>

              <div className="flex flex-col gap-3">
                {/* Nivel de Carga de Glucógeno */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-neutral-600">Nivel de carga previa</span>
                    {changedFields.preRideGlycogenLoad && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">
                        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Modificado
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { value: "normal", label: "Normal (~70%)" },
                      { value: "high", label: "Carga Alta" },
                      { value: "fasted", label: "Ayunas" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={loading}
                        onClick={() => setPreRideGlycogenLoad(opt.value as PreRideGlycogenLoad)}
                        className={cn(
                          segmentedButtonClass,
                          preRideGlycogenLoad === opt.value
                            ? "border-transparent bg-[#70685b] text-white hover:bg-[#60594e]"
                            : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400",
                          loading && "cursor-not-allowed opacity-60"
                        )}
                      >
                        <span className={segmentedButtonLabelClass}>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Timing de Última Ingesta */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-neutral-600">Última ingesta pre-salida</span>
                    {changedFields.lastMealTiming && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">
                        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Modificado
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { value: "more_than_3h", label: ">3h antes" },
                      { value: "1_2h", label: "1-2h antes" },
                      { value: "less_than_30m", label: "<30m (Snack)" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={loading}
                        onClick={() => setLastMealTiming(opt.value as LastMealTiming)}
                        className={cn(
                          segmentedButtonClass,
                          lastMealTiming === opt.value
                            ? "border-transparent bg-[#70685b] text-white hover:bg-[#60594e]"
                            : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400",
                          loading && "cursor-not-allowed opacity-60"
                        )}
                      >
                        <span className={segmentedButtonLabelClass}>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] font-mono leading-snug text-neutral-400">
                    {lastMealTiming === "less_than_30m"
                      ? "Ingesta pre-salida reciente (<30m): la primera toma en ruta se traslada al minuto 45."
                      : lastMealTiming === "more_than_3h"
                        ? "Salida en ayunas/sin comer (>3h): la primera toma en ruta se adelanta al minuto 15."
                        : "Ingesta normal (1-2h): la primera toma en ruta comenzará en el minuto 30."}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Paso 03 (Estrategia nutricional + Comida en bolsillo) used to
            live here, pre-cálculo — "Reestructuración UX: Flujo Invertido"
            moved it entirely into the results container below (Sub-bloques
            B/C), so the initial form is just Paso 01 + Paso 02 + the CTA.
            The athlete now sees their real calculated targets *before*
            being asked to plan how to cover them, rather than configuring
            a food strategy against a target they haven't seen yet. */}

        <div className="mb-5 flex flex-col gap-3 sm:mb-6">
          <button
            type="button"
            onClick={handleCalculate}
            disabled={
              loading ||
              !isProfileComplete ||
              (Boolean(activeLastCalculatedInputs) && !isInputsChanged)
            }
            title={
              isProfileComplete && routeModeIncomplete
                ? "Selecciona una ruta e intensidad para calcular"
                : undefined
            }
            className={cn(
              "flex w-full items-center justify-center gap-2.5 rounded-md px-4 py-3.5 font-mono text-xs uppercase tracking-wider transition-all shadow-sm",
              isInputsChanged
                ? "bg-neutral-900 text-white hover:bg-neutral-800 border border-neutral-900"
                : "bg-neutral-900 text-white hover:bg-neutral-800",
              (!isProfileComplete || (Boolean(activeLastCalculatedInputs) && !isInputsChanged) || loading) &&
                "cursor-not-allowed opacity-60 hover:bg-neutral-900"
            )}
          >
            {isProfileComplete ? (
              <>
                <Zap className={cn("size-3.5 shrink-0", isInputsChanged ? "text-amber-400 animate-pulse" : "text-white")} />
                <span>
                  {loading
                    ? "Calculando…"
                    : hasCalculatedOnce
                      ? "Re-calcular Estrategia Nutricional"
                      : "Calcular Estrategia Nutricional"}
                </span>
                {isInputsChanged && (
                  <span className="ml-1 size-1.5 shrink-0 rounded-full bg-amber-400 animate-pulse" />
                )}
              </>
            ) : (
              <>
                <Lock className="size-3.5 shrink-0 text-white" />
                <span>Calcular estrategia (requiere perfil completo)</span>
              </>
            )}
          </button>
          {isProfileComplete && mode === "quick" && !quickValid && (
            <p className="text-[11px] text-neutral-500">
              Introduce una duración válida y selecciona una intensidad objetivo para poder
              calcular.
            </p>
          )}
          {isProfileComplete && routeModeIncomplete && (
            <p className="text-[11px] text-neutral-500">
              Selecciona una ruta e intensidad objetivo para poder calcular.
            </p>
          )}
          {!isProfileComplete && <ProfileRequiredBanner />}
        </div>

        {error && <p className="text-sm text-status-warning">{error}</p>}

        {result && (
          <div
            ref={resultRef}
            className="scroll-mt-20 border-t border-neutral-200 pt-4"
          >
            {isOfflineCache && (
              <div className="mb-4 flex items-center gap-1.5 border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700">
                <Zap className="size-3.5 shrink-0" />
                Estrategia guardada en caché (Modo Offline)
              </div>
            )}

            <div className={numberedCardClass}>
              <span className="mb-3 block font-mono text-xs font-semibold tracking-wider text-zinc-500">
                03 · Metabolismo y objetivos calculados
              </span>

              {/* Cuadrícula de objetivos por hora + total — 2x2 en móvil,
                  una sola fila de 4 columnas a partir de `lg:` ("Layout
                  Desktop Responsive para Card 03"), ya que en escritorio hay
                  ancho de sobra para las 4 tarjetas sin comprimirlas.
                  `*:min-w-0` lets each cell shrink below its content's
                  intrinsic width instead of forcing the grid track wider
                  (the default `min-width: auto` grid items get otherwise),
                  so a long number/tooltip trigger can never push this card
                  past the viewport edge on a narrow phone. "Test A/B/C/D"
                  converged — this card briefly ran 4 side-by-side tile
                  treatments (Crema Táctico, Taupe/Bronce Sutil, Blanco Puro +
                  Borde Bronce, Gris Táctico Suave) as a deliberately
                  inconsistent live comparison; a DevTools-inspected winner
                  (flat `#f0f0f0`, no border, a small `4px` radius) now
                  applies to all 4 tiles identically. Labels stay the plain
                  "Duración"/"Carbohidratos"/"Hidratación"/"Sodio" text and
                  the big figure stays high-contrast `zinc-900`. */}
              <div className="grid grid-cols-2 gap-3 *:min-w-0 lg:grid-cols-4">
                <div className="flex flex-col justify-between gap-1 rounded-[4px] border-none bg-[#f0f0f0] p-4 shadow-none">
                  <span className="font-mono text-[11px] text-zinc-500">Duración</span>
                  <span className="font-sans text-2xl font-bold text-zinc-900 tabular-nums">
                    {formatHoursMinutes(result.durationHours)}
                  </span>
                  <MetricAccentLine />
                </div>
                <div className="relative flex flex-col justify-between gap-1 overflow-visible rounded-[4px] border-none bg-[#f0f0f0] p-4 shadow-none">
                  <span className="flex items-center gap-1">
                    <span className="font-mono text-[11px] text-zinc-500">Carbohidratos</span>
                    <FuelingContextTooltips carbsGPerHour={result.carbsGPerHour} />
                  </span>
                  <span className="font-sans text-2xl font-bold text-zinc-900 tabular-nums">
                    {result.carbsGPerHour}
                    <span className="ml-1 text-xs font-normal text-zinc-500">g/h</span>
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    Total: {result.totalRideCarbsG} g
                  </span>
                  <MetricAccentLine />
                </div>
                <div className="flex flex-col justify-between gap-1 rounded-[4px] border-none bg-[#f0f0f0] p-4 shadow-none">
                  <span className="font-mono text-[11px] text-zinc-500">Hidratación</span>
                  <span className="font-sans text-2xl font-bold text-zinc-900 tabular-nums">
                    {result.fluidLossMlPerHour}
                    <span className="ml-1 text-xs font-normal text-zinc-500">ml/h</span>
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    Total: {(totalFluidMl / 1000).toFixed(1)} L
                  </span>
                  <MetricAccentLine />
                </div>
                <div className="flex flex-col justify-between gap-1 rounded-[4px] border-none bg-[#f0f0f0] p-4 shadow-none">
                  <span className="font-mono text-[11px] text-zinc-500">Sodio (Na+)</span>
                  <span className="font-sans text-2xl font-bold text-zinc-900 tabular-nums">
                    {result.sodiumMgPerHour}
                    <span className="ml-1 text-xs font-normal text-zinc-500">mg/h</span>
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    Total: {totalSodiumMg} mg Na+
                  </span>
                  <MetricAccentLine />
                </div>
              </div>

              {/* Línea separadora */}
              <hr className="my-6 border-t border-zinc-200/80" />

              {/* Caso Límite: Ruta Corta (<60 min) */}
              {result.durationHours < 1 && !result.trainLow && (
                <div className="mb-4 rounded-r-md border-l-2 border-neutral-900 bg-neutral-50/80 p-3.5 font-mono text-xs">
                  <div className="mb-1 flex items-center gap-1.5 font-bold uppercase tracking-wide text-neutral-900">
                    <Zap className="size-3.5 text-neutral-900" />
                    Ruta Corta (&lt;60 min): Estrategia Pre-Ruta
                  </div>
                  <p className="font-mono text-xs leading-snug text-neutral-700">
                    A esta duración, la ingesta en ruta no aporta beneficio metabólico significativo.
                    Focaliza la nutrición en la <strong className="text-neutral-900">Carga Previa</strong> (1-4h antes) y considera{" "}
                    <strong className="text-neutral-900">enjuague bucal de carbohidratos</strong> (Carb Rinsing) en esfuerzos de alta intensidad para activación del SNC sin carga digestiva.
                  </p>
                </div>
              )}

              {/* Caso Límite: Estrés Térmico Extremo (≥28°C) */}
              {result.weather.temperatureC >= 28 && !result.trainLow && (
                <div className="mb-4 rounded-r-md border-l-2 border-amber-600 border-y border-r border-amber-200/60 bg-[#fcf8f2] p-3.5 font-mono text-xs">
                  <div className="mb-1 flex items-center gap-1.5 font-bold uppercase tracking-wide text-amber-900">
                    <TriangleAlert className="size-3.5 text-amber-600" />
                    Estrés Térmico Extremo ({Math.round(result.weather.temperatureC)}°C)
                  </div>
                  <p className="font-mono text-xs leading-snug text-neutral-800">
                    Con temperaturas ≥28°C, prioriza la prescripción en formato{" "}
                    <strong className="text-amber-950">100% líquido/isotónico</strong> para evitar distensión gástrica por desviación del flujo sanguíneo.
                    Activado patrón <strong className="text-amber-950">Mix Calor</strong> (~4.5g sales / 1.100mg Na+ por bidón de 550ml) y cadencia de trago acelerada a cada{" "}
                    <strong className="text-amber-950">12 min</strong>.
                  </p>
                </div>
              )}

              {/* Nota Avanzada: Ratio Fructosa:Glucosa (solo Modo Avanzado con >75g/h) */}
              {experienceMode === "advanced" && result.carbsGPerHour > 75 && (
                <div className="mb-4 rounded-md border border-neutral-200 bg-neutral-50/80 p-3.5 font-mono text-xs">
                  <div className="mb-1 flex items-center gap-1.5 font-bold uppercase tracking-wide text-neutral-900">
                    <FlaskConical className="size-3.5 text-neutral-900" />
                    Control de Transportadores (SGLT1 + GLUT5)
                  </div>
                  <p className="font-mono text-xs leading-snug text-neutral-700">
                    Tasa &gt;75g/h: se aplica ratio{" "}
                    <strong className="text-neutral-900">1:0.8 maltodextrina:fructosa</strong> para activar SGLT1 y GLUT5 simultáneamente.
                    {result.carbsGPerHour > 90 && (
                      <span className="block mt-1 text-[10px] text-neutral-500">
                        ⚡ A {result.carbsGPerHour}g/h (modo avanzado activo), verifica que tu protocolo de Gut Training soporte esta tasa sin distensón gastrointestinal.
                      </span>
                    )}
                  </p>
                </div>
              )}

              {/* Weather Impact Card */}
              <div className="pt-2">
                <WeatherImpactCard
                  temperatureC={result.weather.temperatureC}
                  temperatureMaxC={result.weather.temperatureMaxC}
                  humidityPct={result.weather.humidityPct}
                  windSpeedKmh={result.weather.windSpeedKmh}
                  source={result.weather.source}
                  multiPointSample={result.weather.multiPointSample}
                  lapseRateAdjustmentC={result.weather.lapseRateAdjustmentC}
                  altitude={result.weather.altitude}
                  weatherPoints={result.weather.weatherPoints}
                  elevationProfile={result.weather.elevationProfile}
                />
              </div>

              {/* "Adaptación Térmica Extrema" — cold below 8°C, heat above
                  32°C, both driven by the same final temperature
                  `WeatherImpactCard` already shows above. Purely
                  informational (the actual recipe/sodium/bottle-plan
                  adjustments already happened server-side) so the athlete
                  understands *why* the numbers below look different from a
                  normal-weather calculation. Cold stays a neutral nested
                  zinc box, heat is a light amber banner (`bg-amber-50/80
                  border-amber-200/80 text-amber-900`) — the same technical
                  warning treatment as every other alert in this card/Card
                  05, per "Unificación de Lienzo Claro" replacing the old
                  dark-amber-on-obsidian pairing. */}
              {result.thermalAdaptation.isExtremeCold && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-zinc-200/70 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                  <Snowflake className="mt-0.5 size-3.5 shrink-0 text-zinc-500" />
                  <span>
                    Frío extremo (&lt;8°C) — prioriza comida sólida/geles en bolsillo (hasta un
                    70-80% del objetivo) y hemos reducido la concentración del bidón para evitar
                    sobrecarga hídrica.
                  </span>
                </div>
              )}
              {result.thermalAdaptation.isExtremeHeat && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200/80 bg-amber-50/80 p-3.5 font-mono text-xs text-amber-900">
                  <Sun className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                  <span>
                    Calor sofocante (&gt;32°C) — sodio elevado a ≥900mg/L y reservamos al menos 1
                    bidón de agua pura para termorregulación/aclarado bucal.
                  </span>
                </div>
              )}

              {/* "Ajuste del Modal de Límite Digestivo" — the old copy
                  ("Puedes aumentar tu capacidad digestiva en la pestaña
                  Perfil") read as if flipping a number in a settings form
                  is what raises real absorption capacity, which isn't
                  true — the cap only ever moves by actually training the
                  gut's own SGLT1/GLUT5 transporters over weeks, not by
                  editing a field. Reworded to state plainly *why* the
                  pauta was capped (protecting the athlete from real GI
                  distress) and point at the actual mechanism (the Gut
                  Training protocol) instead of implying a quick fix.
                  The "Ver cómo entrenar..." link opens `/perfil` in a new
                  tab (`target="_blank"`) rather than navigating away in
                  this one — the reasoning documented here previously (a
                  same-tab click would abandon whatever the athlete has
                  already configured in this planner) still holds; a new
                  tab keeps that protection while still answering "how do I
                  fix this." Suppressed under Train Low — a low intake by
                  design isn't a gut-capacity limitation worth warning
                  about. Light amber alert treatment, matching the heat
                  warning above and every other alert box in this card/Card
                  05. */}
              {result.gutTraining.isGutLimited && !result.trainLow && (
                <div className="mt-3 flex flex-col gap-1.5 rounded-xl border border-amber-200/80 bg-amber-50/80 p-3.5 font-mono text-xs text-amber-900">
                  <span className="font-bold tracking-wide text-amber-800 uppercase">
                    Límite digestivo superado
                  </span>
                  <p>
                    Esta ruta requiere ~{result.gutTraining.uncappedGPerHour} g/h de HC para un
                    rendimiento óptimo, pero tu tope actual configurado es de{" "}
                    {result.gutTraining.gutCapGPerHour} g/h. RATIO Velo ha limitado tu pauta a{" "}
                    {result.gutTraining.gutCapGPerHour} g/h para evitar problemas
                    gastrointestinales en ruta.
                  </p>
                  <p>
                    Para absorber tasas más altas sin molestias, necesitas seguir un protocolo de
                    Entrenamiento Intestinal (Gut Training).
                  </p>
                  <a
                    href="/perfil#gut-training"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 w-fit font-mono font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900"
                  >
                    [ Ver cómo entrenar el intestino en Perfil ]
                  </a>
                </div>
              )}
            </div>

            {/* 🎴 Tarjeta 2 · 04 · Logística de salida (Carga desde casa) —
                "Refactor de Card 04 y 05" reframes this card conceptually:
                it's no longer a generic "simulator," it's specifically
                about what the athlete physically loads onto the bike
                (bottles + pockets) before leaving the house — the bottle-
                role preference plus the pocket-food inventory, rendered
                flat (no `<details>` accordion) since this card's own header
                already frames the whole section. Both the bottle selector
                *and* every pocket-food stepper feed the sticky balance bar
                above them live — see `getBottleCarbsContributionG` for how
                the bottle choice turns into a CARGA DE CASA figure. No
                trailing "Gasto/Ingesta/Déficit" summary, no "pulsa Calcular
                de nuevo" footer note — "Al Grano": this card is the
                interactive simulator, nothing else (Card 05 is where the
                remainder — RESTANTE RUTA — gets reconciled against a
                planned stop). */}
            <div className={numberedCardClass}>
              <span className="mb-3 block font-mono text-xs font-semibold tracking-wider text-zinc-500">
                04 · Logística de salida (Carga desde casa)
              </span>

              {/* "Modo Eficiencia Metabólica" badge — a quiet reminder,
                  once the athlete has already opted in via Card 02's
                  checkbox, of why OBJETIVO below reads so much lower than
                  a normal ride at this same intensity/duración. */}
              {result.trainLow && (
                <div className="mb-3 flex items-start gap-2 rounded-sm border border-zinc-200/70 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                  <Gauge className="mt-0.5 size-3.5 shrink-0 text-zinc-500" />
                  <span>
                    Modo Eficiencia Metabólica: objetivo de HC reducido para estimular la
                    oxidación de grasas.
                  </span>
                </div>
              )}

              {/* Texto explicativo — frames the whole card's own purpose
                  (what to physically load) and hands off the remainder to
                  Card 05 explicitly, so a nonzero RESTANTE never reads as
                  this card having failed to do its job. Deliberately in
                  normal document flow, *not* inside the sticky strip below
                  (see that div's own doc comment for why), and now shrunk
                  to a micro `text-[10px]` (was `text-xs`) to free up more
                  vertical space above the sticky strip for whatever the
                  athlete is actually configuring. */}
              <p className="mb-3 font-mono text-[10px] leading-snug text-zinc-400 sm:text-[11px]">
                Configura lo que llevarás físicamente en la bici. El restante lo cubrirás
                con tus paradas en ruta o avituallamientos.
              </p>

              {/* Tira Resumen Sticky — "Anclaje Sticky por Contenedor
                  Padre": sticks within *this card* only, since its
                  containing block is Card 04's own root `<div>` (a plain
                  sibling of Card 05's, not a shared ancestor) — the bar
                  naturally un-sticks and scrolls away the instant Card 04's
                  own bottom edge passes the sticky offset, with zero extra
                  JS needed for that release. Recomputes instantly from
                  `coveredCarbsG`/`remainingCarbsG` (pure client-side
                  arithmetic, reacting to *both* the bottle selector and
                  every pocket-food stepper) — no network round-trip, no
                  need to press "Calcular" again just to see the coverage
                  change. `top-16 lg:top-4` clears the mobile header (`fixed
                  top-0 z-50`, ~64px tall, `lg:hidden`) so the bar never
                  renders underneath it (and never overlaps the "RATIO"
                  wordmark) — bumped up from an earlier `top-14` (56px),
                  which left the bar's own top edge 8px short of the
                  header's real bottom edge, clipping visibly behind it on
                  a real device; desktop has no such header, so it sticks
                  close to the viewport's own top instead — this only works
                  because none of this component's ancestors (a plain `<div>`
                  root, per "Estandarización de Tarjetas" above — no more
                  shared `<Card>` primitive, which used to need an explicit
                  `overflow-visible` override to stop its own base
                  `overflow-hidden` from defeating this) set `overflow:
                  hidden`/`clip`/`auto`, and Card 04's own container below
                  carries no such class either. Bronce
                  elegante (`#70685b`, this app's own terracotta/bronze
                  accent) fill — the HUD reads as its own distinct floating
                  register rather than blending into the same accent every
                  selector's active state already uses.

                  Back to a single compact row (superseding an earlier
                  3-column grid pass) — `flex-wrap` is kept as a quiet
                  safety net so an unusually large figure still wraps onto
                  a second line instead of silently clipping, without
                  changing how this reads in the normal case.
                  `getRemainingCarbsTextClass` (the shared 2-state
                  amber/emerald semáforo) still decides RESTANTE's color —
                  a ride that's already fully covered reads emerald here,
                  not a flat amber regardless of state. */}
              <div className="sticky top-16 z-20 my-3 rounded-md border border-neutral-200/80 bg-[#fcfbf9] p-3.5 text-neutral-900 shadow-xs transition-all lg:top-4">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 font-mono text-xs font-bold">
                  <span className="text-neutral-900">OBJETIVO: {result.totalRideCarbsG}g HC</span>
                  <span className="text-neutral-300">|</span>
                  <span className="text-neutral-900">CASA: {coveredCarbsG}g HC</span>
                  <span className="text-neutral-300">|</span>
                  <span className={getRemainingCarbsTextClass(remainingCarbsG)}>
                    RESTANTE: {remainingCarbsG}g HC
                  </span>
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                    <div
                      className="h-full bg-[#70685b] transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.round((coveredCarbsG / (result.totalRideCarbsG || 1)) * 100))}%`,
                      }}
                    />
                  </div>
                  <span className="shrink-0 font-mono text-[10px] font-semibold text-neutral-500">
                    {Math.min(100, Math.round((coveredCarbsG / (result.totalRideCarbsG || 1)) * 100))}%
                  </span>
                </div>
              </div>

              <hr className="border-t border-zinc-200/70 my-6" />

              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className={formFieldLabelClass}>Configuración de bidones</span>
                {/* "Micro-Edición In-Situ de Capacidad de Bidón" — a
                    display-only preview of a different bottle size than the
                    athlete's saved profile, re-scaling the per-bottle grams
                    (and the reload-strategy Ziploc bag dose, see "Reload
                    strategy" in the recipe engine) everywhere below with
                    zero server round-trip (see `displayBottlePlan`). */}
                {displayBottlePlan && (
                  <div className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-500">
                    <span>
                      Capacidad de bidón:{" "}
                      <span className="font-semibold text-zinc-900">
                        {displayBottlePlan.bottleSizeMl}ml
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setBottleCapacityEditorOpen((v) => !v)}
                      className="flex cursor-pointer items-center gap-1 font-mono text-xs font-semibold text-[#70685b] transition-colors duration-150 hover:text-[#585248] hover:underline"
                    >
                      <Pencil className="size-3" />
                      Cambiar
                    </button>
                  </div>
                )}
              </div>
              {bottleCapacityEditorOpen && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {BOTTLE_CAPACITY_QUICK_OPTIONS.map((ml) => (
                    <button
                      key={ml}
                      type="button"
                      onClick={() => {
                        setBottleCapacityOverrideMl(ml);
                        setBottleCapacityEditorOpen(false);
                      }}
                      className={cn(
                        "rounded-sm border px-2.5 py-1 font-mono text-[11px] font-semibold shadow-none transition-colors duration-150",
                        displayBottlePlan?.bottleSizeMl === ml
                          ? "border-transparent bg-[#70685b] text-white hover:bg-[#60594e]"
                          : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400"
                      )}
                    >
                      {ml}ml
                    </button>
                  ))}
                </div>
              )}
              {/* Fixed row at every width — short Title Case labels ("Solo
                  Agua"/"1 Mix"/"Ambos Mix", or "Solo Agua"/"Con Mix" on a
                  1-cage bike) keep this legible even on a narrow phone, so
                  this never needs to drop to a single stacked column the
                  way the old, longer labels did. `athleteBottleCount === 1`
                  (the athlete's real `athlete_profiles.bottle_count`) drops
                  "Ambos Mix" entirely rather than showing it disabled — a
                  second mix bottle simply doesn't fit on a 1-cage bike — so
                  the grid itself goes from 3 to 2 columns to match. */}
              <div className={cn("grid gap-2 *:min-w-0", bottleConfigOptions.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
                {bottleConfigOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setBottleConfig(opt.value)}
                    className={cn(
                      segmentedButtonClass,
                      bottleConfig === opt.value
                        ? "border-transparent bg-[#70685b] text-white hover:bg-[#60594e]"
                        : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400"
                    )}
                  >
                    <span className={segmentedButtonLabelClass}>{opt.label}</span>
                  </button>
                ))}
              </div>

              {/* "Tip de Eficiencia: Mix vs. Solo Agua" — purely advisory,
                  never changes the actual recipe/bottle-plan math (unlike
                  the bottle-config buttons above it). Disappears the
                  instant the athlete picks "1 Mix"/"Ambos Mix" — it's a
                  suggestion for the current selection, not a persistent
                  warning. Renders through the shared `AlertBanner` — the
                  same 2-column component every "aviso" in Card 05 below
                  uses too, so every alert box in this results flow reads as
                  one consistent language. */}
              {showWaterOnlyMixTip && (
                <AlertBanner tone="warning" icon="💡" label="Tip de Eficiencia" className="mt-2.5">
                  En rutas de alta exigencia o calor, cambiar{" "}
                  <span className="underline decoration-amber-400">1 o ambos bidones</span> a Mix libera
                  espacio en tus bolsillos y acelera la hidratación.
                </AlertBanner>
              )}

              <hr className="border-t border-zinc-200/70 my-6" />

              {/* Inventario de Bolsillo Interactivo — "Lista Definitiva de
                  Casa": a fixed, always-visible 4-row list (Plátano/Dátiles/
                  Gominolas + "Personalizado"), always editable, no toggle
                  or editor needed since the catalog itself is already this
                  short (see the deleted "Mi Despensa" machinery above). */}
              <div>
                <span className={cn(formFieldLabelClass, "mb-2 block")}>Comida en bolsillo</span>
                <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-x-4 md:gap-y-0">
                  {POCKET_FOOD_TYPES.map((type) => (
                    <PocketFoodStepperRow
                      key={type}
                      label={pocketFoodDisplayName(type)}
                      carbsG={POCKET_FOOD_CARBS_G[type]}
                      ariaLabel={pocketFoodLabels[type]}
                      qty={pocketFood[type] ?? 0}
                      onChange={(qty) => setPocketFoodQty(type, qty)}
                    />
                  ))}
                  <div className="flex items-center justify-between gap-2 border-b border-zinc-100 py-2 last:border-b-0">
                    <label htmlFor="custom-carbs" className="text-sm text-neutral-900">
                      Personalizado
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        id="custom-carbs"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={MAX_CUSTOM_CARBS_G}
                        value={customCarbsG || ""}
                        onChange={(e) => setCustomCarbsG(Math.max(0, Number(e.target.value) || 0))}
                        placeholder="0"
                        className="w-16 rounded-sm border border-neutral-300 bg-white px-2 py-1 text-right font-mono text-sm text-neutral-900 shadow-sm outline-none hover:border-neutral-400 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                      />
                      <span className="font-mono text-xs text-neutral-500">g HC</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* "Selector de Marcas vía Bottom Sheet" — real branded
                  products (Maurten, 226ERS, SiS, Santa Madre, Neversecond,
                  Precision Fuel), each with a real sodium figure the
                  generic pocket-food catalog above never carried (see
                  `lib/constants/nutrition-brands.ts`). The old always-
                  expanded, brand-grouped 12-row list collapsed Card 04
                  vertically on a narrow phone — the full catalog now lives
                  behind `CommercialProductsSheet`, a bottom-sheet modal;
                  Card 04 itself only ever renders the athlete's own
                  already-selected rows (`selectedCommercialProducts`) plus
                  a small trigger link. Every selection still feeds both
                  the CUBIERTO/RESTANTE pill above (`commercialCarbsG`) and
                  Card 05's sodium balance check (`commercialSodiumMg`,
                  combined with the bottle's own sodium into
                  `totalSodiumCoveredMg`), live, whether it was just added
                  from the sheet or is being adjusted right here. */}
              <div className="mt-8">
                <span className={formFieldLabelClass}>Productos de nutrición</span>
                {selectedCommercialProducts.length > 0 && (
                  <div className="mt-2 flex flex-col">
                    {selectedCommercialProducts.map((product) => (
                      <CommercialProductStepperRow
                        key={product.id}
                        product={product}
                        qty={commercialProducts[product.id] ?? 0}
                        onChange={(qty) => setCommercialProductQty(product.id, qty)}
                      />
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setCommercialProductsSheetOpen(true)}
                  className="block cursor-pointer py-2 font-mono text-xs text-[#70685b] hover:underline"
                >
                  + Añadir producto de nutrición
                </button>
                {commercialCarbsG > 0 && (
                  <p className="font-mono text-[11px] text-zinc-500">
                    {commercialCarbsG}g HC · {commercialSodiumMg}mg Na+ desde marcas reales
                  </p>
                )}
              </div>

              {/* "Flujo Deliberado de Generación para Card 05" — Card 05
                  (Manifiesto de Salida) no calcula ni muestra nada hasta que
                  este botón se pulsa al menos una vez; ver
                  `isManifestGenerated`/`handleGenerateManifest` arriba. */}
              <button
                type="button"
                onClick={handleGenerateManifest}
                disabled={Boolean(isInputsChanged)}
                className={cn(
                  "mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 py-4 font-mono text-xs font-bold tracking-wider text-white uppercase transition-colors hover:bg-neutral-800",
                  isInputsChanged && "cursor-not-allowed opacity-60 hover:bg-neutral-900"
                )}
                title={isInputsChanged ? "Recalcula la estrategia primero (Paso 02)" : undefined}
              >
                <Zap className="size-3.5 shrink-0" />
                <span>{isPlanDirty ? "Actualizar Manifiesto de Salida" : "Generar Manifiesto de Salida"}</span>
              </button>
            </div>

            <CommercialProductsSheet
              open={commercialProductsSheetOpen}
              onOpenChange={setCommercialProductsSheetOpen}
              quantities={commercialProducts}
              onChangeQty={setCommercialProductQty}
            />
            {/* "Planificación de Paradas en Ruta" (the selector itself)
                moved entirely to Card 02 (Condiciones de la salida) — see
                the "Paradas previstas en ruta" sub-section there. A stop is
                a departure-planning decision the athlete makes alongside
                intensity/fecha, not an avituallamiento config choice, so
                keeping its own selector here would have duplicated the one
                sitting in Card 02. "Desvinculación de Paradas del Cálculo
                de Carbohidratos" — the per-stop carb-suggestion preview
                (and the "Cronograma dinámico de ingesta"/"Plan de paradas
                en ruta" entries it used to feed here) is gone entirely now,
                not just relocated — see `coveredCarbsG`'s own doc comment
                above for why. */}

            {/* 🎴 Tarjeta 3 · 05 · Manifiesto de Salida — "100% Español +
                Estilo PNS": this card was briefly the one deliberate
                dark-surface exception in the results flow (obsidian black
                `#18181B`) — reverted to the same flat white "tarjeta madre"
                (`bg-white border border-zinc-200`) as Cards 03/04, per
                "Unificación de Lienzo Claro." No dashed borders anywhere in
                this card (the old "ticket/manifiesto" perforation aesthetic
                is gone outright, not just recolored) — every internal
                section is its own bordered light `bg-zinc-50` sub-box or
                simply separated by the parent's own `gap-4`, and every
                subtitle in the card (`manifestSubtitleClass`) shares one
                exact typographic style. Still 2 core blocks in order —
                Cronograma (when to eat/drink) then Equipamiento (what to
                bring) — with the déficit alert and carb-loading module as
                their own conditional overlays around them, same structure
                as before, just restyled onto the shared light palette. The
                athlete screenshots this card if they want to save or share
                it — no export button lives here. */}
            <div ref={card05Ref} className={cn(numberedCardClass, "relative flex flex-col gap-4")}>
              {/* Consolidated dirty banner — the ONLY staleness indicator
                  in the whole planner (Cards 01-04 never show one, see
                  `isInputsChanged`'s call sites elsewhere in this file).
                  `isPlanDirty` already covers both causes a manifest can go
                  stale for: a Paso 01/02 edit (`isInputsChanged`, which also
                  requires a fresh server recalculation) or a Card 04
                  inventory edit (`isInventoryDirty`, snapshot-only) —
                  `handleRecalculateManifest` resolves whichever one it is. */}
              {isPlanDirty && (
                <div className="mb-4 flex flex-col items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex items-center gap-1.5 font-mono text-xs text-amber-900">
                    <span className="size-1.5 shrink-0 rounded-full bg-amber-500 animate-pulse" />
                    Has modificado datos en la configuración · Recalcula para actualizar la
                    altimetría
                  </span>
                  <button
                    type="button"
                    onClick={handleRecalculateManifest}
                    disabled={loading}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 font-mono text-xs font-bold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCw className={cn("size-3.5 shrink-0", loading && "animate-spin")} />
                    {loading ? "Recalculando…" : "Recalcular Manifiesto"}
                  </button>
                </div>
              )}
              <span className="font-mono text-xs font-semibold tracking-wider text-zinc-500">
                05 · Manifiesto de salida
              </span>

              {/* "Flujo Deliberado de Generación" — Card 05 no calcula/
                  renderiza nada de lo que sigue hasta que el atleta pulsa
                  "Generar Manifiesto de Salida" (pie de Card 04) al menos
                  una vez para el `result` actual — antes de eso, un estado
                  "pendiente" explícito reemplaza todo el cuerpo de la
                  tarjeta. Una vez generado, si el inventario de Card 04
                  (bidones/comida de bolsillo/productos comerciales) cambia
                  desde entonces, un velo semi-transparente cubre el
                  contenido (ya renderizado, no recalculado en directo) con
                  un aviso explícito para forzar una actualización deliberada
                  en vez de dejar que el contenido cambie de estado por su
                  cuenta mientras el atleta sigue editando. */}
              {!isManifestGenerated ? (
                <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/60 p-6 text-center">
                  <ClipboardList className="mx-auto size-6 text-zinc-400" />
                  <p className="mt-2 font-mono text-xs font-semibold text-zinc-600">
                    Manifiesto pendiente de generación
                  </p>
                  <p className="mt-1 font-mono text-[11px] leading-snug text-zinc-500">
                    Configura tus bidones y comida de bolsillo en el Paso 04 y pulsa{" "}
                    <span className="font-semibold text-zinc-700">
                      &ldquo;Generar Manifiesto de Salida&rdquo;
                    </span>{" "}
                    para ver tu ficha de ruta, altimetría táctica y equipamiento.
                  </p>
                </div>
              ) : (
                <>
                  {/* The dirty-state banner (above, keyed off `isPlanDirty`)
                      is the one place this staleness is surfaced now — this
                      inner veil just dims the already-rendered content
                      underneath it so stale numbers don't read as current
                      while that banner is up. */}
                  <div className={cn(isPlanDirty && "pointer-events-none opacity-40 blur-[1px] select-none")}>
              {!result.trainLow && (
                <>
                  {/* Validador Hídrico: Recargas de agua necesarias vs Paradas seleccionadas */}
                  {fullRefillsNeeded > cafeteriaStopCount && (
                    <div className="mb-4 rounded-r-md border-l-2 border-y border-r border-amber-600 border-amber-200/60 bg-[#fcf8f2] p-3 shadow-xs">
                      <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-amber-900">
                        <TriangleAlert className="size-3.5 shrink-0 text-amber-600" />
                        <span>Incompatibilidad Hídrica</span>
                      </div>
                      <p className="mt-1.5 font-mono text-xs leading-snug text-neutral-800">
                        {cafeteriaStopCount === 0 ? (
                          <>
                            Tu tasa de sudoración requiere <span className="font-semibold text-amber-950">{totalFluidMl} ml</span> de agua, pero solo dispones de <span className="font-semibold text-amber-950">{installedCapacityMl} ml</span> (2 bidones de 550ml). Al seleccionar 0 paradas entrarás en déficit hídrico severo. Se recomienda planificar al menos 1 parada técnica.
                          </>
                        ) : (
                          <>
                            Tu tasa de sudoración requiere <span className="font-semibold text-amber-950">{fullRefillsNeeded} recarga{fullRefillsNeeded !== 1 ? "s" : ""} de agua</span>, pero has seleccionado <span className="font-semibold text-amber-950">{cafeteriaStopCount} parada{cafeteriaStopCount !== 1 ? "s" : ""}</span>. Aumenta el tamaño de tus bidones desde casa o añade paradas en ruta.
                          </>
                        )}
                      </p>
                    </div>
                  )}

                  {fullRefillsNeeded > 0 && cafeteriaStopCount >= fullRefillsNeeded && (
                    <div className="mb-4 flex items-start justify-between space-y-1 rounded-md bg-neutral-900 p-3.5 text-white shadow-xs">
                      <div>
                        <div className="flex items-center gap-2 font-mono text-[10px] tracking-wider uppercase text-neutral-400">
                          <CheckCircle2 className="size-3.5 shrink-0 text-amber-400" />
                          <span>Plan Hídrico Validado</span>
                        </div>
                        <p className="mt-1 font-mono text-xs leading-snug text-neutral-200">
                          Tus <strong className="font-semibold text-white">{cafeteriaStopCount} parada{cafeteriaStopCount !== 1 ? "s" : ""}</strong> cubren las{" "}
                          <strong className="font-semibold text-white">{fullRefillsNeeded} recarga{fullRefillsNeeded !== 1 ? "s" : ""}</strong> requerida{fullRefillsNeeded !== 1 ? "s" : ""}.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Nutrición en ruta (Carbohidratos) */}
                  {remainingCarbsG > 0 && cafeteriaStopCount > 0 && (
                    <div className="mb-4 rounded-r-md border-l-2 border-neutral-900 bg-neutral-50/80 p-3 font-mono text-xs text-neutral-700">
                      <span className="font-bold uppercase tracking-wide text-neutral-900">Estrategia de Ruta:</span> Llevas{" "}
                      <strong className="text-neutral-900">{coveredCarbsG}g HC</strong> desde casa. Los{" "}
                      <strong className="text-neutral-900">{remainingCarbsG}g HC</strong> restantes se reponen en tus paradas.
                    </div>
                  )}

                  {remainingCarbsG > 0 && cafeteriaStopCount === 0 && (
                    <div className="mb-4 rounded-r-md border-l-2 border-y border-r border-amber-600 border-amber-200/60 bg-[#fcf8f2] p-3 shadow-xs">
                      <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold tracking-wider text-amber-900 uppercase">
                        <TriangleAlert className="size-3.5 shrink-0 text-amber-600" />
                        <span>Déficit de Nutrición</span>
                      </div>
                      <p className="mt-1.5 font-mono text-xs leading-snug text-neutral-800">
                        Faltan <strong className="font-semibold text-amber-950">{remainingCarbsG}g HC</strong> para cubrir el gasto glucogénico ({result.totalRideCarbsG}g HC). Selecciona más comida de bolsillo o añade paradas en ruta.
                      </p>
                    </div>
                  )}

                  {remainingCarbsG === 0 && fullRefillsNeeded === 0 && (
                    <div className="mb-4 flex items-start justify-between space-y-1 rounded-md bg-neutral-900 p-3.5 text-white shadow-xs">
                      <div>
                        <div className="flex items-center gap-2 font-mono text-[10px] tracking-wider uppercase text-neutral-400">
                          <CheckCircle2 className="size-3.5 shrink-0 text-amber-400" />
                          <span>Cobertura Completa</span>
                        </div>
                        <p className="mt-1 font-mono text-xs leading-snug text-neutral-200">
                          Tu carga inicial de casa cubre el 100% del objetivo glucogénico de la salida.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* "Sugerencia de Sodio (Bici + Bolsillos)" */}
              {showSodiumSuggestion && (
                <div className="mb-4 rounded-r-md border-l-2 border-neutral-900 bg-neutral-50/80 p-3.5 font-mono text-xs text-neutral-700">
                  <div className="mb-1 flex items-center gap-1.5 font-bold uppercase tracking-wide text-neutral-900">
                    <Lightbulb className="size-3.5 text-neutral-900" />
                    Sugerencia de electrolitos
                  </div>
                  Te faltan <strong className="text-neutral-900">{Math.round(sodiumDeficitMg)} mg Na+</strong> para cubrir tu ruta. Equivale a añadir{" "}
                  <strong className="text-neutral-900">{saltCapsulesNeeded} cápsula{saltCapsulesNeeded !== 1 ? "s" : ""} de sal</strong> en bolsillo o{" "}
                  <strong className="text-neutral-900">{evolytesGramsNeeded}g de Evolytes</strong> extra en recargas.
                </div>
              )}

              {/* Tarjeta de Acción Altimétrica — action card + modal */}
              {result.weather.elevationProfile && (
                <GpxAltimetryPreview
                  points={result.weather.elevationProfile}
                  totalDistanceKm={selectedRoute?.distanceKm ?? parsedGpx?.distanceKm ?? null}
                  tacticalPoints={tacticalPoints}
                />
              )}


              {/* Cadencia de hidratación y Estrategia por Tramos (Stint Strategy) */}
              <div className="rounded-xl border border-zinc-200/70 border-l-4 border-l-[#70685b] bg-zinc-50 p-4">
                <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-zinc-400 uppercase">
                  <Droplet className="size-3.5 shrink-0 text-[#70685b]" />
                  Cadencia de hidratación & Estrategia por Tramos
                </span>
                <p className="mt-1 text-sm font-bold text-zinc-900">
                  Beber 1 bidón (~{displayBottlePlan!.bottleSizeMl}ml) cada{" "}
                  <span className="text-[#70685b]">{result.timingTimeline.hydrationIntervalMinutes} min</span>
                </p>
                {result.caffeineSuppressed && (
                  <p className="mt-3 flex items-start gap-1.5 text-xs text-zinc-500">
                    <Moon className="mt-0.5 size-3.5 shrink-0 text-zinc-600" />
                    Cafeína omitida automáticamente por el horario de llegada estimado (≥18:30h)
                    para proteger tu descanso nocturno.
                  </p>
                )}

                {/* Stint Strategy Timeline */}
                <StintStrategyTimeline
                  cafeteriaStopCount={cafeteriaStopCount}
                  durationHours={result.durationHours}
                  distanceKm={selectedRoute?.distanceKm ?? parsedGpx?.distanceKm ?? manualCalcResults?.distanceKm ?? null}
                  entries={mergedTimelineEntries}
                  remainingCarbsG={remainingCarbsG}
                />
              </div>

              {/* "Sodio total aportado (Bici + Bolsillos)" — renamed from
                  "Sodio desde marcas comerciales" and now reads the combined
                  real total (bottle-mix Evolytes + commercial products, see
                  `totalSodiumCoveredMg` above), not commercial products
                  alone. A plain, always-visible readout (not an alert —
                  that's the conditional suggestion above) so the athlete can
                  evaluate their electrolyte balance any time either source
                  contributes sodium, even when coverage is already fine.
                  Same neutral `bg-zinc-50` nested-box treatment as Bloque 1.
                  "Nomenclatura Unificada Na+" — every sodium figure in this
                  card now reads "mg Na+" explicitly rather than a bare "mg,"
                  and the still-outstanding deficit (if any) is translated to
                  operational units directly under the readout — same
                  capsule/Evolytes-gram conversion as the "Sugerencia de
                  electrolitos" banner above, just as a quieter micro-text
                  here rather than a full alert. */}
              {totalSodiumCoveredMg > 0 && (
                <div className="rounded-xl border border-zinc-200/70 bg-zinc-50 p-4">
                  <span className={manifestSubtitleClass}>Sodio total aportado (Bici + Bolsillos)</span>
                  <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm text-zinc-700">
                    <FlaskConical className="size-3.5 shrink-0 self-center text-zinc-500" />
                    <span className="font-mono text-xl font-bold text-zinc-900">{totalSodiumCoveredMg} mg Na+</span>
                    <span className="font-mono text-xs text-zinc-500">de {totalSodiumMg} mg Na+ objetivo</span>
                  </p>
                  {sodiumDeficitMg > 0 && (
                    <p className="mt-1 font-mono text-[11px] text-zinc-400">
                      Faltan {Math.round(sodiumDeficitMg)} mg Na+ (≈ {saltCapsulesNeeded} caps. de sal o{" "}
                      {evolytesGramsNeeded}g de Evolytes)
                    </p>
                  )}
                </div>
              )}

              {/* Bloque 2 · Resumen de Carga (Bici y Bolsillos) —
                  "Rediseño Estructural y Tipográfico": the old 2-column
                  label-left/value-right layout forced every item's name
                  and quantity into a narrow right-aligned column, which
                  wrapped long commercial-product names badly and orphaned
                  trailing units ("...200mg Na+)") onto their own line on a
                  narrow phone. Replaced with one white "tarjeta madre" per
                  category (Bici / Bolsillos / Agua — "Paradas" dropped once
                  the carb-suggestion engine behind it was removed, see
                  `coveredCarbsG`'s own doc comment above), each row
                  strictly left-aligned: a compact bronze quantity badge
                  (`Nx`) first, then a 2-tier text block (bold primary
                  name, an optional micro `specs` second line for macros/
                  prep notes) — nothing here is ever pushed into a
                  right-hand column that could force a wrap. Driven by the
                  same bottle config + pocket-food state as the balance
                  pill in Card 04, so it's never out of sync with what
                  CUBIERTO/RESTANTE currently shows — see
                  `getBikeManifestItems`/`getPocketManifestItems`/
                  `getWaterPlanLine` above. "Bici (bidones)" still renders
                  specially (not through a shared item-list helper) since it
                  alone carries the inline "[ Ver en cazos ]" reveal and the
                  hypertonic-concentration warning; "Plan de agua en ruta"
                  stays its own plain descriptive paragraph (its source data
                  is already a full sentence, not itemized quantities), in
                  its own card rather than itemized rows. */}
              <div className="flex flex-col gap-2">
                <span className="block font-mono text-xs tracking-wider text-zinc-400 uppercase">
                  Resumen de carga (bici y bolsillos)
                </span>
                {bikeManifestItems.length === 0 && pocketManifestItems.length === 0 && !waterPlanLine ? (
                  <p className="text-sm text-zinc-500">
                    Sin bidones ni comida de bolsillo seleccionados todavía.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3 font-mono">
                    {bikeManifestItems.length > 0 && (
                      <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3.5">
                        <div className="flex items-center gap-1.5 border-b border-zinc-100 pb-1.5 text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                          <Bike className="size-3.5 shrink-0" />
                          Bici (bidones)
                        </div>
                        <div className="flex flex-col gap-2 pt-1">
                          {bikeManifestItems.map((item) => (
                            <div key={item.key} className="flex items-start gap-2.5 text-xs">
                              <span className="shrink-0 rounded bg-[#70685b]/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#70685b]">
                                {item.quantity}x
                              </span>
                              <div className="flex flex-col text-left">
                                <span className="leading-snug font-semibold text-zinc-900">
                                  {item.name}
                                  {item.kind === "mix" && (
                                    <>
                                      {" "}
                                      <button
                                        type="button"
                                        onClick={() => setShowBikeScoops((v) => !v)}
                                        className="font-mono text-[11px] font-medium text-terracotta underline-offset-2 hover:underline"
                                      >
                                        [ {showBikeScoops ? "▲" : "▼"} Ver en cazos ]
                                      </button>
                                    </>
                                  )}
                                </span>
                                {item.specs && (
                                  <span className="mt-0.5 text-[10px] text-zinc-400">{item.specs}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        {/* Hypertonic-concentration warning — see "Bottle
                            architecture & osmolarity control"
                            (`lib/metabolic-engine.ts`) for why this can
                            fire at all; under every currently-supported
                            bottle size it's a defense-in-depth check, not
                            something routinely seen. */}
                        {bikeManifestItems.some((item) => item.kind === "mix") &&
                          displayBottlePlan!.fuelBottles.concentrationPct > HYPERTONIC_THRESHOLD_PCT && (
                            <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                              <span>
                                Solución hipertónica ({displayBottlePlan!.fuelBottles.concentrationPct}% &gt;{" "}
                                {HYPERTONIC_THRESHOLD_PCT}%) — añade agua o traslada carga a comida de
                                bolsillo.
                              </span>
                            </div>
                          )}
                        {bikeManifestItems.some((item) => item.kind === "mix") && showBikeScoops && (
                          <div className="flex flex-col gap-1 rounded-lg border border-zinc-200/70 bg-zinc-50 p-2.5 text-[11px] text-zinc-600">
                            <p>
                              Maltodextrina: {displayBottlePlan!.fuelBottles.maltodextrinGPerBottle}g (~
                              {fuelBottleMeasures!.maltodextrinScoops} cazos)
                            </p>
                            <p>
                              Fructosa: {displayBottlePlan!.fuelBottles.fructoseGPerBottle}g (~
                              {fuelBottleMeasures!.fructoseScoops} cazos)
                            </p>
                            <p className="font-mono text-neutral-800">
                              <span className="font-semibold text-neutral-900">{electrolyteRec.label}:</span>{" "}
                              {electrolyteRec.saltGrams}g de sales (~{electrolyteRec.sodiumMg} mg Na+)
                            </p>
                            {isHotWeather && (
                              <p className="text-[10px] font-mono text-amber-700">
                                *Clima cálido (≥25°C) o sudoración alta: recomendación ajustada a {electrolyteRec.label}.
                              </p>
                            )}
                            <p className="text-[10px] text-zinc-500">
                              *Equivalencias: 1 cazo de carbos = 30 g | 1 g de Evolytes aporta ~
                              {EVOLYTES_SODIUM_MG_PER_G} mg Na+
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {pocketManifestItems.length > 0 && (
                      <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3.5">
                        <div className="flex items-center gap-1.5 border-b border-zinc-100 pb-1.5 text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                          <Utensils className="size-3.5 shrink-0" />
                          Bolsillos maillot
                        </div>
                        <div className="flex flex-col gap-2.5 pt-1">
                          {pocketManifestItems.map((item) => (
                            <div key={item.key} className="flex items-start gap-2.5 text-xs">
                              {item.quantity != null && (
                                <span className="mt-0.5 shrink-0 rounded bg-[#70685b]/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#70685b]">
                                  {item.quantity}x
                                </span>
                              )}
                              <div className="flex flex-col text-left">
                                <span className="leading-snug font-semibold text-zinc-900">{item.name}</span>
                                {item.specs && (
                                  <span className="mt-0.5 font-mono text-[10px] text-zinc-400">
                                    {item.specs}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {waterPlanLine && (
                      <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-white p-3.5">
                        <span className="flex items-center gap-1.5 border-b border-zinc-100 pb-1.5 text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                          <Droplet className="size-3.5 shrink-0" />
                          Plan de agua en ruta
                        </span>
                        <p className="pt-1 text-left text-xs leading-snug font-semibold text-zinc-800">
                          {waterPlanLine}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* "Estrategia de recarga en ruta" — the old automatic
                  red/warning-toned Ziploc accordion — has been removed
                  outright, per "Eliminación Definitiva de la Tarjeta
                  Roja." It was briefly replaced by a self-serve "Dosis de
                  recarga Mix (Ziploc)" pocket-food row (the athlete
                  declaring how many pre-measured mix doses they carry) —
                  that row is now gone too, per "Limpieza de Despensa
                  Genérica": the same self-serve declaration is still
                  possible via "Personalizado" (free grams) or a real
                  branded product from Marcas Comerciales, without a
                  dedicated generic catalog row for it. `result.reloadStrategy`
                  itself is untouched server-side and still drives
                  `ziplocBagsCount`/`ziplocDose` for a mix-bottle overflow
                  (unaffected by any of this) — the unrelated plain-water
                  fountain refill note above (`getWaterPlanLine`) no
                  longer reads it at all, see "Plan de Agua por Botellas
                  Completas" above for why. */}

              {/* Estrategia de carga día −1 — now always rendered
                  (previously hidden entirely below the duration threshold),
                  branching between the real calculated protocol
                  (`result.carbLoading`, present whenever the ride is
                  genuinely demanding — see `TARGET_EVENT_DURATION_
                  THRESHOLD_HOURS`, 2.5h, in `POST /api/fueling/plan`,
                  or whenever "Ruta objetivo" is checked regardless of
                  duration) and a quiet reassurance note for a moderate
                  ride that never needed supercompensación in the first
                  place — a manifest that silently omits this module below
                  the threshold reads as an oversight, not a deliberate
                  "not needed here." The calculated case keeps its own
                  bronze-tinted "featured card" treatment
                  (`bg-[#70685b]/10 border-[#70685b]/25`) — this is the one
                  supplementary module worth visually standing out; the
                  moderate-ride case uses the same plain gray nested-box
                  treatment every other block in this card uses, since
                  there's nothing urgent to highlight. Both cases render
                  unconditionally (no `<details>` collapse) — the whole
                  point of this Card 05 pass is a fully static, at-a-glance
                  manifest ready to screenshot. The `CalendarDays` lucide
                  icon stands in for a calendar glyph rather than a literal
                  emoji, matching this app's no-emoji convention
                  throughout. */}
              {result.carbLoading ? (
                <div className="rounded-xl border border-[#70685b]/25 bg-[#70685b]/10 p-3.5">
                  <div className="flex items-center justify-between gap-2 font-mono text-xs font-bold text-[#70685b]">
                    <span className="flex items-center gap-1.5 tracking-widest uppercase">
                      <CalendarDays className="size-3.5 shrink-0" />
                      Estrategia de carga día −1
                    </span>
                    <span className="shrink-0">
                      {result.carbLoading.minCarbsG}-{result.carbLoading.maxCarbsG}g HC
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-col gap-1 font-mono text-[11px] leading-tight text-zinc-600">
                    {result.carbLoading.guidelines.map((guideline) => (
                      <p key={guideline}>• {guideline}</p>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-zinc-200/70 bg-zinc-50 p-3.5">
                  <span className="flex items-center gap-1.5 font-mono text-xs font-bold tracking-widest text-zinc-700 uppercase">
                    <CalendarDays className="size-3.5 shrink-0 text-zinc-500" />
                    Estrategia de carga día −1
                  </span>
                  <p className="mt-1.5 font-mono text-[11px] leading-tight text-zinc-600">
                    Ruta moderada. Mantén tu alimentación habitual rica en carbohidratos sin
                    necesidad de supercompensación previa.
                  </p>
                </div>
              )}

              {/* Ventana Anabólica Post-Ruta */}
              <div className="rounded-xl border border-[#70685b]/25 bg-[#70685b]/05 p-3.5">
                <div className="flex items-center gap-1.5 font-mono text-xs font-bold tracking-widest text-[#70685b] uppercase">
                  <Zap className="size-3.5 shrink-0" />
                  Ventana Anabólica Post-Esfuerzo (primeros 30 min)
                </div>
                <div className="mt-1.5 flex flex-col gap-1 font-mono text-[11px] leading-tight text-zinc-700">
                  <p>
                    • <strong className="text-zinc-900">{Math.round(1.2 * (weightKg || 70))}g HC</strong>{" "}
                    (1.2 g/kg) inmediatamente tras la llegada para resintetizar glucógeno muscular.
                  </p>
                  <p>
                    • <strong className="text-zinc-900">{Math.round(0.3 * (weightKg || 70))}g Proteína</strong>{" "}
                    (0.3 g/kg) — inicia el proceso de reparación muscular y estimula la MPS.
                  </p>
                  <p className="mt-0.5 text-[10px] text-zinc-400">
                    Ejemplo: {Math.round(1.2 * (weightKg || 70))}g HC ~ {Math.round((1.2 * (weightKg || 70)) / 17)} plátanos o {Math.round((1.2 * (weightKg || 70)) / 40)} barritas energéticas + batido de proteínas.
                  </p>
                </div>
              </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
    </div>
  );
}

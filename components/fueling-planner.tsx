"use client";

import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Coffee,
  Droplet,
  FlaskConical,
  Gauge,
  Lock,
  Moon,
  Pencil,
  RefreshCw,
  Snowflake,
  Sun,
  TriangleAlert,
  Upload,
  Utensils,
  Zap,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { stripEmoji } from "@/lib/gpx-export";
import { parseGpxFile, type ParsedGpxRoute } from "@/lib/gpx-import";
import { decodePolyline } from "@/lib/polyline";
import { refreshStravaRoutes } from "@/lib/strava-actions";
import { WeatherImpactCard } from "@/components/weather-impact-card";
import { FuelingContextTooltips } from "@/components/fueling-context-tooltip";
import { InfoTooltip } from "@/components/info-tooltip";
import { PantryEditorModal } from "@/components/pantry-editor-modal";
import { ProfileRequiredBanner } from "@/components/profile-required-banner";
import {
  fieldClass,
  flatMobileCardClass,
  primaryButtonClass,
  secondaryButtonClass,
  selectableFieldClass,
  selectChevronClass,
} from "@/lib/ui-classes";
import {
  calculateHouseholdMeasures,
  getBottlePlan,
  getPocketFoodTotalCarbsG,
  getTableSaltGrams,
  HYPERTONIC_THRESHOLD_PCT,
  pocketFoodCarbsG as POCKET_FOOD_CARBS_G,
  pocketFoodLabels,
  type FuelingMode,
  type IntensityLevel,
  type PocketFoodItemType,
  type PocketFoodSelection,
} from "@/lib/metabolic-engine";
import type { StravaRoute } from "@/lib/strava-routes";

// Assumed pace when the athlete has no Strava ride history to derive a real
// average speed from (brand-new account, or Strava never connected) — a
// plausible "typical road ride" pace, not a personalized figure; the UI
// flags this explicitly so the athlete knows to double-check the estimate.
const FALLBACK_AVG_SPEED_KMH = 25;

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

// "Refresco"/"Bollería" lead the list — the two real-world café/gasolinera
// purchases the "Paradas previstas en ruta" section (Card 02) points the
// athlete toward, so they're the first thing visible in Card 04's inventory
// rather than buried after the pocket-carried items.
const POCKET_FOOD_TYPES: PocketFoodItemType[] = [
  "soda",
  "pastry",
  "banana",
  "energy_bar",
  "rice_cake",
  "dates",
  "gummies",
];
// "gel_ultra" (the 80g commercial sachet — Maurten 320 / Beta Fuel) joins
// the fast-absorption gel tiers rather than the pocket-solids list — it's
// dissolved directly into a bottle, not eaten from the jersey, but it still
// belongs in the same "fast source, schedule from the ride's second half"
// bucket `generateTimingTimeline` already sorts every gel dose into.
const GEL_DOSE_TYPES: PocketFoodItemType[] = ["gel_small", "gel_standard", "gel_high", "gel_ultra"];
const ALL_POCKET_FOOD_TYPES: PocketFoodItemType[] = [...POCKET_FOOD_TYPES, ...GEL_DOSE_TYPES];
const MAX_POCKET_FOOD_QTY = 6;

// "Optimización de Densidad en Simulador" — the 4 real catalog items shown
// by default in Card 04 before "+ Mostrar más alimentos" is tapped (the
// Ziploc reload dose is the 5th habitual item the audit named, rendered
// separately since it isn't a `PocketFoodItemType` — see `ziplocDoseActive`
// above). Chosen for being the most common real purchases/carries this app
// already points the athlete toward: Refresco/Bollería (the café-stop
// items "Paradas previstas en ruta" suggests), Plátano (the default solid),
// and Gel estándar (the default gel dose).
const DEFAULT_VISIBLE_POCKET_FOOD_TYPES: PocketFoodItemType[] = ["soda", "pastry", "banana", "gel_standard"];
const MAX_CUSTOM_CARBS_G = 500;

// Offline fallback for "en medio de un puerto sin cobertura" — the last
// successfully calculated strategy, so the athlete still has *something*
// actionable instead of a blank/broken screen with no signal.
const LAST_FUELING_STRATEGY_KEY = "last_fueling_strategy";

// "Mi Despensa" — which of the pocket-food catalog items the athlete
// actually wants offered in Card 04's stepper list, remembered across
// visits. Zero-onboarding: every catalog item starts active so the planner
// works fully from the very first session with no setup required.
const ACTIVE_PANTRY_STORAGE_KEY = "active_pantry_items";

/** Plain, no-emoji name for the pocket-food matrix — `pocketFoodLabels` keeps
 * its friendly emoji-prefixed copy for the clipboard/GPX exports, this derives
 * the clean-label variant from the same source at render time. */
function pocketFoodName(type: PocketFoodItemType): string {
  return stripEmoji(pocketFoodLabels[type]);
}

const eyebrow = "text-[10px] font-mono uppercase tracking-widest text-zinc-500";
// Shared typography for Paso 02's grouped input labels (Intensidad Objetivo,
// Fecha y hora de salida, Duración/Vatios) — homologated to one exact class
// string so these read as one consistent family instead of `eyebrow`'s
// smaller/looser-tracked style, which stays reserved for stat readouts and
// data-block eyebrows elsewhere in this file (Ruta, Carbohidratos objetivo,
// etc. — a different, unrelated concern this pass didn't touch).
const formFieldLabelClass = "text-xs font-mono font-semibold tracking-wider text-zinc-500 uppercase";
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

const INTENSITY_ZONE_TOOLTIP_NOTE = (
  <div className="space-y-1.5 text-left">
    <p>
      <strong>Recuperación (Z1):</strong> &lt;55% FTP (Gasto glucogénico mínimo, oxidación de
      grasas).
    </p>
    <p>
      <strong>Fondo Aeróbico (Z2):</strong> 55-75% FTP (Ritmo base, consumo moderado de
      glucógeno).
    </p>
    <p>
      <strong>Tempo / Sweetspot (Z3):</strong> 76-90% FTP (Ritmo exigente sostenible, consumo
      alto).
    </p>
    <p>
      <strong>Umbral (Z4):</strong> 91-105% FTP (Series al límite, consumo glucogénico
      elevado).
    </p>
    <p>
      <strong>Intervalos / VO2 Max (Z5-Z7):</strong> &gt;106% FTP (Series explosivas de alta
      intensidad).
    </p>
    <p>
      <strong>Competición / Carrera:</strong> Variabilidad alta y máximo vaciado metabólico.
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
}: {
  id: string;
  value: IntensityLevel | "";
  onChange: (value: IntensityLevel) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className={cn(formFieldLabelClass, "block")}>
          Intensidad objetivo
        </label>
        <InfoTooltip
          label="Guía de zonas de intensidad"
          note={INTENSITY_ZONE_TOOLTIP_NOTE}
          panelClassName="w-72 text-left sm:w-80"
        />
      </div>
      <div className="relative">
        <select
          id={id}
          className={selectableInputClass}
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

// "Micro-Edición In-Situ de Capacidad de Bidón" — the standard capacities a
// rider's bottles actually come in, offered as one-tap quick options rather
// than a free-text field.
const BOTTLE_CAPACITY_QUICK_OPTIONS = [500, 550, 750, 950, 1000];

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

function getBottleConfigOptions(athleteBottleCount: number) {
  return athleteBottleCount === 1 ? ONE_CAGE_BOTTLE_CONFIG_OPTIONS : TWO_CAGE_BOTTLE_CONFIG_OPTIONS;
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

/** One "En bici" checklist row — `kind` lets the caller special-case the
 * mix-bottle row with an inline "[ Ver en cazos ]" reveal (see Card 05's
 * "Checklist de salida" render below) while every other row (plain water,
 * a Maurten/Beta Fuel sachet bidón) renders as plain text, same as every
 * other checklist section in this card. */
type BikeChecklistLine = { key: string; kind: "mix" | "water" | "gel_ultra"; text: string };

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
 * and is listed separately by `getWaterPlanLines` below instead.
 *
 * The "Productos Comerciales de Alta Densidad" sachet prep line (a
 * Maurten/Beta Fuel 80g HC sachet dissolved into its own bottle) used to
 * live inside the removed hero box; it belongs here too now, since it's
 * just another bottle to prepare before rolling out. */
function getBikeChecklistLines(
  result: PlanResult,
  bottleConfig: BottleConfigOption,
  bottlePlan: PlanResult["bottlePlan"]
): BikeChecklistLine[] {
  const { fuelBottles, waterBottles, bottleSizeMl } = bottlePlan;
  const maxOnBike = result.reloadStrategy?.startingBottleCount ?? bottlePlan.totalBottles;
  const lines: BikeChecklistLine[] = [];

  let mixBottleCount = 0;
  if (bottleConfig !== "water_only" && fuelBottles.count > 0) {
    // Matches `getBottleCarbsContributionG`'s own bottle count exactly —
    // "Ambos Mix" means the athlete's real cage count
    // (`result.athleteBottleCount`, 1 or 2), not a hardcoded 2 — capped at
    // `maxOnBike` so this can never exceed what's actually mounted.
    mixBottleCount = Math.min(bottleConfig === "one_mix" ? 1 : result.athleteBottleCount, maxOnBike);
    lines.push({
      key: "mix",
      kind: "mix",
      text: `${mixBottleCount}x Bidón de ${bottleSizeMl}ml (con Mezcla Casera: ${fuelBottles.maltodextrinGPerBottle}g Malto + ${
        fuelBottles.fructoseGPerBottle
      }g Fructosa + ${getTableSaltGrams(fuelBottles.sodiumMgPerBottle)}g Sal)`,
    });
  }

  const waterBottlesOnBike = Math.min(waterBottles.count, Math.max(0, maxOnBike - mixBottleCount));
  if (waterBottlesOnBike > 0) {
    lines.push({
      key: "water",
      kind: "water",
      text: `${waterBottlesOnBike}x Bidón de ${bottleSizeMl}ml (Solo Agua)`,
    });
  }

  const gelUltraCount = result.pocketFood.gel_ultra ?? 0;
  if (gelUltraCount > 0) {
    lines.push({
      key: "gel_ultra",
      kind: "gel_ultra",
      text: `${gelUltraCount}x Bidón con 1 Sobre comercial de 80g HC (Maurten / Beta Fuel) + 500ml de agua`,
    });
  }

  return lines;
}

/** Tarjeta 05's "Plan de agua en ruta" — plain water beyond what fits in
 * the bike's own cages is never a Ziploc powder concern (concentrate isn't
 * available at a fountain — see `getReloadStrategy`'s own
 * `waterRefillCount`/`waterRefillLiters`), so it's listed here as a
 * fountain-refill action rather than as a phantom bottle in the "En bici"
 * checklist above or folded into the powder-reload accordion.
 *
 * "Neutralidad Absoluta en el Plan de Agua en Ruta" — a plain, direct
 * `Recarga de agua en ruta: N recarga(s) de ~Xml/L` line, no parenthetical
 * qualifiers. `waterRefillLiters` is the *total* across every refill
 * (`extraWaterBottles * bottleSizeMl`, see `getReloadStrategy` in
 * `lib/metabolic-engine.ts`) — displayed in ml under 1L (matching a single
 * refill's own bottle-size volume 1:1, e.g. "1 recarga de ~550ml" for one
 * 550ml refill) and in L above that, rather than always showing a bare
 * "0.55L" that reads awkwardly at small volumes. */
function getWaterPlanLines(result: PlanResult): string[] {
  const reload = result.reloadStrategy;
  if (!reload || reload.waterRefillCount <= 0) return [];
  const volumeLabel =
    reload.waterRefillLiters < 1
      ? `${Math.round(reload.waterRefillLiters * 1000)}ml`
      : `${reload.waterRefillLiters}L`;
  return [
    `Recarga de agua en ruta: ${reload.waterRefillCount} recarga${
      reload.waterRefillCount > 1 ? "s" : ""
    } de ~${volumeLabel}`,
  ];
}

function getPocketChecklistLines(
  pocketFood: Partial<Record<PocketFoodItemType, number>>,
  customCarbsG: number
): string[] {
  const lines: string[] = [];
  for (const type of ALL_POCKET_FOOD_TYPES) {
    const qty = pocketFood[type] ?? 0;
    if (qty > 0) lines.push(`${qty}x ${pocketFoodName(type)}`);
  }
  if (customCarbsG > 0) lines.push(`${customCarbsG}g HC Personalizado`);
  return lines;
}

// Thresholds and copy straight from the "Helper de Equivalencias Sugeridas"
// spec — concrete, ready-to-order suggestions so the athlete never has to
// do carb-counting mental math standing at a counter.
const CAFETERIA_STOP_LOW_THRESHOLD_G = 40;
const CAFETERIA_STOP_MID_THRESHOLD_G = 80;

/** "Helper de Equivalencias" — a plain-language, ready-to-order suggestion
 * for whatever grams a single café/gas-station stop currently needs to
 * cover, so the athlete knows what to actually ask for instead of doing
 * carb math at the counter. Purely illustrative reference doses (a
 * "refresco"/"bollo"/"snack" isn't a precise figure any more than this
 * app's other catalog items are), same "not a real nutrition database"
 * convention as `pocketFoodCarbsG`. Applied per-stop (each stop's own
 * share of the deficit), not once against the total — a 2-stop split of an
 * 80g deficit should read as two separate, smaller suggestions (48g/32g),
 * not one combined 80g one. */
function getCafeteriaStopSuggestion(carbsG: number): string {
  if (carbsG <= CAFETERIA_STOP_LOW_THRESHOLD_G) {
    return "1 Refresco / Coca-Cola (35g HC) o 1 Bollo/Plátano";
  }
  if (carbsG <= CAFETERIA_STOP_MID_THRESHOLD_G) {
    return "1 Refresco (35g) + 1 Bollo o Tostada (35g HC)";
  }
  return "1 Refresco (35g) + 1 Bollo (35g) + 1 Snack/Fruta (30g HC)";
}

/** How many optional café/gasolinera/fuente stops the athlete has planned
 * — `0` (the zero-friction default: no manual stop planning at all), `1`,
 * or `2`. The "Gestión Avanzada de Paradas" brief floats a theoretical 3rd
 * tier as a future ceiling, but gives no split formula for it — only 1 and
 * 2 stops have a concrete algorithm (`CAFETERIA_STOP_FRACTIONS` below), so
 * this stays at the two concretely-specified options rather than inventing
 * a 3-way split with no real basis behind it. */
type CafeteriaStopCount = 0 | 1 | 2;

// "Botones de Selección Rápida" — no sub-menus, one tap picks the whole
// plan. The "(Sugerido)" suffix on "1 Parada" was dropped outright (not
// abbreviated) — "Bug Fix de Botones e Inputs" found it truncating to
// "1 Parada (Sug..." on a real iPhone, since the label had to share a
// 3-column row with "Sin paradas"/"2 Paradas" with no room to spare. A
// single well-placed stop is still the simplest plan that fully resolves
// any deficit regardless of size, but that reasoning now lives only in
// this comment, not in on-screen copy that doesn't fit.
const CAFETERIA_STOP_COUNT_OPTIONS: { value: CafeteriaStopCount; label: string }[] = [
  { value: 0, label: "Sin paradas" },
  { value: 1, label: "1 Parada" },
  { value: 2, label: "2 Paradas" },
];

// Where each stop sits along the route/duration, as a fraction of the
// total — literal from the "Ubicación recomendada" figures in the spec. A
// single stop's own spec gives a range ("≈50-60%"), not one number; 0.55
// (the range's midpoint) is the one deterministic value actually needed to
// place a Km/hour marker.
const CAFETERIA_STOP_FRACTIONS: Record<1 | 2, number[]> = {
  1: [0.55],
  2: [0.35, 0.7],
};
// With 2 stops, the first absorbs the larger share of the deficit — more
// time left for plasmatic absorption before the ride's harder final
// stretch, per the spec's own "Algoritmo de Reparto Dinámico" rationale.
const CAFETERIA_STOP_FIRST_OF_TWO_FRACTION = 0.6;

export type CafeteriaStopPlan = {
  /** 1-based, for display ("Parada 1", "Parada 2"). */
  index: number;
  carbsG: number;
  atKm: number | null;
  atHours: number;
  suggestion: string;
};

/** "Algoritmo de Reparto Dinámico" — splits the pending deficit
 * (`deficitG`, i.e. D_base — whatever bottles + pocket food alone still
 * leave uncovered) across however many stops the athlete has planned,
 * weighted so an earlier stop absorbs more of the load, and positions each
 * one along the route/duration. Returns `[]` for `count === 0` or a
 * fully-covered deficit (nothing left to distribute) — same "nothing
 * selected, nothing shown" convention as every other checklist/plan helper
 * in this file. Every share is derived so the stops always sum back to
 * exactly `deficitG` (the second/last share is `deficitG` minus every
 * already-rounded share before it, the same pattern `getHomeLabRecipe`
 * uses for its own malto/fructose split) — independent rounding of each
 * share could otherwise silently drift off the real total. `atKm` is
 * `null` (never a fabricated distance) whenever the ride has no real
 * distance at all — Entreno Manual — in which case `atHours` alone
 * locates the stop. */
function getCafeteriaStopPlans({
  count,
  deficitG,
  distanceKm,
  durationHours,
}: {
  count: CafeteriaStopCount;
  deficitG: number;
  distanceKm: number | null;
  durationHours: number;
}): CafeteriaStopPlan[] {
  if (count === 0 || deficitG <= 0) return [];
  const fractions = CAFETERIA_STOP_FRACTIONS[count];
  const shares: number[] = [];
  if (count === 1) {
    shares.push(deficitG);
  } else {
    const firstShare = Math.round(deficitG * CAFETERIA_STOP_FIRST_OF_TWO_FRACTION);
    shares.push(firstShare, deficitG - firstShare);
  }

  return fractions.map((fraction, i) => ({
    index: i + 1,
    carbsG: shares[i],
    atKm: distanceKm != null ? Math.round(distanceKm * fraction) : null,
    atHours: Math.round(durationHours * fraction * 100) / 100,
    suggestion: getCafeteriaStopSuggestion(shares[i]),
  }));
}

/** A `~` prefix rather than a bare figure — this is a rough zone to plan
 * around ("sobre el km 40," not "para exactamente en el km 40"), never a
 * command. "Flexibilidad Total en Paradas": the athlete decides on the road
 * exactly when/where to actually stop, this is only a planning estimate for
 * sizing how much to buy at whichever café/gasolinera they pass. */
function getCafeteriaStopLocationLabel(plan: CafeteriaStopPlan): string {
  return plan.atKm != null ? `~Km ${plan.atKm}` : `~Hora ${plan.atHours}`;
}

/** Tarjeta 05's own "Plan de Paradas en Ruta" checklist lines — one per
 * planned stop, `[]` entirely when none are planned (or the deficit is
 * already fully covered without one), matching every other checklist
 * helper's "nothing selected, nothing shown" convention above. Deliberately
 * orientative, not imperative — no "parar exactamente en el km/minuto X."
 * The stop's own estimated position is a planning reference, not a rule the
 * athlete is expected to follow to the letter; they decide on the road when
 * an actual café/gasolinera is genuinely convenient to stop at. */
function getCafeteriaStopChecklistLines(plans: CafeteriaStopPlan[]): string[] {
  return plans.map(
    (plan) =>
      `Parada ${plan.index} (Cafetería/Gasolinera), orientativa sobre ${getCafeteriaStopLocationLabel(plan)}: cubre ~${plan.carbsG}g HC cuando te venga bien parar.`
  );
}

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
}: {
  dayMode: DepartureDayMode;
  onDayModeChange: (mode: DepartureDayMode) => void;
  customDate: string;
  onCustomDateChange: (date: string) => void;
  hour: string;
  onHourChange: (hour: string) => void;
}) {
  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-2">
      <span className={formFieldLabelClass}>Fecha y hora de salida</span>
      <div className="grid grid-cols-3 gap-2 *:min-w-0">
        {DEPARTURE_DAY_MODE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onDayModeChange(opt.value)}
            className={cn(
              segmentedButtonClass,
              dayMode === opt.value
                ? "border-transparent bg-terracotta text-white"
                : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400"
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
        // wrapper is the belt-and-suspenders backstop: it guarantees the
        // rendered box can never visually break the card's right edge no
        // matter what width Safari's shadow DOM insists on internally. This
        // is safe specifically because the native date *picker* itself
        // (the wheel/calendar overlay a tap opens) is OS chrome rendered
        // outside normal document flow — like a `<select>`'s own dropdown —
        // so clipping this wrapper's box never clips that overlay too.
        <div className="w-full max-w-full min-w-0 overflow-hidden box-border">
          <input
            type="date"
            aria-label="Fecha de salida"
            min={todayIsoDate()}
            value={customDate}
            onChange={(e) => onCustomDateChange(e.target.value)}
            className={cn(fieldClass, "w-full max-w-full min-w-0 box-border")}
          />
        </div>
      )}
      <div className="relative">
        <select
          aria-label="Hora de salida"
          className={selectableFieldClass}
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
// triad instead) so the same row markup can also render the "Dosis de
// recarga Mix (Ziploc)" item below — its per-unit grams are dynamic
// (identical to whatever one fuel bottle at the athlete's own bottle size
// actually delivers this ride, see `ziplocDoseGramsPerUnit`), not a fixed
// `pocketFoodCarbsG` catalog constant a `type` lookup could resolve on its
// own the way every real catalog item's row still can.
// "Insignias Técnicas de Producto" — a plain monospace category tag next to
// each pocket-food row's name, in place of the emoji this app already
// strips at render time (`pocketFoodName()`/`stripEmoji`, see above) — a
// terse `[ GEL ]`/`[ SÓLIDO ]`/`[ LÍQUIDO ]`/`[ FÓRMULA ]` reads as
// technical/editorial rather than decorative, matching this app's
// established "no icons, no emoji, just typography" convention for this
// one UI surface. Kept as presentation-only classification local to this
// component, not a physiology concern `lib/metabolic-engine.ts` needs to
// know about.
type PocketFoodCategory = "GEL" | "SÓLIDO" | "LÍQUIDO" | "FÓRMULA";

const POCKET_FOOD_CATEGORY: Record<PocketFoodItemType, PocketFoodCategory> = {
  soda: "LÍQUIDO",
  pastry: "SÓLIDO",
  banana: "SÓLIDO",
  energy_bar: "SÓLIDO",
  rice_cake: "SÓLIDO",
  dates: "SÓLIDO",
  gummies: "SÓLIDO",
  gel_small: "GEL",
  gel_standard: "GEL",
  gel_high: "GEL",
  // Dissolved into a bottle rather than eaten, same bucket as the Ziploc
  // reload dose below — both are a powder/sachet mixed into liquid, not a
  // gel squeezed straight from its own pouch.
  gel_ultra: "FÓRMULA",
};

function PocketFoodCategoryBadge({ category }: { category: PocketFoodCategory }) {
  return (
    <span className="mr-1.5 inline-block shrink-0 rounded-sm bg-zinc-100 px-1 py-0.5 align-middle font-mono text-[9px] font-semibold tracking-wider text-zinc-500 uppercase">
      [{category}]
    </span>
  );
}

function PocketFoodStepperRow({
  label,
  category,
  carbsG,
  ariaLabel,
  qty,
  onChange,
  disabled = false,
}: {
  label: string;
  category?: PocketFoodCategory;
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
      <span className="text-sm text-neutral-900">
        {category && <PocketFoodCategoryBadge category={category} />}
        {label}
        <span className="ml-1.5 font-mono text-xs text-neutral-500">{carbsG}g HC</span>
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

export function FuelingPlanner({
  routes,
  avgSpeedKmh,
  isProfileComplete,
}: {
  routes: StravaRoute[];
  avgSpeedKmh: number | null;
  isProfileComplete: boolean;
}) {
  const [mode, setMode] = useState<"route" | "quick" | "gpx">(routes.length > 0 ? "route" : "quick");
  // No route pre-selected — even with saved Strava routes on hand, loading
  // the athlete's last ride automatically risked silently calculating
  // against the wrong route if they didn't notice/change it. The select
  // itself renders a disabled placeholder option for this empty value (see
  // below), and the map shows its own neutral empty state until a real
  // choice is made.
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [gpxUploadOpen, setGpxUploadOpen] = useState(false);
  // No intensity pre-selected either ("Fondo Z2" used to be silently
  // assumed) — same reasoning, an unintentional calculation is worse than
  // one extra required click.
  const [intensity, setIntensity] = useState<IntensityLevel | "">("");
  // No pre-filled defaults — the athlete must explicitly enter a real
  // duration rather than silently calculating against whatever placeholder
  // happened to be in the field. "Vatios Objetivo" no longer has its own
  // input at all here — see `quickValid`'s own comment below.
  const [quickHoursInput, setQuickHoursInput] = useState("");
  const [quickMinutesInput, setQuickMinutesInput] = useState("");
  // "Hoy" stays the default day (a same-day departure is still the single
  // most common case, and picking a day is a low-stakes default unlike a
  // route or intensity choice that could silently drive a wrong
  // calculation) — only the route/intensity selections above lost their
  // defaults. The hour, though, starts rounded to the current time rather
  // than a fixed "08:00" so it reads as "now-ish" instead of an arbitrary
  // stand-in the athlete has to notice and correct.
  const [departureDayMode, setDepartureDayMode] = useState<DepartureDayMode>("today");
  const [departureCustomDate, setDepartureCustomDate] = useState(todayIsoDate);
  const [departureHour, setDepartureHour] = useState(getRoundedCurrentHour);
  const departureLocal = useMemo(
    () => buildDepartureLocal(departureDayMode, departureCustomDate, departureHour),
    [departureDayMode, departureCustomDate, departureHour]
  );
  const [isTargetEvent, setIsTargetEvent] = useState(false);
  // "Modo Eficiencia Metabólica (Train Low / Ayunas)" — a deliberate
  // low-carb session; the server caps the carb target to a fixed 0-25g/h
  // electrolyte-only band and the deficit/gut-cap warnings below suppress
  // themselves accordingly (see `result.trainLow`).
  const [trainLow, setTrainLow] = useState(false);
  const [pocketFood, setPocketFood] = useState<Partial<Record<PocketFoodItemType, number>>>({});
  const [customCarbsG, setCustomCarbsG] = useState(0);
  // "Incluye cafeína" — a modifier on whatever gel(s) are already selected,
  // not a 4th gel-catalog entry ("no duplicar ítems de geles"). Only shown
  // once at least one gel type has a quantity > 0 (see `hasGelSelected`
  // below), and the caffeine milestone in `timingTimeline` only appears at
  // all when this is checked — see `generateTimingTimeline` in
  // `lib/metabolic-engine.ts`.
  const [includeCaffeine, setIncludeCaffeine] = useState(false);
  // "Mi Despensa" — starts as the full catalog (zero-onboarding: the
  // planner works fully from the first session with no setup) and is
  // overwritten from `localStorage` on mount if the athlete already
  // customized it on a previous visit (see the effect below).
  const [activePantryTypes, setActivePantryTypes] = useState<PocketFoodItemType[]>(ALL_POCKET_FOOD_TYPES);
  const [pantryModalOpen, setPantryModalOpen] = useState(false);
  // "Optimización de Densidad" — 11 steppers at once was real choice-overload
  // fatigue on a real phone, mid-kitchen-prep. Collapsed to the handful of
  // habitual items by default (`DEFAULT_VISIBLE_POCKET_FOOD_TYPES` below,
  // plus the Ziploc dose row, which is never gated by this), with the rest
  // one tap away via "+ Mostrar más alimentos" rather than gone entirely —
  // nothing in "Editar mi despensa" changes because of this, it's purely a
  // display-density preference layered on top of it.
  const [showAllPocketFood, setShowAllPocketFood] = useState(false);
  // "Estrategia nutricional" (Óptimo/Mi Inventario/Híbrido) was removed
  // entirely from this UI — "Reestructuración Integral de Resultados"
  // collapsed it and the bottle-config selector down to one always-visible,
  // always-editable pocket-food inventory instead, to cut the two
  // duplicated top-level selectors down to one. The API/engine still accept
  // "optimal"/"hybrid" server-side (untouched) — this is a UI-only
  // simplification, not a removal of that capability from the data model,
  // so `fuelingMode` is now a fixed constant rather than editable state.
  const fuelingMode: FuelingMode = "inventory";
  // Card 04's own bottle-role preference — defaults to "Solo Agua," the
  // most conservative assumption, and is what the reset effect below
  // returns it to on every Paso 01/02 change (see `DEFAULT_BOTTLE_CONFIG`).
  const [bottleConfig, setBottleConfig] = useState<BottleConfigOption>(DEFAULT_BOTTLE_CONFIG);
  // "Micro-Edición In-Situ de Capacidad de Bidón" — a display-only override
  // of the athlete's real `athlete_profiles.bottle_capacity_ml` for this one
  // calculated strategy, letting them preview a different bottle size (e.g.
  // borrowing a teammate's 950ml bottle) without leaving the planner or
  // editing their saved profile. `null` means "use the server's real
  // figure" (`result.bottlePlan.bottleSizeMl`) — see `displayBottlePlan`
  // below for the client-side recompute this drives.
  const [bottleCapacityOverrideMl, setBottleCapacityOverrideMl] = useState<number | null>(null);
  const [bottleCapacityEditorOpen, setBottleCapacityEditorOpen] = useState(false);
  // "Eliminación de la Caja Negra 'Dosis Ejecutiva'" — the scoop-equivalence
  // breakdown that used to live inside Card 05's hero box now surfaces as an
  // inline reveal directly under the checklist's own mix-bottle line
  // instead ("[ Ver en cazos ]"), so this one boolean replaces what used to
  // be a plain `<details>` element's own native open state.
  const [showBikeScoops, setShowBikeScoops] = useState(false);
  // "Planificación de Paradas en Ruta" — a third, opportunistic coverage
  // source alongside bottles and pocket food: 0 (zero-friction default), 1,
  // or 2 café/gasolinera/fuente stops. A plain count is deliberately the
  // *only* state this needs: how many grams each stop actually contributes
  // is never stored, always re-derived fresh from whatever deficit
  // bottles+pocket food still leave (see `cafeteriaStopPlans` below) —
  // that's what makes every stop reactive to a later pocket-food/bottle
  // edit with zero extra wiring. Resets to `0` on every Paso 01/02 change,
  // same as `bottleConfig` (see the reset effect below).
  const [cafeteriaStopCount, setCafeteriaStopCount] = useState<CafeteriaStopCount>(0);
  // "Dosis de recarga Mix (Ziploc)" — replaces the old automatic
  // "Estrategia de recarga en ruta" red card: instead of the app *telling*
  // the athlete they need N reload bags, they declare how many pre-measured
  // mix doses they're actually carrying in their jersey, same self-serve
  // convention as every other pocket-food item. Deliberately kept as its
  // own state rather than folded into `pocketFood`/`PocketFoodItemType`:
  // its per-unit grams are dynamic — always identical to whatever one fuel
  // bottle at the athlete's own configured bottle size delivers *this
  // ride* (see `ziplocDoseGramsPerUnit` below), not a fixed catalog
  // constant the shared type (and its server-side validation) can hold.
  // Same "client-only planning preference, never round-tripped to the
  // server" convention as `bottleConfig`/`cafeteriaStopCount` above — a
  // Ziploc bag is packaging for the *same* already-calculated recipe, not
  // new nutrition that should shrink the server's own target on a
  // recalculation (see `handleCalculate`'s `pocketFoodPayload` below,
  // which deliberately never includes it). The *quantity* resets to `0` on
  // every Paso 01/02 change, same as `bottleConfig`/`cafeteriaStopCount` —
  // `ziplocDoseActive` (its own "Editar mi despensa" visibility) doesn't,
  // matching `activePantryTypes`'s own session-long persistence rather
  // than a per-calculation input.
  const [ziplocDoseActive, setZiplocDoseActive] = useState(true);
  const [ziplocDoseCount, setZiplocDoseCount] = useState(0);
  const [result, setResult] = useState<PlanResult | null>(null);
  // Tracks whether the athlete has *ever* successfully calculated a
  // strategy in this session — drives the CTA's label ("Calcular..." the
  // first time, "Re-calcular..." every time after) independently of
  // whether a result is currently showing.
  const [hasCalculatedOnce, setHasCalculatedOnce] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOfflineCache, setIsOfflineCache] = useState(false);
  const [parsedGpx, setParsedGpx] = useState<ParsedGpxRoute | null>(null);
  const [gpxDurationHours, setGpxDurationHours] = useState(2);
  const [gpxError, setGpxError] = useState<string | null>(null);
  const [isDraggingGpx, setIsDraggingGpx] = useState(false);
  const [refreshingRoutes, setRefreshingRoutes] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

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

  // Derived from the 2 raw text inputs above — `0` (not `NaN`) for a blank
  // field, so `quickValid` below cleanly reads "not entered yet" rather than
  // a broken calculation. Horas + Minutos combine into one decimal-hours
  // figure, same unit `handleCalculate`'s request body always expected.
  // "Vatios Objetivo" was removed entirely (see the API route's own quick-
  // mode branch) — the engine now derives relative intensity purely from
  // the shared Intensidad Objetivo selector's %FTP figure, so a real
  // intensity selection is mandatory here too, not just duration.
  const quickHoursNum = Number(quickHoursInput) || 0;
  const quickMinutesNum = Number(quickMinutesInput) || 0;
  const quickDurationHours = quickHoursNum + quickMinutesNum / 60;
  const quickValid = quickDurationHours > 0 && intensity !== "";

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
  // the checklist, and the Ziploc reload-dose stepper all at once.
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

  // "Conversión Dinámica a Medidas Caseras" — recomputed from the last
  // calculated result whenever it changes; cheap pure arithmetic, no memo
  // needed. Card 05's "Dosis ejecutiva" is scoped to the per-bottle figure
  // — the old "Estrategia de recarga en ruta" card (and its own
  // `ziplocMeasures` scoop-equivalence figure) was removed outright, see
  // "Dosis de recarga Mix (Ziploc)" above for its replacement.
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
  // "Dosis de recarga Mix (Ziploc)" — always identical to what one fuel
  // bottle at the athlete's *own* configured bottle size delivers this
  // ride (`bottlePlan.bottleSizeMl` already comes from their real
  // `athlete_profiles.bottle_capacity_ml`, or the in-situ override above),
  // so changing that profile field/override and recalculating updates this
  // figure automatically with zero extra wiring — same reactive pattern as
  // every other Card 04 coverage source.
  const ziplocDoseGramsPerUnit = displayBottlePlan
    ? displayBottlePlan.fuelBottles.maltodextrinGPerBottle + displayBottlePlan.fuelBottles.fructoseGPerBottle
    : 0;
  const ziplocDoseCarbsG = ziplocDoseCount * ziplocDoseGramsPerUnit;
  const bottlesAndPocketCoveredCarbsG = pocketFoodCarbsPreview + bottleCarbsContributionG + ziplocDoseCarbsG;
  // D_base — the whole reason "Planificación de Paradas en Ruta" exists:
  // the deficit still pending from bottles + pocket food *alone*, before
  // any café/gas-station stop is factored in. Deliberately re-derived on
  // every render (not stored anywhere) so it's always the *current* gap —
  // this is what makes every planned stop's own contribution below
  // reactive to a later pocket-food/bottle edit with no extra event wiring
  // at all: the stops don't remember "80g between the two of them," they
  // always recompute "whatever's still missing right now" and re-split it.
  const cafeteriaStopDeficitG = result
    ? Math.max(0, result.totalRideCarbsG - bottlesAndPocketCoveredCarbsG)
    : 0;
  // "≈50% de la ruta" (1 stop) / "≈35% y ≈70%" (2 stops) — the estimated
  // point(s) along the ride where the athlete would realistically hit a
  // café/gas station, real distance when the route/GPX has one, else an
  // elapsed-time marker (same "Km, else Hora" convention as
  // `getReloadStrategy`'s own `reloadAtKm`/`reloadAtHours`) — Entreno
  // Manual has no route geometry at all.
  const cafeteriaStopDistanceKm =
    mode === "route"
      ? (selectedRoute?.distanceKm ?? null)
      : mode === "gpx"
        ? (parsedGpx?.distanceKm ?? null)
        : null;
  const cafeteriaStopPlans = result
    ? getCafeteriaStopPlans({
        count: cafeteriaStopCount,
        deficitG: cafeteriaStopDeficitG,
        distanceKm: cafeteriaStopDistanceKm,
        durationHours: result.durationHours,
      })
    : [];
  // Planning any stops at all credits exactly enough, split across them,
  // to close the full D_base gap — never a fixed manual figure — so
  // CUBIERTO always reaches the full OBJETIVO (RESTANTE always reads 0g)
  // the instant a stop count is picked, and the split re-adjusts
  // automatically if the athlete then adds more pocket food underneath it.
  const cafeteriaStopCarbsG = cafeteriaStopPlans.reduce((sum, plan) => sum + plan.carbsG, 0);
  const coveredCarbsG = bottlesAndPocketCoveredCarbsG + cafeteriaStopCarbsG;
  const remainingCarbsG = result ? Math.max(0, result.totalRideCarbsG - coveredCarbsG) : 0;
  // Which bottle-config buttons Card 04 actually renders — see
  // `getBottleConfigOptions` above for why a 1-cage athlete never sees
  // "Ambos Mix" at all.
  const bottleConfigOptions = result ? getBottleConfigOptions(result.athleteBottleCount) : TWO_CAGE_BOTTLE_CONFIG_OPTIONS;

  // Tarjeta 05's "Checklist de preparación para llevar" — same source data
  // as the balance pill above, read fresh on every render so the on-screen
  // list stays in sync with what's currently selected.
  const bikeChecklistLines =
    result && displayBottlePlan ? getBikeChecklistLines(result, bottleConfig, displayBottlePlan) : [];
  // Ziploc reload doses aren't part of `pocketFood` (see the state comment
  // above), so they don't come back out of `getPocketChecklistLines` for
  // free — appended here instead, replacing the function of the old
  // "Estrategia de recarga en ruta" card's own checklist line.
  const pocketChecklistLines = [
    ...getPocketChecklistLines(pocketFood, customCarbsG),
    ...(ziplocDoseCount > 0
      ? [
          `${ziplocDoseCount}x Dosis de recarga Mix (Ziploc con ${ziplocDoseGramsPerUnit}g Malto/Fructosa)`,
        ]
      : []),
  ];
  const waterPlanChecklistLines = result ? getWaterPlanLines(result) : [];
  const cafeteriaChecklistLines = getCafeteriaStopChecklistLines(cafeteriaStopPlans);

  // Card 05's "Cronograma Dinámico de Ingesta" merges the server-computed
  // solid/gel/caffeine milestones (`result.timingTimeline.entries`, driven
  // by pocket food alone) with the client-only café/gasolinera stops above
  // — the server has no idea these stops exist at all, since they're a
  // purely client-side planning preference, same "lightweight preference,
  // no server round-trip" convention as the bottle-config selector. Both
  // sources are re-sorted together by `atMinutes` so a stop takes its real
  // chronological place in the sequence instead of always trailing at the
  // end.
  const mergedTimelineEntries = result
    ? [
        ...result.timingTimeline.entries.map((entry, i) => ({
          key: `srv-${i}`,
          atMinutes: entry.atMinutes,
          atKm: entry.atKm,
          icon: entry.type,
          label: stripEmoji(entry.label),
          // Pocket-food solid/gel/caffeine milestones are a real schedule
          // the athlete carries with them from the start — the marker
          // reads as a precise plan. A café/gasolinera stop is the
          // opposite: an orientative zone, never a literal "stop exactly
          // here" instruction (see `getCafeteriaStopLocationLabel`).
          approx: false,
        })),
        ...cafeteriaStopPlans.map((plan) => ({
          key: `stop-${plan.index}`,
          atMinutes: Math.round(plan.atHours * 60),
          atKm: plan.atKm,
          icon: "cafeteria" as const,
          label: `Parada ${plan.index} · Cafetería / Gasolinera (orientativa) — cubre ~${plan.carbsG}g HC cuando pares: ${plan.suggestion}.`,
          approx: true,
        })),
      ].sort((a, b) => a.atMinutes - b.atMinutes)
    : [];

  // The "Incluye cafeína" checkbox only makes sense once at least one gel
  // dose is actually selected — hidden otherwise, and its own checked state
  // is deliberately never sent to the server unless a gel is still selected
  // (see `handleCalculate`'s `pocketFoodPayload` below), so removing the
  // last gel after checking it can't leave a stale `includeCaffeine: true`
  // scheduling a caffeine milestone with no real caffeine source behind it.
  const hasGelSelected = GEL_DOSE_TYPES.some((type) => (pocketFood[type] ?? 0) > 0);

  // "Optimización de Densidad" — collapsed by default to the habitual set
  // (`DEFAULT_VISIBLE_POCKET_FOOD_TYPES`), but an item the athlete already
  // gave a quantity to (e.g. added via "Mostrar más," then collapsed the
  // list again) never disappears — hiding an active selection would read as
  // it silently zeroing out, even though it'd still count toward CUBIERTO.
  const activePocketFoodTypes = ALL_POCKET_FOOD_TYPES.filter((type) => activePantryTypes.includes(type));
  const visiblePocketFoodTypes = activePocketFoodTypes.filter(
    (type) =>
      showAllPocketFood ||
      DEFAULT_VISIBLE_POCKET_FOOD_TYPES.includes(type) ||
      (pocketFood[type] ?? 0) > 0
  );
  const hiddenPocketFoodCount = activePocketFoodTypes.length - visiblePocketFoodTypes.length;

  // "Modo Cobertura Limitada" — if the athlete opens the app with no
  // connection at all (mid-climb, no signal), load the last strategy that
  // did calculate successfully rather than showing an empty planner.
  useEffect(() => {
    function loadCachedStrategyIfOffline() {
      if (typeof navigator === "undefined" || navigator.onLine) return;
      try {
        const cached = localStorage.getItem(LAST_FUELING_STRATEGY_KEY);
        if (!cached) return;
        setResult(JSON.parse(cached));
        setIsOfflineCache(true);
      } catch {
        // Corrupt/unavailable cache — just leave the planner empty, same as
        // never having calculated a strategy before.
      }
    }

    loadCachedStrategyIfOffline();
    window.addEventListener("offline", loadCachedStrategyIfOffline);
    return () => window.removeEventListener("offline", loadCachedStrategyIfOffline);
  }, []);

  // "Mi Despensa" — loads whatever the athlete last saved, if anything.
  // Runs once on mount, after the initial "every item active" render (so
  // there's no SSR/client hydration mismatch), and is sanitized against the
  // real catalog in case it's changed since the athlete last saved it.
  useEffect(() => {
    function loadPantryFromStorage() {
      try {
        const stored = localStorage.getItem(ACTIVE_PANTRY_STORAGE_KEY);
        if (!stored) return;
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return;
        const valid = parsed.filter((type): type is PocketFoodItemType =>
          ALL_POCKET_FOOD_TYPES.includes(type)
        );
        if (valid.length > 0) setActivePantryTypes(valid);
      } catch {
        // Corrupt/unavailable storage — just keep the full default catalog.
      }
    }

    loadPantryFromStorage();
  }, []);

  // A freshly calculated strategy renders below the fold on most phones —
  // without this, "Calcular estrategia" appears to do nothing until the
  // athlete notices they need to scroll down themselves.
  useEffect(() => {
    if (result) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  // "Reseteo Automático del Estado de Cálculo" — a previously-calculated
  // result is only ever valid for the exact inputs it was computed from;
  // editing any of them (switching tabs, picking a different route/GPX,
  // changing duration/intensity/departure date-time, toggling "Ruta
  // objetivo / Competición") immediately hides it again rather than leaving
  // a stale strategy on screen that no longer matches what's currently
  // selected — the CTA's own `disabled` gating already re-enables itself
  // the moment its own conditions are met again, so this just needs to
  // clear `result` for the result panel to disappear along with it. The
  // same trigger also resets Card 04's own downstream state (bottle
  // config back to "Solo Agua," planned café/gasolinera stops back to 0,
  // planned Ziploc reload doses back to 0, every pocket-food quantity back
  // to 0) —
  // those figures were computed against the *old* target and would
  // otherwise silently carry over into a strategy they were never
  // actually chosen for. `isInitialInputRender` skips the very first run
  // on mount specifically so this can never race the offline-cache-load
  // effect above and wipe out a just-restored cached result before the
  // athlete ever sees it — this effect must only fire in response to a
  // genuine *change*, not simply existing with its own initial values.
  const isInitialInputRender = useRef(true);
  useEffect(() => {
    if (isInitialInputRender.current) {
      isInitialInputRender.current = false;
      return;
    }
    setResult(null);
    setBottleConfig(DEFAULT_BOTTLE_CONFIG);
    setCafeteriaStopCount(0);
    setZiplocDoseCount(0);
    setPocketFood({});
    setCustomCarbsG(0);
    setBottleCapacityOverrideMl(null);
    setBottleCapacityEditorOpen(false);
    setShowBikeScoops(false);
  }, [
    mode,
    selectedRouteId,
    parsedGpx,
    quickDurationHours,
    gpxDurationHours,
    intensity,
    departureLocal,
    isTargetEvent,
    trainLow,
  ]);

  function setPocketFoodQty(type: PocketFoodItemType, qty: number) {
    setPocketFood((prev) => ({ ...prev, [type]: Math.max(0, Math.min(MAX_POCKET_FOOD_QTY, qty)) }));
  }

  // "Regla Crítica de Reseteo al Desmarcar" — unchecking an item that
  // already had a quantity selected zeroes that quantity out immediately,
  // in the same click: an inactive pantry item can't keep silently
  // contributing carbs to CUBIERTO. Applied live to the real state (not a
  // staged draft the modal discards on close), so the balance pill reacts
  // instantly even while the modal is still open — "Guardar despensa"
  // below only needs to persist the already-applied selection.
  function togglePantryItem(type: PocketFoodItemType) {
    const isCurrentlyActive = activePantryTypes.includes(type);
    setActivePantryTypes((prev) =>
      isCurrentlyActive ? prev.filter((t) => t !== type) : [...prev, type]
    );
    if (isCurrentlyActive) {
      setPocketFoodQty(type, 0);
    }
  }

  function handleSavePantry() {
    try {
      localStorage.setItem(ACTIVE_PANTRY_STORAGE_KEY, JSON.stringify(activePantryTypes));
    } catch {
      // Private browsing / quota exceeded — the selection still applies for
      // this session, it just won't be remembered on the next visit.
    }
    setPantryModalOpen(false);
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
      const speed = avgSpeedKmh && avgSpeedKmh > 0 ? avgSpeedKmh : FALLBACK_AVG_SPEED_KMH;
      setGpxDurationHours(Math.round((parsed.distanceKm / speed) * 100) / 100);
      // A successful upload makes the GPX the active route source — the
      // Strava selector resets/clears rather than sitting alongside it, so
      // there's only ever one route "in play" at a time.
      setMode("gpx");
      setSelectedRouteId("");
      setGpxUploadOpen(false);
    } catch {
      setParsedGpx(null);
      setGpxError("No se pudo leer el archivo — comprueba que sea un .gpx válido.");
    }
  }

  async function handleCalculate() {
    setLoading(true);
    setError(null);
    try {
      const departureIso = new Date(departureLocal).toISOString();
      const pocketFoodPayload = {
        ...pocketFood,
        customCarbsG,
        // Only ever `true` while a real gel is actually selected — see
        // `hasGelSelected` above.
        includeCaffeine: hasGelSelected && includeCaffeine,
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
              intensity,
              isTargetEvent,
              pocketFood: pocketFoodPayload,
              fuelingMode,
              trainLow,
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
                // "Rutas Multipuerto de Alta Montaña" — a GPX track already
                // has per-point altitude, so the passes are detected locally
                // (see `lib/gpx-import.ts`) rather than needing a Strava
                // streams call the way a saved route does.
                mountainPasses: parsedGpx.mountainPasses,
                intensity,
                isTargetEvent,
                pocketFood: pocketFoodPayload,
                fuelingMode,
                trainLow,
              }
            : {
                mode: "quick",
                departureIso,
                durationHours: quickDurationHours,
                // No more "Vatios Objetivo" input — the server derives
                // relative intensity purely from this zone's %FTP against
                // the athlete's real profile FTP, same shared selector as
                // route/GPX mode.
                intensity,
                isTargetEvent,
                pocketFood: pocketFoodPayload,
                fuelingMode,
                trainLow,
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
        setResult(null);
        return;
      }
      setResult(data);
      setHasCalculatedOnce(true);
      setIsOfflineCache(false);
      // A fresh calculation already used the athlete's real profile bottle
      // size — any in-situ override from a previous result no longer
      // applies to this new one.
      setBottleCapacityOverrideMl(null);
      setBottleCapacityEditorOpen(false);
      setShowBikeScoops(false);
      try {
        localStorage.setItem(LAST_FUELING_STRATEGY_KEY, JSON.stringify(data));
      } catch {
        // Private browsing / quota exceeded — the offline fallback simply
        // won't have anything to load next time, not worth failing over.
      }
    } catch {
      setError("No se pudo calcular la estrategia de fueling.");
    } finally {
      setLoading(false);
    }
  }

  return (
    // `overflow-visible` overrides the base `Card` primitive's own
    // `overflow-hidden` (needed elsewhere for image-corner clipping,
    // untouched at the shared-component level) specifically for this one
    // call site — `overflow: hidden` on any ancestor establishes a "scroll
    // container" per the CSS Overflow spec even with nothing to actually
    // scroll, which silently defeats `position: sticky` on any descendant
    // (verified live: Card 04's balance pill scrolled away with the page
    // instead of sticking, until this override was added). Safe here since
    // the one thing inside this component that genuinely needs corner
    // clipping — the Paso 01 map — already has its own *local*
    // `overflow-hidden` wrapper div, independent of this outer Card.
    <Card className={cn(flatMobileCardClass, "overflow-visible")}>
      <CardHeader>
        {/* `text-xl font-semibold text-zinc-900` overrides `CardTitle`'s own
            shared default (`text-sm font-bold uppercase tracking-wide`) —
            this one card's title is elevated to read like a page-level `<h1>`
            now that it houses the numbered 01/02/03 step structure below,
            matching `/perfil`'s own heavier title treatment. `mb-3` on
            mobile specifically (down from an earlier `mb-6`, part of the
            "Jerarquía de Espaciado Editorial" ultracompact pass) is still
            needed since `flatMobileCardClass` zeroes `--card-spacing` there
            and would otherwise leave the title flush against Paso 01 below
            it — `sm:` and up keeps `mb-0`, relying on the real gap
            `--card-spacing` itself already provides, so the margin cancels
            there to avoid doubling up. */}
        <CardTitle className="mb-3 text-xl font-semibold tracking-normal text-zinc-900 normal-case sm:mb-0">
          Planificador de nutrición
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* PASO 01 · Selección y origen de ruta — the mode toggle plus
            whichever source-specific fields that mode needs (Strava route
            select + map, manual duration/watts, or a GPX upload + map). Full
            white "tarjeta madre" (`bg-white`, zero border, zero shadow,
            `rounded-sm`) matching `/perfil`'s own numbered-card convention —
            see the `01 ·`/`02 ·`/`03 ·` eyebrow labels throughout this
            component. The map itself still bleeds edge-to-edge: the
            label/select/dropzone portion keeps its own `p-4 sm:p-6` padding,
            but `RouteMapPreview` is a direct sibling with none of its own,
            so it touches this card's own left/right/bottom boundary —
            `overflow-hidden` on the outer card clips the map's rectangular
            Leaflet container to match `rounded-sm`; `RouteMapPreview`'s own
            default `mt-3`/`rounded-sm` are overridden via its `className`
            prop specifically for this reason. */}
        <div className="overflow-hidden rounded-sm bg-white shadow-none">
          <div className="p-4 sm:p-6">
            <span className="font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase">
              01 · Selección y origen de ruta
            </span>

            {/* Simplified from 3 tabs to 2 — "Ruta / GPX" absorbs the old
                standalone "Subir GPX" tab as a nested secondary action
                inside the Strava-route tab instead of a third top-level
                mode, since both are really the same underlying concept ("a
                route with real geometry") differing only in *where* that
                geometry comes from. `mode` itself still has 3 internal
                values (route/quick/gpx) — everything downstream (Paso 02's
                conditionals, the map render, `handleCalculate`'s request
                body) is untouched; only this toggle and Paso 01's own
                internals changed. */}
            <div className="mt-2 grid grid-cols-2 gap-2 *:min-w-0">
              <button
                type="button"
                onClick={() => setMode(parsedGpx ? "gpx" : "route")}
                className={cn(
                  segmentedButtonClass,
                  mode === "route" || mode === "gpx"
                    ? "border-transparent bg-terracotta text-white"
                    : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400"
                )}
              >
                <span className={segmentedButtonLabelClass}>Strava / GPX</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("quick")}
                className={cn(
                  segmentedButtonClass,
                  mode === "quick"
                    ? "border-transparent bg-terracotta text-white"
                    : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400"
                )}
              >
                <span className={segmentedButtonLabelClass}>Entreno Manual</span>
              </button>
            </div>

            {(mode === "route" || mode === "gpx") && (
              <div className="mt-4">
                {mode === "gpx" && parsedGpx ? (
                  // A GPX has been uploaded and is the active route source —
                  // the Strava selector is hidden entirely (not just cleared)
                  // while it's active, so there's only ever one visible
                  // "current route" at a time.
                  <div className="flex items-center justify-between gap-3 rounded-sm bg-[#F8F7F5] px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900">{parsedGpx.name}</p>
                      <p className="font-mono text-xs text-zinc-500">
                        {parsedGpx.distanceKm}km · {parsedGpx.elevationGainM}m D+
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setParsedGpx(null);
                        setGpxError(null);
                        setMode("route");
                        // Back to a genuinely empty selection, not the first
                        // Strava route — same "never silently pick one for
                        // the athlete" rule the initial state follows.
                        setSelectedRouteId("");
                      }}
                      className="shrink-0 cursor-pointer text-[11px] font-semibold tracking-widest text-zinc-500 uppercase transition-colors duration-150 hover:text-zinc-900"
                    >
                      Quitar GPX
                    </button>
                  </div>
                ) : (
                  <>
                    {routes.length > 0 ? (
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <label htmlFor="route" className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase">
                            Ruta
                          </label>
                          <button
                            type="button"
                            onClick={handleRefreshRoutes}
                            disabled={refreshingRoutes}
                            title="Recargar rutas desde Strava"
                            className="flex cursor-pointer items-center gap-1 text-[10px] font-mono tracking-widest text-zinc-500 uppercase transition-colors duration-150 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <RefreshCw className={cn("size-3", refreshingRoutes && "animate-spin")} />
                            {refreshingRoutes ? "Sincronizando…" : "Recargar"}
                          </button>
                        </div>
                        {/* The select's own background/native arrow render
                            unconditionally — a refresh never swaps this control for
                            a generic loading block. While `refreshingRoutes` is
                            true, it's simply disabled with one muted placeholder
                            option plus a micro-spinner overlaid to its own left of
                            the chevron, so the control's shape never jumps. A
                            porcelain `bg-[#F8F7F5]` fill (not this app's usual
                            white `selectableFieldClass`) marks this one select as a
                            sub-block nested *inside* the now-white card — zero
                            border either way, matching this app's 100%-frameless
                            convention. */}
                        <div className="relative mt-1.5">
                          <select
                            id="route"
                            className={cn(
                              "w-full cursor-pointer appearance-none rounded-sm border-0 bg-[#F8F7F5] px-4 py-2 pr-9 text-sm font-sans text-zinc-900 transition-colors duration-150 hover:bg-[#F1EEE7] focus:outline-none focus:ring-1 focus:ring-terracotta",
                              refreshingRoutes && "text-zinc-400"
                            )}
                            value={refreshingRoutes ? "__syncing" : selectedRouteId}
                            onChange={(e) => setSelectedRouteId(e.target.value)}
                            disabled={refreshingRoutes}
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
                      </div>
                    ) : (
                      <div className="flex flex-col items-start gap-2 border border-dashed border-neutral-300 px-4 py-3">
                        <p className="text-sm text-neutral-500">
                          Sin rutas en Strava — usa la calculadora rápida o sube un GPX.
                        </p>
                        <button
                          type="button"
                          onClick={handleRefreshRoutes}
                          disabled={refreshingRoutes}
                          className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold tracking-widest text-neutral-600 uppercase transition-colors duration-150 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <RefreshCw className={cn("size-3.5", refreshingRoutes && "animate-spin")} />
                          {refreshingRoutes ? "Sincronizando…" : "Buscar rutas de nuevo"}
                        </button>
                      </div>
                    )}

                    {/* Compact secondary action — GPX upload is nested here
                        rather than a third top-level tab, since uploading a
                        file is just an alternate way of arriving at the same
                        "route with real geometry" this whole card is about. */}
                    <button
                      type="button"
                      onClick={() => setGpxUploadOpen((v) => !v)}
                      className="mt-2 flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase transition-colors duration-150 hover:text-zinc-900"
                    >
                      <Upload className="size-3.5" />
                      {gpxUploadOpen ? "Cancelar" : "+ Subir GPX"}
                    </button>

                    {gpxUploadOpen && (
                      <div className="mt-2">
                        <div
                          onDragOver={(e) => {
                            e.preventDefault();
                            setIsDraggingGpx(true);
                          }}
                          onDragLeave={() => setIsDraggingGpx(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setIsDraggingGpx(false);
                            const file = e.dataTransfer.files?.[0];
                            if (file) handleGpxFile(file);
                          }}
                          className={cn(
                            "flex flex-col items-center justify-center gap-2 border-2 border-dashed px-4 py-8 text-center transition-colors duration-150",
                            isDraggingGpx ? "border-neutral-900 bg-neutral-50" : "border-neutral-300"
                          )}
                        >
                          <Upload className="size-5 text-neutral-400" />
                          <p className="text-sm text-neutral-600">
                            Arrastra tu archivo .gpx aquí, o{" "}
                            <label
                              htmlFor="gpx-upload"
                              className="cursor-pointer font-semibold text-neutral-900 underline underline-offset-2"
                            >
                              selecciona un archivo
                            </label>
                          </p>
                          <input
                            id="gpx-upload"
                            type="file"
                            accept=".gpx"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleGpxFile(file);
                            }}
                          />
                        </div>
                        {gpxError && <p className="mt-2 text-sm text-status-warning">{gpxError}</p>}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {mode === "quick" && (
              <div className="mt-4 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label className={formFieldLabelClass}>Duración estimada</label>
                  {/* Horas/Minutos used to be two full-width stacked inputs
                      (each its own grid cell in a 3-col row alongside Vatios
                      Objetivo) — on mobile that meant two full-width boxes
                      taking double the vertical space for one logical
                      value. Merged into one label with a 2-col inner grid
                      instead, each input carrying its own unit suffix so
                      there's no separate text label needed per field. */}
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
                        className={cn(inputClass, "pr-8")}
                        value={quickHoursInput}
                        onChange={(e) => setQuickHoursInput(e.target.value)}
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
                        className={cn(inputClass, "pr-10")}
                        value={quickMinutesInput}
                        onChange={(e) => setQuickMinutesInput(e.target.value)}
                      />
                      <span className="pointer-events-none absolute right-3 font-mono text-xs text-zinc-400">
                        min
                      </span>
                    </div>
                  </div>
                </div>
                {/* "Vatios Objetivo" was removed entirely — its own input
                    used to sit here, next to Duración, as an independent
                    watts-based intensity source. The shared Intensidad
                    Objetivo selector now covers that role for every mode
                    (unlike before, where leaving this on its placeholder
                    was a valid choice in Entreno Manual specifically) —
                    the engine derives relative intensity purely from this
                    zone's %FTP against the athlete's real profile FTP, so
                    a real selection is mandatory here too (see
                    `quickValid`). */}
                <IntensityObjectiveSelect id="intensity-quick" value={intensity} onChange={setIntensity} />
              </div>
            )}
          </div>

          {mode === "route" && routes.length > 0 && (
            <RouteMapPreview
              points={selectedRoutePoints}
              distanceKm={selectedRoute?.distanceKm ?? null}
              elevationGainM={selectedRoute?.elevationGainM ?? null}
              className="mt-0 rounded-none"
            />
          )}
          {mode === "gpx" && (
            <RouteMapPreview
              points={parsedGpx?.points ?? null}
              distanceKm={parsedGpx?.distanceKm ?? null}
              elevationGainM={parsedGpx?.elevationGainM ?? null}
              className="mt-0 rounded-none"
            />
          )}
        </div>

        {/* PASO 02 · Condiciones de la salida — Intensidad Objetivo (Sub-
            sección A, skipped in Entreno Manual mode since real watts already
            *is* the intensity input there) and Fecha y Hora de Salida (Sub-
            sección B, every mode). One flat white "tarjeta madre," no nested
            sub-cards — `gap-3` alone separates the sub-sections ("Jerarquía
            de Espaciado Editorial": related controls sitting side by side
            get the tighter `space-y-3` scale, not the looser `gap-5` this
            used to carry). The `mt-2` right under the eyebrow (down from
            `mt-4`) is that same pass's "título numerado → primer campo"
            micro-spacing rule. */}
        <div className="rounded-sm bg-white p-4 sm:p-6 shadow-none">
          <span className="font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase">
            02 · Condiciones de la salida
          </span>

          {mode === "route" && (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <IntensityObjectiveSelect id="intensity" value={intensity} onChange={setIntensity} />
              <DeparturePicker
                dayMode={departureDayMode}
                onDayModeChange={setDepartureDayMode}
                customDate={departureCustomDate}
                onCustomDateChange={setDepartureCustomDate}
                hour={departureHour}
                onHourChange={setDepartureHour}
              />
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
                <IntensityObjectiveSelect id="intensity-gpx" value={intensity} onChange={setIntensity} />
                <DeparturePicker
                  dayMode={departureDayMode}
                  onDayModeChange={setDepartureDayMode}
                  customDate={departureCustomDate}
                  onCustomDateChange={setDepartureCustomDate}
                  hour={departureHour}
                  onHourChange={setDepartureHour}
                />
                <div className="flex flex-col gap-2">
                  <label htmlFor="gpx-duration" className={formFieldLabelClass}>
                    <Pencil className="mr-1 inline size-3" />
                    Tiempo estimado (editar)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="gpx-duration"
                      type="number"
                      inputMode="decimal"
                      min={0.25}
                      step={0.25}
                      className={inputClass}
                      value={gpxDurationHours}
                      onChange={(e) => setGpxDurationHours(Math.max(0.25, Number(e.target.value) || 0))}
                    />
                    <span className="font-mono text-xs whitespace-nowrap text-neutral-500">
                      {formatHoursMinutes(gpxDurationHours)}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-neutral-500">
                {avgSpeedKmh
                  ? `Estimado a tu ritmo medio real de Strava (${Math.round(avgSpeedKmh)}km/h) — edítalo si lo necesitas.`
                  : `Sin historial de Strava suficiente — estimación genérica a ${FALLBACK_AVG_SPEED_KMH}km/h, ajusta el tiempo manualmente.`}
              </p>
            </div>
          )}

          {/* Paradas previstas en ruta — relocated here from Card 04
              ("Reubicación de Paradas al Paso 02"): a café/gasolinera stop
              is a departure-planning decision, made alongside intensity and
              fecha/hora, not an avituallamiento config choice, so it now
              sits in the same card as those two rather than one step later.
              Zero-friction by default ("Sin paradas," 0 taps needed) —
              picking 1 or 2 stops is the athlete's own opt-in choice, never
              pre-selected on their behalf. The brief describes an adaptive
              default ("1 Parada" once the projected deficit exceeds 60g
              HC) — not implemented, deliberately: that deficit only exists
              once bottle role + pocket food are configured in Card 04,
              which now happens strictly *after* this selector renders, so
              there's no real figure yet to base an adaptive default on at
              this point in the flow; defaulting to "1 Parada" against an
              unconfigured (and therefore maximal) deficit would suggest a
              stop far more often than actually needed. The grams each stop
              shows are never typed in — always `cafeteriaStopDeficitG`
              split across however many stops are picked (see
              `getCafeteriaStopPlans` above), so the preview only has real
              entries once a strategy has actually been calculated. */}
          <div className="mt-4">
            <span className="mb-2 block font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase">
              Paradas previstas en ruta
            </span>
            <div className="grid grid-cols-3 gap-2 *:min-w-0">
              {CAFETERIA_STOP_COUNT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCafeteriaStopCount(opt.value)}
                  className={cn(
                    segmentedButtonClass,
                    cafeteriaStopCount === opt.value
                      ? "border-transparent bg-terracotta text-white"
                      : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400"
                  )}
                >
                  <span className={segmentedButtonLabelClass}>{opt.label}</span>
                </button>
              ))}
            </div>

            {result && cafeteriaStopPlans.length > 0 && (
              <div className="mt-2 flex flex-col divide-y divide-zinc-200 rounded-lg bg-[#F8F7F5] p-3">
                {cafeteriaStopPlans.map((plan) => (
                  <div key={plan.index} className={cn("flex flex-col gap-0.5", plan.index > 1 && "pt-2.5")}>
                    <span className="text-sm font-medium text-neutral-900">
                      ☕ Parada {plan.index} ({getCafeteriaStopLocationLabel(plan)}): ~{plan.carbsG}g HC
                    </span>
                    <span className="pl-4 text-xs text-neutral-500">└─ {plan.suggestion}</span>
                  </div>
                ))}
              </div>
            )}
            {result && cafeteriaStopCount > 0 && cafeteriaStopPlans.length === 0 && (
              <p className="mt-2 text-xs text-neutral-500">
                Tu objetivo ya está cubierto — no hace falta ninguna parada extra.
              </p>
            )}
            {!result && cafeteriaStopCount > 0 && (
              <p className="mt-2 text-xs text-neutral-500">
                Calcula tu estrategia para ver cuántos gramos cubrir en cada parada.
              </p>
            )}
          </div>

          {/* Modo Competición / Ruta Objetivo — integrated strictly inside
              Card 02 (it used to float on the porcelain canvas between this
              card and the CTA button), at the bottom, separated by a thin
              divider so it reads as this card's own trailing sub-section
              rather than a fourth sibling condition alongside route/quick/
              gpx above it. */}
          <div className="mt-3 border-t border-zinc-100 pt-3">
            <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={isTargetEvent}
                onChange={(e) => setIsTargetEvent(e.target.checked)}
                className="size-3.5 cursor-pointer accent-terracotta"
              />
              Ruta objetivo / Competición
            </label>
            {isTargetEvent && (
              <p className="mt-1.5 text-[11px] text-neutral-500">
                Ajusta la pauta al máximo límite de absorción intestinal (hasta 120g/h) y
                aplica un ratio Fructosa:Maltodextrina de 1:0.8 optimizado para alta
                intensidad.
              </p>
            )}
          </div>

          {/* "Entrenamientos en Ayunas / Z2 Low Carb (Train Low)" — a
              deliberate low-carb-availability session; checking this
              overrides the usual intensity-driven carb target with a fixed
              0-25g/h electrolyte-only floor (`result.trainLow`), while
              hydration/sodium stay at their normal, full targets. */}
          <div className="mt-3 border-t border-zinc-100 pt-3">
            <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={trainLow}
                onChange={(e) => setTrainLow(e.target.checked)}
                className="size-3.5 cursor-pointer accent-terracotta"
              />
              Modo Eficiencia Metabólica (Train Low / Ayunas)
            </label>
            {trainLow && (
              <p className="mt-1.5 text-[11px] text-neutral-500">
                Fija el objetivo de carbohidratos en 0-25g/h (solo electrolitos) para estimular
                la oxidación de grasas — hidratación y sodio no se ven afectados.
              </p>
            )}
          </div>
        </div>

        {/* Paso 03 (Estrategia nutricional + Comida en bolsillo) used to
            live here, pre-cálculo — "Reestructuración UX: Flujo Invertido"
            moved it entirely into the results container below (Sub-bloques
            B/C), so the initial form is just Paso 01 + Paso 02 + the CTA.
            The athlete now sees their real calculated targets *before*
            being asked to plan how to cover them, rather than configuring
            a food strategy against a target they haven't seen yet. */}

        {/* Final CTA — sits directly below Card 02, not inside it — the
            "Ruta objetivo / Competición" checkbox above is a card 02
            sub-section (a departure condition), but the button itself is
            an action, matching `/perfil`'s own "single full-width action
            button after the numbered cards" convention. */}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleCalculate}
            disabled={
              loading ||
              !isProfileComplete ||
              (mode === "route" && (!selectedRoute || !intensity)) ||
              (mode === "gpx" && (!parsedGpx || !intensity)) ||
              (mode === "quick" && !quickValid) ||
              // "Ciclo de Vida del Botón Principal" — once a result exists
              // for the current inputs, the button disables itself
              // immediately (nothing left to (re)calculate until something
              // changes) — the "Reseteo Automático" effect above is what
              // clears `result` and re-enables it the instant any Paso
              // 01/02 input actually changes.
              Boolean(result)
            }
            title={
              isProfileComplete && routeModeIncomplete
                ? "Selecciona una ruta e intensidad para calcular"
                : undefined
            }
            className={cn(
              "w-full py-3.5 text-sm",
              isProfileComplete
                ? primaryButtonClass
                : "inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-sm bg-neutral-200 px-4 font-mono text-xs font-semibold tracking-wider text-neutral-400 uppercase"
            )}
          >
            {isProfileComplete ? (
              <>
                <Zap className="size-4 shrink-0" />
                {loading
                  ? "Calculando…"
                  : hasCalculatedOnce
                    ? "Re-calcular estrategia nutricional"
                    : "Calcular estrategia nutricional"}
              </>
            ) : (
              <>
                <Lock className="size-4 shrink-0" />
                Calcular estrategia (requiere perfil completo)
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
          <div ref={resultRef} className="flex scroll-mt-20 flex-col gap-4 border-t border-neutral-200 pt-4">
            {isOfflineCache && (
              <div className="flex items-center gap-1.5 border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700">
                <Zap className="size-3.5 shrink-0" />
                Estrategia guardada en caché (Modo Offline)
              </div>
            )}

            {/* "Agrupación Estructurada de Resultados" — every calculated
                output now lives inside one of 3 independent white "tarjeta
                madre" cards (bg-white rounded-xl p-4 border-0 shadow-none)
                on the porcelain canvas, replacing the prior mix of one
                combined card (old Sub-bloques A/B/C) plus several genuinely
                floating elements below it (the dark Hero card, the weather
                card, the bare stat row, the gut-training warning, the
                Balance Neto grid, and every recipe/timeline/reload/carb-
                loading accordion) — none of those had their own white-card
                boundary before this pass. `rounded-xl` is a deliberate,
                scoped exception to this app's app-wide `rounded-sm` "Radio
                de Bordes Pequeño Global" convention (see the design-system
                history below "PNS premium redesign") — this prompt's own
                literal spec asks for `rounded-xl` on these 3 specific result
                cards; every other card/button/select in the app is
                unaffected. Weather, the Hero card's per-bottle dose callout,
                and the gut-training warning weren't named in the prompt's
                own 3-card outline, but dropping real, already-computed data
                or a deliberately-tuned design element (see "PNS premium
                redesign" above for the Hero card's own history) would
                contradict this app's "never silently drop real data"
                convention — all three are folded into Tarjeta 1 instead,
                the card whose "objetivos calculados" concern they're most
                directly part of. */}

            {/* 🎴 Tarjeta 1 · 03 · Metabolismo y objetivos calculados —
                exclusively the theoretical/environmental targets for this
                ride; no dosing recipe here. The old "Dosis casera por
                bidón" dark hero preview (per-bottle Malto/Fructosa/Sal plus
                the hydration-frequency line) was removed outright — showing
                a bottle recipe before the athlete has configured bottle
                role or pocket food in Card 04 below is a physiological
                contradiction (the recipe depends on what's left uncovered
                by pocket food, which isn't chosen yet at this point in the
                flow). Neither figure is lost: the hydration-interval line
                still lives in Card 05's "Cronograma dinámico de ingesta,"
                and the per-bottle recipe lives in Card 05's own "Receta de
                laboratorio casero," both computed from the athlete's real
                Card 04 configuration instead of a premature preview. */}
            <div className="rounded-xl border-0 bg-white p-4 shadow-none">
              <span className="mb-3 block font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                03 · Metabolismo y objetivos calculados
              </span>

              {/* Cuadrícula 2x2 de objetivos por hora + total — `*:min-w-0`
                  lets each cell shrink below its content's intrinsic width
                  instead of forcing the grid track wider (the default
                  `min-width: auto` grid items get otherwise), so a long
                  number/tooltip trigger can never push this card past the
                  viewport edge on a narrow phone. */}
              {/* "Instrumental Técnico" (PNS editorial pass) — the 4 tiles
                  used to each carry their own pastel Material-Design tint
                  (amber/sky/emerald) plus a matching border — replaced
                  outright with one uniform porcelain surface and plain
                  laboratory-notation labels (HC/H₂O/Na⁺/TIME) instead of
                  color-coding, matching the same "instrumental de
                  precisión" read as a Coggan power-profile chart rather
                  than a consumer health app. The big numeric value stays
                  bold `zinc-900` in every tile, now `font-mono` end to end
                  (label included) — a technical readout, not a dashboard
                  stat card. */}
              <div className="grid grid-cols-2 gap-3 *:min-w-0">
                <div className="flex flex-col gap-1 rounded-lg bg-[#F8F7F5] p-3">
                  <span className="font-mono text-[10px] tracking-widest text-zinc-400 uppercase">
                    TIME · Duración
                  </span>
                  <span className="font-mono text-xl font-bold tracking-tight text-zinc-900 tabular-nums sm:text-2xl">
                    {formatHoursMinutes(result.durationHours)}
                  </span>
                </div>
                <div className="relative flex flex-col gap-1 overflow-visible rounded-lg bg-[#F8F7F5] p-3">
                  <span className="flex items-center gap-1">
                    <span className="font-mono text-[10px] tracking-widest text-zinc-400 uppercase">
                      HC · Carbohidratos
                    </span>
                    <FuelingContextTooltips carbsGPerHour={result.carbsGPerHour} />
                  </span>
                  <span className="font-mono text-xl font-bold tracking-tight text-zinc-900 tabular-nums sm:text-2xl">
                    {result.carbsGPerHour}
                    <span className="ml-1 text-xs font-normal text-zinc-400">g/h</span>
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    Total: {result.totalRideCarbsG} g
                  </span>
                </div>
                <div className="flex flex-col gap-1 rounded-lg bg-[#F8F7F5] p-3">
                  <span className="font-mono text-[10px] tracking-widest text-zinc-400 uppercase">
                    H₂O · Hidratación
                  </span>
                  <span className="font-mono text-xl font-bold tracking-tight text-zinc-900 tabular-nums sm:text-2xl">
                    {result.fluidLossMlPerHour}
                    <span className="ml-1 text-xs font-normal text-zinc-400">ml/h</span>
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    Total: {(totalFluidMl / 1000).toFixed(1)} L
                  </span>
                </div>
                <div className="flex flex-col gap-1 rounded-lg bg-[#F8F7F5] p-3">
                  <span className="font-mono text-[10px] tracking-widest text-zinc-400 uppercase">
                    Na⁺ · Sodio
                  </span>
                  <span className="font-mono text-xl font-bold tracking-tight text-zinc-900 tabular-nums sm:text-2xl">
                    {result.sodiumMgPerHour}
                    <span className="ml-1 text-xs font-normal text-zinc-400">mg/h</span>
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    Total: {totalSodiumMg} mg
                  </span>
                </div>
              </div>

              <div className="mt-3">
                <WeatherImpactCard
                  temperatureC={result.weather.temperatureC}
                  temperatureMaxC={result.weather.temperatureMaxC}
                  humidityPct={result.weather.humidityPct}
                  windSpeedKmh={result.weather.windSpeedKmh}
                  source={result.weather.source}
                  multiPointSample={result.weather.multiPointSample}
                  lapseRateAdjustmentC={result.weather.lapseRateAdjustmentC}
                  altitude={result.weather.altitude}
                />
              </div>

              {/* "Adaptación Térmica Extrema" — cold below 8°C, heat above
                  32°C, both driven by the same final temperature
                  `WeatherImpactCard` already shows above. Purely
                  informational (the actual recipe/sodium/bottle-plan
                  adjustments already happened server-side) so the athlete
                  understands *why* the numbers below look different from a
                  normal-weather calculation. */}
              {result.thermalAdaptation.isExtremeCold && (
                <div className="mt-3 flex items-start gap-2 rounded-sm bg-[#F8F7F5] px-3 py-2 text-xs text-zinc-600">
                  <Snowflake className="mt-0.5 size-3.5 shrink-0 text-zinc-500" />
                  <span>
                    Frío extremo (&lt;8°C) — prioriza comida sólida/geles en bolsillo (hasta un
                    70-80% del objetivo) y hemos reducido la concentración del bidón para evitar
                    sobrecarga hídrica.
                  </span>
                </div>
              )}
              {result.thermalAdaptation.isExtremeHeat && (
                <div className="mt-3 flex items-start gap-2 rounded-sm border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
                  <Sun className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Calor sofocante (&gt;32°C) — sodio elevado a ≥900mg/L y reservamos al menos 1
                    bidón de agua pura para termorregulación/aclarado bucal.
                  </span>
                </div>
              )}

              {/* Plain informational text, deliberately not a navigable
                  link — a mid-form click to "/perfil" would abandon
                  whatever the athlete has already configured in this
                  planner. Suppressed under Train Low — a low intake by
                  design isn't a gut-capacity limitation worth warning
                  about. */}
              {result.gutTraining.isGutLimited && !result.trainLow && (
                <p className="mt-3 border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
                  Tu intestino está limitado a {result.gutTraining.gutCapGPerHour} g/h (esta ruta
                  pediría {result.gutTraining.uncappedGPerHour} g/h). Puedes aumentar tu capacidad
                  digestiva en la pestaña Perfil &gt; Capacidad Digestiva.
                </p>
              )}
            </div>

            {/* 🎴 Tarjeta 2 · 04 · Simulador y configuración de
                avituallamiento — the bottle-role preference plus the
                pocket-food inventory, rendered flat (no `<details>`
                accordion) since this card's own header already frames the
                whole section. Both the bottle selector *and* every
                pocket-food stepper feed the sticky balance pill above them
                live — see `getBottleCarbsContributionG` for how the bottle
                choice turns into a CUBIERTO figure. No explanatory text
                box, no trailing "Gasto/Ingesta/Déficit" summary, no
                "pulsa Calcular de nuevo" footer note — "Al Grano": this
                card is the interactive simulator, nothing else. */}
            <div className="rounded-xl border-0 bg-white p-4 shadow-none">
              <span className="mb-3 block font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                04 · Simulador y configuración de avituallamiento
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

              {/* Píldora Fija de Balance en Tiempo Real — sticky within this
                  card as the athlete scrolls through the bottle-config
                  selector and the pocket-food inventory below, so OBJETIVO/
                  CUBIERTO/RESTANTE stays on screen instead of requiring a
                  scroll back up. Recomputes instantly from
                  `coveredCarbsG`/`remainingCarbsG` (pure client-side
                  arithmetic, reacting to *both* the bottle selector and
                  every pocket-food stepper) — no network round-trip, no
                  need to press "Calcular" again just to see the coverage
                  change. `top-16 lg:top-4` clears the mobile sticky header
                  (`sticky top-0 z-40`, ~64px tall, `lg:hidden`) so the pill
                  never renders underneath it; desktop has no such header,
                  so it sticks close to the viewport's own top instead. A
                  later "Sticky Bar" spec literally asked for `top-0` here —
                  deliberately not applied: a flat `top-0` would put the
                  pill right back underneath the mobile header, the exact
                  bug `top-16` was added (and verified live) to fix, so this
                  keeps the breakpoint-aware offset and only takes the
                  z-index bump (`z-10` → `z-20`) from that request, giving
                  the pill more headroom above other in-card content
                  without reopening the header-overlap regression. */}
              <div className="sticky top-16 z-20 mb-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg bg-[#F8F7F5]/95 px-3 py-2 text-center font-mono text-[11px] font-semibold tracking-wide text-zinc-700 shadow-sm backdrop-blur-sm sm:text-xs lg:top-4">
                <span>OBJETIVO: {result.totalRideCarbsG}g HC</span>
                <span className="text-zinc-300">|</span>
                <span className="text-status-good">CUBIERTO: {coveredCarbsG}g HC</span>
                <span className="text-zinc-300">|</span>
                <span className={remainingCarbsG > 0 ? "text-status-warning" : "text-status-good"}>
                  RESTANTE: {remainingCarbsG}g HC
                </span>
              </div>

              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                  Configuración de bidones
                </span>
                {/* "Micro-Edición In-Situ de Capacidad de Bidón" — a
                    display-only preview of a different bottle size than the
                    athlete's saved profile, re-scaling the per-bottle
                    grams/Ziploc dose everywhere below with zero server
                    round-trip (see `displayBottlePlan`). */}
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
                      className="flex cursor-pointer items-center gap-1 text-zinc-500 transition-colors duration-150 hover:text-zinc-900"
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
                          ? "border-transparent bg-terracotta text-white"
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
                        ? "border-transparent bg-terracotta text-white"
                        : "border-zinc-300/70 bg-white text-zinc-700 hover:border-zinc-400"
                    )}
                  >
                    <span className={segmentedButtonLabelClass}>{opt.label}</span>
                  </button>
                ))}
              </div>

              {/* Inventario de Bolsillo Interactivo — only the athlete's
                  own "Mi Despensa" selection (every catalog item by
                  default, narrowed via "Editar mi despensa"), always
                  editable. */}
              <div className="mt-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                    Comida en bolsillo
                  </span>
                  <button
                    type="button"
                    onClick={() => setPantryModalOpen(true)}
                    className={cn(secondaryButtonClass, "w-fit shrink-0 px-2.5 py-1.5 text-[10px]")}
                  >
                    Editar mi despensa
                  </button>
                </div>
                {activePantryTypes.length === 0 && !ziplocDoseActive && (
                  <p className="mb-2 text-xs text-neutral-500">
                    Sin alimentos activos — actívalos en &quot;Editar mi despensa&quot; para verlos aquí.
                  </p>
                )}
                <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-x-4 md:gap-y-0">
                  {visiblePocketFoodTypes.map((type) => (
                    <PocketFoodStepperRow
                      key={type}
                      label={pocketFoodName(type)}
                      category={POCKET_FOOD_CATEGORY[type]}
                      carbsG={POCKET_FOOD_CARBS_G[type]}
                      ariaLabel={pocketFoodLabels[type]}
                      qty={pocketFood[type] ?? 0}
                      onChange={(qty) => setPocketFoodQty(type, qty)}
                    />
                  ))}
                  {/* "Dosis de recarga Mix (Ziploc)" — replaces the old
                      automatic "Estrategia de recarga en ruta" red card:
                      the athlete declares how many pre-measured mix doses
                      they're carrying, and each one counts toward CUBIERTO
                      exactly like any other pocket-food item. Not part of
                      `ALL_POCKET_FOOD_TYPES`/the real catalog (its grams
                      are dynamic, not a fixed constant — see
                      `ziplocDoseGramsPerUnit` above), so it's gated by its
                      own `ziplocDoseActive` flag rather than
                      `activePantryTypes`. */}
                  {ziplocDoseActive && (
                    <PocketFoodStepperRow
                      label="Dosis de recarga Mix (Ziploc)"
                      category="FÓRMULA"
                      carbsG={ziplocDoseGramsPerUnit}
                      ariaLabel="Dosis de recarga Mix (Ziploc)"
                      qty={ziplocDoseCount}
                      onChange={(qty) =>
                        setZiplocDoseCount(Math.max(0, Math.min(MAX_POCKET_FOOD_QTY, qty)))
                      }
                    />
                  )}
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
                {/* "+ Mostrar más alimentos" — the catalog's own remaining
                    items (whatever real "Editar mi despensa" doesn't
                    already narrow it to) stay one tap away rather than
                    gone, collapsing back down once toggled a second time. */}
                {(hiddenPocketFoodCount > 0 || showAllPocketFood) && (
                  <button
                    type="button"
                    onClick={() => setShowAllPocketFood((prev) => !prev)}
                    className="mt-1 flex w-full cursor-pointer items-center justify-center gap-1 py-1.5 font-mono text-[11px] font-semibold tracking-wide text-terracotta uppercase transition-colors hover:text-terracotta-hover"
                  >
                    <ChevronDown
                      className={cn(
                        "size-3.5 shrink-0 transition-transform duration-150",
                        showAllPocketFood && "rotate-180"
                      )}
                    />
                    {showAllPocketFood ? "Mostrar menos" : `Mostrar más alimentos (${hiddenPocketFoodCount})`}
                  </button>
                )}
                {/* A modifier on whatever gel(s) are already selected, not a
                    4th gel-catalog entry — only shown once a real gel dose
                    is picked, and unmounting it (rather than just disabling
                    it) when the last gel is removed means its own `checked`
                    state can't silently keep driving the caffeine milestone
                    with nothing behind it (also enforced server-side, see
                    `pocketFoodPayload` above). */}
                {hasGelSelected && (
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
                    <input
                      type="checkbox"
                      checked={includeCaffeine}
                      onChange={(e) => setIncludeCaffeine(e.target.checked)}
                      className="size-3.5 cursor-pointer accent-terracotta"
                    />
                    Incluye cafeína (~100mg)
                  </label>
                )}
              </div>
            </div>
            {/* "Planificación de Paradas en Ruta" (selector + live per-stop
                preview) moved entirely to Card 02 (Condiciones de la
                salida) — see the "Paradas previstas en ruta" sub-section
                there. A stop is a departure-planning decision the athlete
                makes alongside intensity/fecha, not an avituallamiento
                config choice, so keeping its own selector here duplicated
                the one now sitting in Card 02. Nothing is lost by dropping
                it from this card specifically: `cafeteriaStopPlans` still
                feeds Card 05's "Cronograma dinámico de ingesta" and its
                "Plan de paradas en ruta" checklist line exactly as before. */}

            <PantryEditorModal
              open={pantryModalOpen}
              onOpenChange={setPantryModalOpen}
              catalog={ALL_POCKET_FOOD_TYPES}
              activeTypes={activePantryTypes}
              onToggle={togglePantryItem}
              onSave={handleSavePantry}
              extraItem={{
                label: "Dosis de recarga Mix (Ziploc)",
                carbsLabel: `~${ziplocDoseGramsPerUnit}g HC`,
                active: ziplocDoseActive,
                onToggle: () => {
                  const nextActive = !ziplocDoseActive;
                  setZiplocDoseActive(nextActive);
                  // "Regla Crítica de Reseteo al Desmarcar" — same rule
                  // every other despensa item already follows (see
                  // `togglePantryItem` above): hiding the row zeroes its
                  // quantity immediately so it can't keep silently
                  // contributing to CUBIERTO once it's no longer visible.
                  if (!nextActive) setZiplocDoseCount(0);
                },
              }}
            />

            {/* 🎴 Tarjeta 3 · 05 · Cronograma y checklist de salida —
                "Eliminación Definitiva de la Caja Negra 'Dosis Ejecutiva'":
                the dark Obsidian hero box that used to open this card (the
                fixed recipe figure + scoop-equivalence accordion + sachet
                prep line) is gone outright, not just restyled — every
                figure it carried now lives inside the Checklist's own "En
                bici" section below (see `getBikeChecklistLines`), the one
                place an athlete would actually look for "what do I mix/
                carry," rather than a second, disconnected box above it.
                2 direct blocks now, in this order: the Cronograma (when to
                eat/drink) first, then the Checklist (what to bring) —
                matching the literal spec's own numbered "1. Cronograma... 2.
                Checklist..." order. The déficit alert (real, reactive data)
                and the occasional carb-loading module both stay as their
                own conditional overlays around those 2 blocks, same as
                before. Descargar GPX / Exportar a Garmin, the GPS-alert
                explainer, and every "Copiar"/"Enviar a WhatsApp" export
                button were all removed outright in an earlier pass — the
                athlete screenshots this card if they want to save or share
                it. The dashed top border ("Estética Ticket/Manifiesto")
                marks the whole card as a single expedition ticket, echoing
                the same dashed perforation the Checklist's own
                sub-sections already use internally. */}
            <div className="flex flex-col gap-3 rounded-xl border-0 border-t border-dashed border-t-zinc-300 bg-white p-4 shadow-none">
              <span className="font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                05 · Cronograma y checklist de salida
              </span>

              {/* "Alerta de Déficit Pendiente de Cubrir" — the reason the
                  checklist's own recipe might not be enough on its own.
                  Purely reactive: once the athlete closes the gap from Card
                  04 (a café/gasolinera stop, or enough extra pocket food),
                  `remainingCarbsG` collapses to 0 and this disappears
                  entirely. Suppressed under Train Low — a remaining
                  "déficit" there is the whole point of the session, not
                  something to warn about. */}
              {remainingCarbsG > 15 && !result.trainLow && (
                <div className="flex items-start gap-2 rounded-sm border border-status-warning/40 bg-status-warning/10 p-3">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-warning" />
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold tracking-wide text-status-warning uppercase">
                      Alerta de déficit pendiente de cubrir
                    </span>
                    <p className="text-sm text-neutral-700">
                      Te faltan <span className="font-semibold text-status-warning">{remainingCarbsG}g HC</span>{" "}
                      para alcanzar tu objetivo de la ruta. Te recomendamos activar &quot;Paradas
                      previstas en ruta&quot; (Tarjeta 02) o añadir más comida al bolsillo en la
                      Tarjeta 04 para evitar la pájara.
                    </p>
                  </div>
                </div>
              )}

              {/* Bloque 1 · Cronograma Dinámico de Ingesta — a genuine
                  vertical timeline (a connecting rail + a dot per entry)
                  instead of a flat icon+label list. The recurring
                  hydration-interval line sits above the rail, since it's a
                  standing reminder rather than a single point in time the
                  way every other entry is. */}
              <div className="rounded-sm bg-[#F8F7F5] p-3">
                <span className={eyebrow}>Cronograma dinámico de ingesta</span>
                <p className="mt-2 flex items-center gap-1.5 text-sm text-neutral-700">
                  <Droplet className="size-3.5 shrink-0 text-neutral-500" />
                  Beber 1 bidón (~{displayBottlePlan!.bottleSizeMl} ml) cada{" "}
                  <span className="font-mono font-semibold text-neutral-900">
                    {result.timingTimeline.hydrationIntervalMinutes} min
                  </span>
                </p>
                {/* "Sensibilidad a Cafeína e Horario Nocturno" — the server
                    already dropped every caffeine milestone below when the
                    estimated arrival lands at/after 18:30 local; this is
                    just the visible explanation for why none show up even
                    though a gel with caffeine was selected. */}
                {result.caffeineSuppressed && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-neutral-500">
                    <Moon className="mt-0.5 size-3.5 shrink-0 text-neutral-400" />
                    Cafeína omitida automáticamente por el horario de llegada estimado (≥18:30h)
                    para proteger tu descanso nocturno.
                  </p>
                )}
                {mergedTimelineEntries.length > 0 && (
                  <ol className="mt-3 flex flex-col">
                    {mergedTimelineEntries.map((entry, i) => (
                      <li key={entry.key} className="relative flex gap-2.5 pb-3 last:pb-0">
                        {i < mergedTimelineEntries.length - 1 && (
                          <span
                            aria-hidden
                            className="absolute top-3 left-1.25 h-full w-px bg-zinc-300"
                          />
                        )}
                        <span
                          aria-hidden
                          className="relative z-10 mt-1 size-2.75 shrink-0 rounded-full border-2 border-terracotta bg-white"
                        />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="font-mono text-[10px] text-neutral-500">
                            {entry.approx ? "~" : ""}
                            {entry.atKm != null ? `Km ${entry.atKm}` : `Min ${entry.atMinutes}`}
                          </span>
                          <span className="flex items-center gap-1.5 text-sm text-neutral-700">
                            {entry.icon === "solid" && (
                              <Utensils className="size-3.5 shrink-0 text-neutral-500" />
                            )}
                            {entry.icon === "gel" && (
                              <Zap className="size-3.5 shrink-0 text-neutral-500" />
                            )}
                            {entry.icon === "caffeine" && (
                              <FlaskConical className="size-3.5 shrink-0 text-neutral-500" />
                            )}
                            {entry.icon === "cafeteria" && (
                              <Coffee className="size-3.5 shrink-0 text-neutral-500" />
                            )}
                            {entry.label}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* Bloque 2 · Checklist de Preparación para Llevar — "ticket"
                  formatting: a crisp white card with a dashed perforation
                  between sub-sections and a plain technical dash ("—")
                  bullet per line. Driven by the same bottle config +
                  pocket-food state as the balance pill in Card 04, so it's
                  never out of sync with what CUBIERTO/RESTANTE currently
                  shows — see `getBikeChecklistLines`/`getWaterPlanLines`/
                  `getCafeteriaStopChecklistLines` above. "En bici" renders
                  specially (not through the generic string-list map below)
                  since its mix-bottle row alone carries an inline
                  "[ Ver en cazos ]" reveal and the hypertonic-concentration
                  warning — both used to live in the removed hero box,
                  neither is a plain checklist string. */}
              <div className="rounded-lg border border-zinc-200 bg-white p-4">
                <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
                  <CheckCircle2 className="size-3.5 shrink-0" />
                  Checklist de salida
                </span>
                {bikeChecklistLines.length === 0 &&
                pocketChecklistLines.length === 0 &&
                waterPlanChecklistLines.length === 0 &&
                cafeteriaChecklistLines.length === 0 ? (
                  <p className="mt-2 text-sm text-neutral-500">
                    Sin bidones ni comida de bolsillo seleccionados todavía.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-col gap-2.5 text-sm text-neutral-700">
                    {bikeChecklistLines.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-600">
                          En bici (portabidones):
                        </span>
                        <ul className="flex flex-col gap-1.5">
                          {bikeChecklistLines.map((line) => (
                            <li key={line.key} className="flex flex-col gap-1.5">
                              <div className="flex items-start gap-1.5">
                                <span aria-hidden className="mt-0.5 shrink-0 font-mono text-zinc-400">
                                  —
                                </span>
                                <span>
                                  {line.text}
                                  {line.kind === "mix" && (
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
                              </div>
                              {/* Hypertonic-concentration warning, attached
                                  directly under the mix-bottle line it's
                                  actually about — see "Bottle architecture &
                                  osmolarity control" (`lib/metabolic-engine.
                                  ts`) for why this can fire at all; under
                                  every currently-supported bottle size it's
                                  a defense-in-depth check, not something
                                  routinely seen. */}
                              {line.kind === "mix" &&
                                displayBottlePlan!.fuelBottles.concentrationPct > HYPERTONIC_THRESHOLD_PCT && (
                                  <div className="ml-4.5 flex items-start gap-1.5 rounded-sm border border-status-warning/40 bg-status-warning/10 px-2.5 py-1.5 text-xs text-status-warning">
                                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                                    <span>
                                      Solución hipertónica ({displayBottlePlan!.fuelBottles.concentrationPct}% &gt;{" "}
                                      {HYPERTONIC_THRESHOLD_PCT}%) — añade agua o traslada carga a comida de
                                      bolsillo.
                                    </span>
                                  </div>
                                )}
                              {line.kind === "mix" && showBikeScoops && (
                                <div className="ml-4.5 flex flex-col gap-1 rounded-sm bg-[#F8F7F5] p-2.5 text-xs text-neutral-600">
                                  <p>
                                    Maltodextrina: {displayBottlePlan!.fuelBottles.maltodextrinGPerBottle}g (~
                                    {fuelBottleMeasures!.maltodextrinScoops} cazos)
                                  </p>
                                  <p>
                                    Fructosa: {displayBottlePlan!.fuelBottles.fructoseGPerBottle}g (~
                                    {fuelBottleMeasures!.fructoseScoops} cazos)
                                  </p>
                                  <p>
                                    Sal común: {getTableSaltGrams(displayBottlePlan!.fuelBottles.sodiumMgPerBottle)}g
                                    (~{fuelBottleMeasures!.saltTeaspoons} cdta.)
                                  </p>
                                  <p className="text-[10px] text-neutral-400">
                                    *Equivalencias de referencia: 1 cazo = 30 g de polvo | 1 cdta. de café = 5 g
                                    de sal.
                                  </p>
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {[
                      { title: "En bolsillo / maillot", lines: pocketChecklistLines, icon: null },
                      { title: "Plan de paradas en ruta", lines: cafeteriaChecklistLines, icon: null },
                      { title: "Plan de agua en ruta", lines: waterPlanChecklistLines, icon: <Droplet className="size-3.5 shrink-0" /> },
                    ]
                      .filter((section) => section.lines.length > 0)
                      .map((section) => (
                        <div
                          key={section.title}
                          className="flex flex-col gap-1 border-t border-dashed border-zinc-200 pt-2.5"
                        >
                          <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-600">
                            {section.icon}
                            {section.title}:
                          </span>
                          {/* "Ticket de Expedición / Manifest" — a plain
                              technical dash bullet (no check-icon affordance
                              this isn't a to-do list) matching the dashed
                              perforation separating each sub-section above. */}
                          <ul className="flex flex-col gap-1.5">
                            {section.lines.map((line) => (
                              <li key={line} className="flex items-start gap-1.5">
                                <span
                                  aria-hidden
                                  className="mt-0.5 shrink-0 font-mono text-zinc-400"
                                >
                                  —
                                </span>
                                <span>{line}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* "Estrategia de recarga en ruta" — the old automatic
                  red/warning-toned Ziploc accordion — has been removed
                  outright, per "Eliminación Definitiva de la Tarjeta
                  Roja." Its function is now covered naturally by the
                  athlete's own "Dosis de recarga Mix (Ziploc)" selections
                  in the pocket-food inventory above (same per-dose grams,
                  same checklist line under "En bolsillo / maillot" — see
                  `pocketChecklistLines`), a self-serve declaration rather
                  than an app-imposed reload count. `result.reloadStrategy`
                  itself is untouched server-side — `getWaterPlanLines`
                  above still reads its `waterRefillCount`/
                  `waterRefillLiters` for the unrelated plain-water fountain
                  refill note, which this removal doesn't affect. */}

              {/* Estrategia de carga día −1 — supplementary, occasional
                  content (only rendered on a long/target-event ride), kept
                  outside the 3-tier structure above rather than forced
                  into one of the named tiers. */}
              {result.carbLoading && (
                <details className="rounded-sm bg-[#F8F7F5] px-3 py-2.5">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold tracking-widest text-neutral-700 uppercase">
                    <CalendarDays className="size-3.5 shrink-0" />
                    Estrategia de carga día −1 · {result.carbLoading.minCarbsG}-
                    {result.carbLoading.maxCarbsG}g HC
                  </summary>
                  <div className="mt-2 flex flex-col gap-1.5 text-sm text-neutral-600">
                    {result.carbLoading.guidelines.map((guideline) => (
                      <p key={guideline}>• {guideline}</p>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

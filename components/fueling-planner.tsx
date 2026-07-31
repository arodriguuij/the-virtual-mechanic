"use client";

import {
  CalendarDays,
  ChevronDown,
  Copy,
  Droplet,
  FlaskConical,
  Fuel,
  Lock,
  MapPin,
  Pencil,
  RefreshCw,
  Send,
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
  formatRecipeForSharing,
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

function formatHoursMinutes(hours: number): string {
  const totalMinutes = Math.round(Math.max(0, hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")} h ${String(m).padStart(2, "0")} min`;
}

const POCKET_FOOD_TYPES: PocketFoodItemType[] = ["banana", "energy_bar", "rice_cake", "dates", "gummies"];
const GEL_DOSE_TYPES: PocketFoodItemType[] = ["gel_small", "gel_standard", "gel_high"];
const ALL_POCKET_FOOD_TYPES: PocketFoodItemType[] = [...POCKET_FOOD_TYPES, ...GEL_DOSE_TYPES];
const MAX_POCKET_FOOD_QTY = 6;
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
  };
  reloadStrategy: {
    startingBottleCount: number;
    ziplocBagsCount: number;
    ziplocDose: { maltodextrinG: number; fructoseG: number; sodiumMg: number };
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
};

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

// Title Case, short — fits a fixed 3-column row even on a narrow phone
// (unlike the earlier, longer "1 Agua + 1 Mix"/"Ambos con Mix" labels).
const BOTTLE_CONFIG_OPTIONS: { value: BottleConfigOption; label: string }[] = [
  { value: "water_only", label: "Solo Agua" },
  { value: "one_mix", label: "1 Mix" },
  { value: "both_mix", label: "Ambos Mix" },
];

/** How many grams of the ride's carb target the selected bottle
 * configuration itself contributes — the piece that makes the CUBIERTO/
 * RESTANTE pill reactive to the bottle selector, not just the pocket-food
 * steppers. "Solo Agua" contributes 0 (no mix at all); "1 Mix" contributes
 * one fuel bottle's own dose (whatever the recipe computed per bottle);
 * "Ambos Mix" contributes the full concentrated-bottle recipe total. A
 * preview built from figures the last calculation already returned, same
 * "lightweight planning preference" convention as the bottle selector
 * itself — it doesn't re-derive `getBottlePlan`'s own math. */
function getBottleCarbsContributionG(config: BottleConfigOption, result: PlanResult): number {
  const { fuelBottles } = result.bottlePlan;
  if (fuelBottles.count === 0) return 0;
  switch (config) {
    case "water_only":
      return 0;
    case "one_mix":
      return fuelBottles.maltodextrinGPerBottle + fuelBottles.fructoseGPerBottle;
    case "both_mix":
      return result.recipe.totalCarbsG;
    default:
      return 0;
  }
}

/** Tarjeta 05's "Checklist de preparación para llevar" — what to physically
 * grab before rolling out, split into "En bici" (bottles, driven by the
 * same `bottleConfig` preference the balance pill reacts to) and "En
 * bolsillo" (whatever pocket-food quantities are currently selected). Pure
 * functions so both the on-screen checklist and the shareable plain-text
 * export (`buildChecklistText`) read from one source instead of two copies
 * that could drift apart. */
function getBikeChecklistLines(result: PlanResult, bottleConfig: BottleConfigOption): string[] {
  const { fuelBottles, waterBottles } = result.bottlePlan;
  const lines: string[] = [];
  if (bottleConfig !== "water_only" && fuelBottles.count > 0) {
    const mixBottleCount = bottleConfig === "one_mix" ? 1 : fuelBottles.count;
    const saltG = getTableSaltGrams(fuelBottles.sodiumMgPerBottle);
    lines.push(
      `${mixBottleCount}x Bidón (${fuelBottles.maltodextrinGPerBottle}g Malto + ${fuelBottles.fructoseGPerBottle}g Fructosa + ${saltG}g Sal)`
    );
  }
  if (waterBottles.count > 0) {
    lines.push(`${waterBottles.count}x Bidón (Agua / Electrolitos)`);
  }
  return lines;
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

/** The "Pauta" line — hydration frequency plus the first solid-food and
 * caffeine milestones, when either exists — mirrors the on-screen
 * Cronograma without repeating its full entry list. */
function getPautaLine(result: PlanResult): string {
  const solidEntry = result.timingTimeline.entries.find((e) => e.type === "solid");
  const caffeineEntry = result.timingTimeline.entries.find((e) => e.type === "caffeine");
  const parts = [`1 trago c/${result.timingTimeline.hydrationIntervalMinutes} min`];
  if (solidEntry) parts.push(`${stripEmoji(solidEntry.label)} min ${solidEntry.atMinutes}`);
  if (caffeineEntry) parts.push(`Cafeína min ${caffeineEntry.atMinutes}`);
  return parts.join(" · ");
}

function buildChecklistText(
  result: PlanResult,
  bottleConfig: BottleConfigOption,
  pocketFood: Partial<Record<PocketFoodItemType, number>>,
  customCarbsG: number
): string {
  const bikeLines = getBikeChecklistLines(result, bottleConfig);
  const pocketLines = getPocketChecklistLines(pocketFood, customCarbsG);
  const sections: string[] = ["RATIO · Lista de Avituallamiento", ""];
  if (bikeLines.length > 0) {
    sections.push("En bici:", ...bikeLines.map((l) => `- ${l}`), "");
  }
  if (pocketLines.length > 0) {
    sections.push("En bolsillo:", ...pocketLines.map((l) => `- ${l}`), "");
  }
  sections.push(`Pauta: ${getPautaLine(result)}.`);
  sections.push("Calculado en ratiovelo.com");
  return sections.join("\n");
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
      <div className="grid grid-cols-3 gap-2">
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
        <input
          type="date"
          aria-label="Fecha de salida"
          min={todayIsoDate()}
          value={customDate}
          onChange={(e) => onCustomDateChange(e.target.value)}
          className={fieldClass}
        />
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

function PocketFoodStepperRow({
  type,
  qty,
  onChange,
  disabled = false,
}: {
  type: PocketFoodItemType;
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
        // the inventory now always shows all 9 rows unconditionally, so
        // trimming each row's own footprint matters more for minimizing
        // scroll on a small screen than it used to).
        "flex items-center justify-between gap-2 border-b border-zinc-100 py-2 last:border-b-0",
        disabled && "opacity-50"
      )}
    >
      <span className="text-sm text-neutral-900">
        {pocketFoodName(type)}
        <span className="ml-1.5 font-mono text-xs text-neutral-500">
          {POCKET_FOOD_CARBS_G[type]}g HC
        </span>
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
          aria-label={`Quitar ${pocketFoodLabels[type]}`}
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
          aria-label={`Añadir ${pocketFoodLabels[type]}`}
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
  const [pocketFood, setPocketFood] = useState<Partial<Record<PocketFoodItemType, number>>>({});
  const [customCarbsG, setCustomCarbsG] = useState(0);
  // "Mi Despensa" — starts as the full catalog (zero-onboarding: the
  // planner works fully from the first session with no setup) and is
  // overwritten from `localStorage` on mount if the athlete already
  // customized it on a previous visit (see the effect below).
  const [activePantryTypes, setActivePantryTypes] = useState<PocketFoodItemType[]>(ALL_POCKET_FOOD_TYPES);
  const [pantryModalOpen, setPantryModalOpen] = useState(false);
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
  const [result, setResult] = useState<PlanResult | null>(null);
  // Tracks whether the athlete has *ever* successfully calculated a
  // strategy in this session — drives the CTA's label ("Calcular..." the
  // first time, "Re-calcular..." every time after) independently of
  // whether a result is currently showing.
  const [hasCalculatedOnce, setHasCalculatedOnce] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [checklistCopied, setChecklistCopied] = useState(false);
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

  // "Conversión Dinámica a Medidas Caseras" — recomputed from the last
  // calculated result whenever it changes; cheap pure arithmetic, no memo
  // needed. Card 05's "Dosis ejecutiva" is scoped to the per-bottle figure
  // now (not the full recipe total), so only `fuelBottleMeasures`/
  // `ziplocMeasures` below are still read.
  const fuelBottleMeasures = result
    ? calculateHouseholdMeasures({
        saltG: getTableSaltGrams(result.bottlePlan.fuelBottles.sodiumMgPerBottle),
        maltodextrinG: result.bottlePlan.fuelBottles.maltodextrinGPerBottle,
        fructoseG: result.bottlePlan.fuelBottles.fructoseGPerBottle,
      })
    : null;
  const ziplocMeasures = result?.reloadStrategy
    ? calculateHouseholdMeasures({
        saltG: getTableSaltGrams(result.reloadStrategy.ziplocDose.sodiumMg),
        maltodextrinG: result.reloadStrategy.ziplocDose.maltodextrinG,
        fructoseG: result.reloadStrategy.ziplocDose.fructoseG,
      })
    : null;

  // Always the athlete's own manual selection now that "Estrategia
  // nutricional" no longer gates it behind a server-computed Óptimo mode —
  // feeds the live "Objetivo/Cubierto/Restante" balance pill in Card 04.
  const effectivePocketFood: PocketFoodSelection = { ...pocketFood, customCarbsG };
  const pocketFoodCarbsPreview = getPocketFoodTotalCarbsG(effectivePocketFood);
  // CUBIERTO is pocket food *plus* whatever the selected bottle
  // configuration itself contributes — this is the reactive fix: picking
  // "Solo Agua" vs. "1 Mix" vs. "Ambos Mix" now updates CUBIERTO/RESTANTE
  // instantly, the same as tapping a pocket-food stepper +/- already did,
  // with zero network round-trip either way.
  const bottleCarbsContributionG = result ? getBottleCarbsContributionG(bottleConfig, result) : 0;
  const coveredCarbsG = pocketFoodCarbsPreview + bottleCarbsContributionG;
  const remainingCarbsG = result ? Math.max(0, result.totalRideCarbsG - coveredCarbsG) : 0;

  // Tarjeta 05's "Checklist de preparación para llevar" — same source data
  // as the balance pill above, read fresh on every render so the on-screen
  // list and the "Copiar Lista"/"Enviar a WhatsApp" export never drift
  // apart from what's currently selected.
  const bikeChecklistLines = result ? getBikeChecklistLines(result, bottleConfig) : [];
  const pocketChecklistLines = getPocketChecklistLines(pocketFood, customCarbsG);

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
  // config back to "Solo Agua," every pocket-food quantity back to 0) —
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
    setPocketFood({});
    setCustomCarbsG(0);
  }, [
    mode,
    selectedRouteId,
    parsedGpx,
    quickDurationHours,
    gpxDurationHours,
    intensity,
    departureLocal,
    isTargetEvent,
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
      const pocketFoodPayload = { ...pocketFood, customCarbsG };
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
                intensity,
                isTargetEvent,
                pocketFood: pocketFoodPayload,
                fuelingMode,
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

  async function handleCopyRecipe() {
    if (!result) return;
    const text = formatRecipeForSharing({
      durationHours: result.durationHours,
      carbsGPerHour: result.carbsGPerHour,
      sodiumMgPerHour: result.sodiumMgPerHour,
      recipe: result.recipe,
      bottlePlan: result.bottlePlan,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("No se pudo copiar la receta al portapapeles.");
    }
  }

  async function handleCopyChecklist() {
    if (!result) return;
    const text = buildChecklistText(result, bottleConfig, pocketFood, customCarbsG);
    try {
      await navigator.clipboard.writeText(text);
      setChecklistCopied(true);
      setTimeout(() => setChecklistCopied(false), 2000);
    } catch {
      setError("No se pudo copiar la lista al portapapeles.");
    }
  }

  function handleSendWhatsApp() {
    if (!result) return;
    const text = buildChecklistText(result, bottleConfig, pocketFood, customCarbsG);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
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
            <div className="mt-2 grid grid-cols-2 gap-2">
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
                <span className={segmentedButtonLabelClass}>Ruta / GPX</span>
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
                  <div className="grid grid-cols-2 gap-3">
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

              {/* Cuadrícula 2x2 de objetivos por hora + total */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1 rounded-lg bg-[#F8F7F5] p-3">
                  <span className={eyebrow}>Duración</span>
                  <span className="font-mono text-lg font-bold text-neutral-900 tabular-nums sm:text-xl">
                    {result.durationHours}
                    <span className="ml-1 text-xs font-normal text-neutral-500">h</span>
                  </span>
                </div>
                <div className="relative flex flex-col gap-1 overflow-visible rounded-lg bg-[#F8F7F5] p-3">
                  <span className="flex items-center gap-1">
                    <span className={eyebrow}>Carbohidratos</span>
                    <FuelingContextTooltips carbsGPerHour={result.carbsGPerHour} />
                  </span>
                  <span className="font-mono text-lg font-bold text-neutral-900 tabular-nums sm:text-xl">
                    {result.carbsGPerHour}
                    <span className="ml-1 text-xs font-normal text-neutral-500">g/h</span>
                  </span>
                  <span className="font-mono text-[11px] text-neutral-500">
                    Total: {result.totalRideCarbsG} g
                  </span>
                </div>
                <div className="flex flex-col gap-1 rounded-lg bg-[#F8F7F5] p-3">
                  <span className={eyebrow}>Hidratación</span>
                  <span className="font-mono text-lg font-bold text-neutral-900 tabular-nums sm:text-xl">
                    {result.fluidLossMlPerHour}
                    <span className="ml-1 text-xs font-normal text-neutral-500">ml/h</span>
                  </span>
                  <span className="font-mono text-[11px] text-neutral-500">
                    Total: {(totalFluidMl / 1000).toFixed(1)} L
                  </span>
                </div>
                <div className="flex flex-col gap-1 rounded-lg bg-[#F8F7F5] p-3">
                  <span className={eyebrow}>Sodio</span>
                  <span className="font-mono text-lg font-bold text-neutral-900 tabular-nums sm:text-xl">
                    {result.sodiumMgPerHour}
                    <span className="ml-1 text-xs font-normal text-neutral-500">mg/h</span>
                  </span>
                  <span className="font-mono text-[11px] text-neutral-500">
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
                />
              </div>

              {result.gutTraining.isGutLimited && (
                <p className="mt-3 border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
                  Tu intestino está limitado a {result.gutTraining.gutCapGPerHour} g/h (esta ruta
                  pediría {result.gutTraining.uncappedGPerHour} g/h). Activa el protocolo de Gut
                  Training para subir de nivel gradualmente.
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
                  so it sticks close to the viewport's own top instead. */}
              <div className="sticky top-16 z-10 mb-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg bg-[#F8F7F5]/95 px-3 py-2 text-center font-mono text-[11px] font-semibold tracking-wide text-zinc-700 shadow-sm backdrop-blur-sm sm:text-xs lg:top-4">
                <span>OBJETIVO: {result.totalRideCarbsG}g HC</span>
                <span className="text-zinc-300">|</span>
                <span className="text-status-good">CUBIERTO: {coveredCarbsG}g HC</span>
                <span className="text-zinc-300">|</span>
                <span className={remainingCarbsG > 0 ? "text-status-warning" : "text-status-good"}>
                  RESTANTE: {remainingCarbsG}g HC
                </span>
              </div>

              <span className="mb-2 block font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                Configuración de bidones
              </span>
              {/* Fixed 3-column row at every width — short Title Case
                  labels ("Solo Agua"/"1 Mix"/"Ambos Mix") keep this
                  legible even on a narrow phone, so this never needs to
                  drop to a single stacked column the way the old, longer
                  labels did. */}
              <div className="grid grid-cols-3 gap-2">
                {BOTTLE_CONFIG_OPTIONS.map((opt) => (
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
                {activePantryTypes.length === 0 && (
                  <p className="mb-2 text-xs text-neutral-500">
                    Sin alimentos activos — actívalos en &quot;Editar mi despensa&quot; para verlos aquí.
                  </p>
                )}
                <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-x-4 md:gap-y-0">
                  {ALL_POCKET_FOOD_TYPES.filter((type) => activePantryTypes.includes(type)).map((type) => (
                    <PocketFoodStepperRow
                      key={type}
                      type={type}
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
            </div>

            <PantryEditorModal
              open={pantryModalOpen}
              onOpenChange={setPantryModalOpen}
              catalog={ALL_POCKET_FOOD_TYPES}
              activeTypes={activePantryTypes}
              onToggle={togglePantryItem}
              onSave={handleSavePantry}
            />

            {/* 🎴 Tarjeta 3 · 05 · Pauta de ingesta y receta ("Al Grano") —
                the dynamic ingestion timeline as the hero (top priority
                reading in ruta), a concise executive per-bottle dose, and a
                checklist of what to actually grab before rolling out.
                Descargar GPX / Exportar a Garmin and the GPS-alert
                explainer were removed outright (see the master spec) — the
                Checklist's own "Copiar Lista"/"Enviar a WhatsApp" buttons
                are this card's export mechanism now. The reload-strategy
                and carb-loading accordions (when applicable) stay, unlike
                the removed GPX/Garmin export — they're real, conditional
                *nutrition* content, not the navigation-file concern this
                pass explicitly cut. */}
            <div className="flex flex-col gap-3 rounded-xl border-0 bg-white p-4 shadow-none">
              <span className="font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                05 · Pauta de ingesta y receta
              </span>

              {/* Cronograma Dinámico de Ingesta — hero section, always
                  visible (not a collapsible accordion like every other
                  block below it) — this is the one thing an athlete needs
                  to read at a glance mid-ruta. */}
              <div className="rounded-sm bg-[#F8F7F5] p-3">
                <span className={eyebrow}>Cronograma dinámico de ingesta</span>
                <p className="mt-2 flex items-center gap-1.5 text-sm text-neutral-700">
                  <Droplet className="size-3.5 shrink-0 text-neutral-500" />
                  Bebe un trago cada{" "}
                  <span className="font-mono font-semibold text-neutral-900">
                    {result.timingTimeline.hydrationIntervalMinutes} min
                  </span>
                </p>
                {result.timingTimeline.entries.length > 0 && (
                  <ol className="mt-2 flex flex-col gap-1.5 text-sm text-neutral-700">
                    {result.timingTimeline.entries.map((entry, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        {entry.type === "solid" && (
                          <Utensils className="size-3.5 shrink-0 text-neutral-500" />
                        )}
                        {entry.type === "gel" && <Zap className="size-3.5 shrink-0 text-neutral-500" />}
                        {entry.type === "caffeine" && (
                          <FlaskConical className="size-3.5 shrink-0 text-neutral-500" />
                        )}
                        <span className="font-mono text-xs text-neutral-500">
                          {entry.atKm != null ? `Km ${entry.atKm}` : `Min ${entry.atMinutes}`}
                        </span>
                        {stripEmoji(entry.label)}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* Dosis Ejecutiva para Mezcla Casera — the concise per-bottle
                  number the athlete actually mixes at the kitchen counter,
                  sized to their real bottle capacity, plus "Copiar Receta"
                  and a collapsible scoop-equivalence breakdown for anyone
                  without a scale. */}
              <div className="rounded-sm bg-[#F8F7F5] p-3">
                <span className={eyebrow}>
                  Dosis ejecutiva para mezcla casera (por bidón {result.bottlePlan.bottleSizeMl}ml)
                </span>
                {result.bottlePlan.fuelBottles.count > 0 ? (
                  <p className="mt-1.5 font-mono text-sm font-semibold text-neutral-900">
                    {result.bottlePlan.fuelBottles.maltodextrinGPerBottle}g Malto +{" "}
                    {result.bottlePlan.fuelBottles.fructoseGPerBottle}g Fructosa +{" "}
                    {getTableSaltGrams(result.bottlePlan.fuelBottles.sodiumMgPerBottle)}g Sal / bidón (
                    {result.bottlePlan.bottleSizeMl}ml)
                  </p>
                ) : (
                  <p className="mt-1.5 text-sm text-neutral-600">
                    Cobertura completa vía comida de bolsillo — no necesitas mezcla en bidón.
                  </p>
                )}
                {result.bottlePlan.fuelBottles.concentrationPct > HYPERTONIC_THRESHOLD_PCT && (
                  <div className="mt-2 flex items-start gap-2 border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Solución hipertónica ({result.bottlePlan.fuelBottles.concentrationPct}% &gt;{" "}
                      {HYPERTONIC_THRESHOLD_PCT}%) — añade agua o traslada carga a comida de bolsillo.
                    </span>
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={handleCopyRecipe} className={cn(secondaryButtonClass, "w-fit")}>
                    {copied ? (
                      "✓ Receta copiada"
                    ) : (
                      <>
                        <Copy className="size-3.5" />
                        Copiar receta
                      </>
                    )}
                  </button>
                  {result.bottlePlan.fuelBottles.count > 0 && (
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-center gap-1 font-mono text-xs font-medium text-zinc-600 transition-colors duration-150 hover:text-zinc-900 [&::-webkit-details-marker]:hidden">
                        <ChevronDown className="size-3.5 shrink-0 transition-transform duration-150 group-open:rotate-180" />
                        Ver equivalencias en cazos
                      </summary>
                      <div className="mt-2 flex flex-col gap-1 border-t border-zinc-200 pt-2 text-xs text-neutral-600">
                        <p>
                          Maltodextrina: {result.bottlePlan.fuelBottles.maltodextrinGPerBottle}g (~
                          {fuelBottleMeasures!.maltodextrinScoops} cazos)
                        </p>
                        <p>
                          Fructosa: {result.bottlePlan.fuelBottles.fructoseGPerBottle}g (~
                          {fuelBottleMeasures!.fructoseScoops} cazos)
                        </p>
                        <p>
                          Sal común: {getTableSaltGrams(result.bottlePlan.fuelBottles.sodiumMgPerBottle)}g (~
                          {fuelBottleMeasures!.saltTeaspoons} cdta.)
                        </p>
                        <p className="text-[10px] text-neutral-400">
                          *Equivalencias de referencia: 1 cazo = 30 g de polvo | 1 cdta. de café = 5 g de
                          sal.
                        </p>
                      </div>
                    </details>
                  )}
                </div>
              </div>

              {result.reloadStrategy && (
                <details className="group rounded-sm border border-status-warning/40 bg-status-warning/10">
                  <summary className="flex list-none cursor-pointer items-center justify-between gap-2 p-3 [&::-webkit-details-marker]:hidden">
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-status-warning uppercase">
                        <Fuel className="size-3.5 shrink-0" />
                        Estrategia de recarga en ruta
                      </span>
                      <span className="text-sm font-semibold text-neutral-900">
                        {result.reloadStrategy.startingBottleCount} bidón
                        {result.reloadStrategy.startingBottleCount > 1 ? "es" : ""} en bici +{" "}
                        {result.reloadStrategy.ziplocBagsCount} dosis de recarga en maillot
                      </span>
                    </span>
                    <ChevronDown className="size-4 shrink-0 text-status-warning transition-transform duration-150 group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-status-warning/30 p-3 pt-2">
                    <ol className="flex flex-col gap-1 text-sm text-neutral-700">
                      <li>
                        1. Inicio de ruta: {result.reloadStrategy.startingBottleCount} bidón
                        {result.reloadStrategy.startingBottleCount > 1 ? "es" : ""} preparado
                        {result.reloadStrategy.startingBottleCount > 1 ? "s" : ""} en el cuadro.
                      </li>
                      <li>
                        2. En el maillot: lleva {result.reloadStrategy.ziplocBagsCount} bolsita
                        {result.reloadStrategy.ziplocBagsCount > 1 ? "s" : ""} Ziploc con{" "}
                        {result.reloadStrategy.ziplocDose.maltodextrinG}g malto (~
                        {ziplocMeasures!.maltodextrinScoops} cazos) +{" "}
                        {result.reloadStrategy.ziplocDose.fructoseG}g fructosa (~
                        {ziplocMeasures!.fructoseScoops} cazos) +{" "}
                        {getTableSaltGrams(result.reloadStrategy.ziplocDose.sodiumMg)}g sal común (~
                        {ziplocMeasures!.saltTeaspoons} cdta.) (dosis pre-medida por bidón).
                      </li>
                      <li className="flex items-center gap-1.5 font-medium text-neutral-900">
                        <MapPin className="size-3.5 shrink-0" />
                        Parada de recarga recomendada:{" "}
                        {result.reloadStrategy.reloadAtKm != null
                          ? `Km ${result.reloadStrategy.reloadAtKm}`
                          : `Hora ${result.reloadStrategy.reloadAtHours}`}
                      </li>
                    </ol>
                    {result.reloadStrategy.isImpractical && (
                      <p className="mt-2 flex items-start gap-1.5 border-t border-status-warning/30 pt-2 text-xs text-status-warning">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                        {result.reloadStrategy.ziplocBagsCount} recargas en ruta no es un plan
                        realista — con tus bidones de {result.bottlePlan.bottleSizeMl}ml, esta
                        estrategia necesita más carbohidratos disueltos de los que puedes llevar
                        cómodamente. Prueba con bidones de mayor capacidad o traslada más carga a
                        comida sólida/geles (modo Híbrido u Óptimo).
                      </p>
                    )}
                  </div>
                </details>
              )}

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

              {/* Checklist de Preparación para Llevar — the "what to
                  physically grab" summary, driven by the same bottle
                  config + pocket-food state as the balance pill above, so
                  it's never out of sync with what CUBIERTO/RESTANTE is
                  currently showing. */}
              <div className="rounded-sm bg-[#F8F7F5] p-3">
                <span className={eyebrow}>Checklist de preparación para llevar</span>
                {bikeChecklistLines.length === 0 && pocketChecklistLines.length === 0 ? (
                  <p className="mt-2 text-sm text-neutral-500">
                    Sin bidones ni comida de bolsillo seleccionados todavía.
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-neutral-700">
                    {bikeChecklistLines.map((line) => (
                      <li key={line}>• {line}</li>
                    ))}
                    {pocketChecklistLines.map((line) => (
                      <li key={line}>• {line}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleCopyChecklist}
                    className={cn(secondaryButtonClass, "w-fit")}
                  >
                    {checklistCopied ? (
                      "✓ Lista copiada"
                    ) : (
                      <>
                        <Copy className="size-3.5" />
                        Copiar lista
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleSendWhatsApp}
                    className={cn(secondaryButtonClass, "w-fit")}
                  >
                    <Send className="size-3.5" />
                    Enviar a WhatsApp
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

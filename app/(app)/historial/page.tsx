import { ExternalLink } from "lucide-react";
import { Suspense } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getNutritionDiary, type NutritionDiaryEntry } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const cardNumberHeading = "font-mono text-xs font-bold tracking-widest text-neutral-500 uppercase";
const statLabel = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
const statValue = "font-mono text-xl font-bold text-neutral-900 tabular-nums";

function formatRelativeDate(iso: string) {
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function formatCarbsTotal(totalG: number): string {
  if (totalG >= 1000) return `${(totalG / 1000).toFixed(1)} kg`;
  return `${totalG} g`;
}

/** Color-coded, no emoji — this app's UI chrome stays deliberately
 * monochrome outside its own accent tokens (see CLAUDE.md's "no emoji"
 * convention for selection cards), so the 🟢/🟡/🔴 shorthand becomes a
 * bordered pill in the matching status color instead. */
function complianceBadgeClass(pct: number | null): string {
  if (pct == null) return "border-neutral-200 bg-neutral-100 text-neutral-500";
  if (pct >= 90) return "border-emerald-200/60 bg-emerald-50 text-emerald-700";
  if (pct >= 60) return "border-amber-200/60 bg-amber-50 text-amber-700";
  return "border-red-200/60 bg-red-50 text-red-700";
}

function complianceBadgeLabel(pct: number | null): string {
  if (pct == null) return "Sin datos";
  if (pct >= 90) return `${pct}% cumplido`;
  if (pct >= 60) return "Sub-nutrido";
  return "Déficit crítico";
}

// "01 · Resumen Nutricional" — all-time KPIs across every logged ride with
// real consumption data (see `getNutritionDiary` in `lib/dashboard-data.ts`
// for why these are computed independently of the displayed ride list's
// own limit).
async function NutritionSummaryCard() {
  const { summary } = await getNutritionDiary(20);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <span className={cardNumberHeading}>01 · Resumen nutricional</span>

        {summary.avgCompliancePct == null && summary.gutTrainingTier == null ? (
          <p className="text-sm text-neutral-500">
            Aún no hay salidas con consumo real registrado — usa &quot;Guardar consumo
            real&quot; en el análisis post-ruta para empezar a ver tu diario aquí.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <span className={statLabel}>Cumplimiento medio</span>
              <span className={statValue}>
                {summary.avgCompliancePct != null ? (
                  <>
                    {summary.avgCompliancePct}
                    <span className="ml-0.5 text-sm font-normal text-neutral-500">%</span>
                  </>
                ) : (
                  "—"
                )}
              </span>
              {summary.avgCompliancePct == null && (
                <span className="text-xs text-neutral-500">Sin datos de consumo aún</span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className={statLabel}>HC procesados</span>
              <span className={statValue}>{formatCarbsTotal(summary.totalCarbsConsumedG)}</span>
              <span className="text-xs text-neutral-500">Total consumido en rutas registradas</span>
            </div>

            <div className="flex flex-col gap-1">
              <span className={statLabel}>Gut training</span>
              {summary.gutTrainingTier ? (
                <>
                  <span className={statValue}>Nivel {summary.gutTrainingTier.level}</span>
                  <span className="text-xs text-neutral-500 uppercase">
                    {summary.gutTrainingTier.rangeLabel}
                  </span>
                </>
              ) : (
                <>
                  <span className={statValue}>—</span>
                  <span className="text-xs text-neutral-500">Sin datos suficientes</span>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NutritionSummarySkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-3 w-40" />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function NutritionRideCard({ entry }: { entry: NutritionDiaryEntry }) {
  return (
    <div className="flex flex-col gap-3 border border-neutral-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-neutral-900">{entry.activityName}</span>
          <span className="text-xs text-neutral-500">
            {formatRelativeDate(entry.activityDate)} · {entry.distanceKm} km
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider uppercase",
              complianceBadgeClass(entry.compliancePct)
            )}
          >
            {complianceBadgeLabel(entry.compliancePct)}
          </span>
          <a
            href={`https://www.strava.com/activities/${entry.activityId}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Ver actividad en Strava"
            className="flex cursor-pointer items-center text-neutral-400 transition-colors duration-150 hover:text-neutral-900"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>

      {entry.hasConsumptionData ? (
        <div className="grid grid-cols-3 gap-2 border-t border-neutral-100 pt-3 sm:gap-4">
          <div className="flex flex-col gap-0.5">
            <span className={statLabel}>Ingesta</span>
            <span className="font-mono text-sm font-semibold text-neutral-900 tabular-nums">
              {entry.intakeGPerHour ?? "--"}
              <span className="ml-1 text-xs font-normal text-neutral-500">g/h</span>
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className={statLabel}>Hidratación</span>
            <span className="font-mono text-sm font-semibold text-neutral-900 tabular-nums">
              {entry.fluidConsumedL ?? "--"}
              <span className="ml-1 text-xs font-normal text-neutral-500">L</span>
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className={statLabel}>Sodio</span>
            <span className="font-mono text-sm font-semibold text-neutral-900 tabular-nums">
              {entry.sodiumConsumedMg ?? "--"}
              <span className="ml-1 text-xs font-normal text-neutral-500">mg</span>
            </span>
          </div>
        </div>
      ) : (
        <p className="border-t border-neutral-100 pt-3 text-xs text-neutral-500">
          Sin datos de consumo — analiza esta ruta en &quot;Al llegar&quot; para completar
          su diario nutricional.
        </p>
      )}
    </div>
  );
}

// "02 · Diario de Rutas" — the nutrition-focused ride list replacing the old
// plain Strava lookbook (name/distance/weather only, no nutrition angle at
// all).
async function NutritionDiarySection() {
  const { entries } = await getNutritionDiary(20);

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent>
          <span className={cardNumberHeading}>02 · Diario de rutas</span>
          <p className="mt-2 text-sm text-neutral-500">
            Diario metabólico preparado. Tus salidas sincronizadas desde Strava aparecerán aquí.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <span className={cardNumberHeading}>02 · Diario de rutas</span>
        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <NutritionRideCard key={entry.activityId} entry={entry} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function NutritionDiarySkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-3 w-32" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3 border border-neutral-200 p-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-5 w-24" />
              </div>
              <Skeleton className="h-4 w-full max-w-xs" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function HistorialPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="border-b border-neutral-200 pb-6">
        <h1 className="text-xl font-bold font-mono text-neutral-900 tracking-tight sm:text-2xl">
          Historial
        </h1>
        <p className="text-xs font-mono text-neutral-500 mt-1 leading-relaxed">
          Diario de rendimiento nutricional y adaptación digestiva
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <Suspense fallback={<NutritionSummarySkeleton />}>
          <NutritionSummaryCard />
        </Suspense>
        <Suspense fallback={<NutritionDiarySkeleton />}>
          <NutritionDiarySection />
        </Suspense>
      </div>
    </div>
  );
}

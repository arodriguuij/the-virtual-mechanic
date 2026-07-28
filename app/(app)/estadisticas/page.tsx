import { Suspense } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getRecentIntakeBreakdown,
  getWeeklyPerformance,
  gutTrainingTierFromIntake,
} from "@/lib/dashboard-data";
import { getIntakeRecommendationNote } from "@/lib/metabolic-engine";

export const dynamic = "force-dynamic";

const cardNumberHeading = "font-mono text-xs font-bold tracking-widest text-neutral-500 uppercase";
const statLabel = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
const weeklyStatValue = "font-mono text-xl font-bold text-neutral-900 tabular-nums";

function hydrationLabel(score: number): string {
  if (score >= 9) return "Óptimo";
  if (score >= 7) return "Bueno";
  if (score >= 5) return "Mejorable";
  return "Bajo";
}

// "01 · Resumen 7 Días" — moved here verbatim from the Dashboard's old
// "Rendimiento Semanal" panel (see CLAUDE.md's own note on why this lives on
// its own route now: a forever-scrolling Dashboard was competing daily-action
// space against a once-a-week glance-back).
async function SummaryCard() {
  const weekly = await getWeeklyPerformance();
  // Same real-intake-derived tier `/historial` shows (`gutTrainingTierFromIntake`
  // in `lib/dashboard-data.ts`) — not the self-reported `athlete_profiles.
  // gut_training_level` this card used to display, so the two screens can
  // never disagree about what "Nivel X" means for the same athlete.
  const gutTier = gutTrainingTierFromIntake(weekly.avgIntakeGPerHour);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <span className={cardNumberHeading}>01 · Resumen 7 días</span>

        {weekly.ridesThisWeekCount === 0 ? (
          <p className="text-sm text-neutral-500">
            0 km registrados esta semana — sincroniza tu primera salida para ver tu progreso aquí.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {weekly.compliancePct == null && weekly.avgIntakeGPerHour == null ? (
              <div className="col-span-2 flex items-center border border-dashed border-neutral-300 bg-white/60 px-3 py-2.5">
                <p className="text-sm text-neutral-500">
                  Calcula tu primera estrategia de nutrición para empezar a registrar tu balance
                  semanal.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <span className={statLabel}>Cumplimiento 7D</span>
                  <span className={weeklyStatValue}>
                    {weekly.compliancePct != null ? (
                      <>
                        {weekly.compliancePct}
                        <span className="ml-0.5 text-sm font-normal text-neutral-500">%</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                  {weekly.compliancePct == null && (
                    <span className="text-xs text-neutral-500">Sin datos de consumo aún</span>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <span className={statLabel}>Promedio ingesta</span>
                  <span className={weeklyStatValue}>
                    {weekly.avgIntakeGPerHour != null ? (
                      <>
                        {weekly.avgIntakeGPerHour}
                        <span className="ml-1 text-sm font-normal text-neutral-500">g/h</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                  {weekly.avgIntakeGPerHour == null && (
                    <span className="text-xs text-neutral-500">Sin datos de consumo aún</span>
                  )}
                </div>
              </>
            )}

            <div className="flex flex-col gap-1">
              <span className={statLabel}>Capacidad digestiva</span>
              {gutTier ? (
                <>
                  <span className={weeklyStatValue}>Nivel {gutTier.level}</span>
                  <span className="text-xs text-neutral-500 uppercase">{gutTier.rangeLabel}</span>
                </>
              ) : (
                <>
                  <span className={weeklyStatValue}>—</span>
                  <span className="text-xs text-neutral-500">Sin datos suficientes</span>
                </>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className={statLabel}>Balance hídrico</span>
              <span className={weeklyStatValue}>
                {weekly.hydrationScore != null ? (
                  <>
                    {weekly.hydrationScore.toFixed(1)}
                    <span className="ml-0.5 text-sm font-normal text-neutral-500">/10</span>
                  </>
                ) : (
                  "—"
                )}
              </span>
              {weekly.hydrationScore != null ? (
                <span className="text-xs text-neutral-500 uppercase">
                  {hydrationLabel(weekly.hydrationScore)}
                </span>
              ) : (
                <span className="text-xs text-neutral-500">Sin datos de consumo aún</span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryCardSkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-3 w-32" />
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
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

// "02 · Desglose de Ingesta" — real consumed-vs-target carbs per ride, for
// the most recent rides that actually have consumption data logged
// (`getRecentIntakeBreakdown` in `lib/dashboard-data.ts`). A simple two-tone
// progress rail per ride, same visual language as the Fueling Planner's own
// objetivo/en bolsillo/déficit bar.
async function IntakeBreakdownCard() {
  const entries = await getRecentIntakeBreakdown(6);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <span className={cardNumberHeading}>02 · Desglose de ingesta</span>

        {entries.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Aún no hay salidas con consumo real registrado — usa &quot;Guardar consumo real&quot;
            en el análisis post-ruta para empezar a ver tu desglose aquí.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {entries.map((entry) => {
              const pct =
                entry.targetCarbsG > 0
                  ? Math.min(100, Math.round((entry.consumedCarbsG / entry.targetCarbsG) * 100))
                  : 0;
              return (
                <li key={entry.activityId} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-neutral-900">
                      {entry.activityName}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-neutral-500">
                      {entry.consumedCarbsG}g / {entry.targetCarbsG}g HC
                    </span>
                  </div>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-badge">
                    <div
                      className="bg-sage transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function IntakeBreakdownCardSkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-3 w-40" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-full max-w-xs" />
            <Skeleton className="h-2 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// "03 · Recomendación Biológica" — a plain-language nudge comparing real
// logged intake against the athlete's own gut-training cap (see
// `getIntakeRecommendationNote` in `lib/metabolic-engine.ts`).
async function RecommendationCard() {
  const weekly = await getWeeklyPerformance();
  const note = getIntakeRecommendationNote(weekly.avgIntakeGPerHour, weekly.gutTrainingLevel);

  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <span className={cardNumberHeading}>03 · Recomendación biológica</span>
        <p className="text-sm text-neutral-700">{note}</p>
      </CardContent>
    </Card>
  );
}

function RecommendationCardSkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}

export default function EstadisticasPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="border-b border-neutral-200 pb-6">
        <h1 className="text-xl font-bold font-mono text-neutral-900 uppercase tracking-tight sm:text-2xl">
          Análisis &amp; cumplimiento
        </h1>
        <p className="text-xs font-mono text-neutral-500 mt-1 leading-relaxed">
          Rendimiento semanal, cumplimiento real y recomendaciones a partir de tus datos
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <Suspense fallback={<SummaryCardSkeleton />}>
          <SummaryCard />
        </Suspense>
        <Suspense fallback={<IntakeBreakdownCardSkeleton />}>
          <IntakeBreakdownCard />
        </Suspense>
        <Suspense fallback={<RecommendationCardSkeleton />}>
          <RecommendationCard />
        </Suspense>
      </div>
    </div>
  );
}

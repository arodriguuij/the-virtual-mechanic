"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RadioCard } from "@/components/radio-card";
import { fieldClass, primaryButtonClass } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";

// Vía A · a real 20-minute effort (or a Strava-estimated one on a climb) is
// the standard proxy for FTP — 95% of a genuine 20-min max power.
const TWENTY_MIN_TO_FTP_FACTOR = 0.95;

type WkgAnchor = "occasional" | "regular" | "demanding" | "competitive";

// Vía B · self-reported riding profile → a plausible W/kg anchor, for an
// athlete with no power data or Strava history at all. Illustrative
// coefficients, same "heuristic, not clinical" convention as the rest of
// this app's metabolic engine — not a substitute for a real test once one
// is available.
const WKG_ANCHORS: {
  value: WkgAnchor;
  label: string;
  coefficient: number;
  description: string;
}[] = [
  {
    value: "occasional",
    label: "Ocasional / Recreativo (~2.2 W/kg)",
    coefficient: 2.2,
    description: "Salgo 1-2 días por semana. En llano voy cómodo a 20-23 km/h.",
  },
  {
    value: "regular",
    label: "Habitual / Grupeta Popular (~2.8 W/kg)",
    coefficient: 2.8,
    description:
      "Salgo 2-3 días por semana. Rodo a 25-28 km/h en llano y subo puertos a ritmo sostenido.",
  },
  {
    value: "demanding",
    label: "Exigente / Ritmo Alto (~3.4 W/kg)",
    coefficient: 3.4,
    description: "Entreno con frecuencia. En llano rodamos a +30 km/h y aprieto fuerte en las subidas.",
  },
  {
    value: "competitive",
    label: "Competitivo / Avanzado (~4.0 W/kg)",
    coefficient: 4.0,
    description:
      "Entreno estructurado / Competición. Relevos a fuego en grupeta y ritmo muy alto en puertos.",
  },
];

/**
 * "¿No sabes tu FTP? Estimar." — a modal offering two independent
 * estimation paths so an athlete with no power meter (or who simply
 * doesn't know their number offhand) can still fill in a real starting
 * FTP rather than leaving it blank or guessing. Vía A (a real 20-min
 * power figure) takes priority over Vía B (a self-reported riding
 * profile) whenever both are present, since real power data is a more
 * precise anchor than a category guess.
 */
export function FtpEstimatorModal({
  weightKg,
  onApply,
}: {
  weightKg: number | null;
  onApply: (ftp: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [twentyMinInput, setTwentyMinInput] = useState("");
  const [anchor, setAnchor] = useState<WkgAnchor | null>(null);

  const twentyMinWatts = Number(twentyMinInput);
  const viaAEstimate =
    twentyMinInput && twentyMinWatts > 0 ? Math.round(twentyMinWatts * TWENTY_MIN_TO_FTP_FACTOR) : null;

  const anchorOption = anchor ? (WKG_ANCHORS.find((a) => a.value === anchor) ?? null) : null;
  const viaBEstimate =
    anchorOption && weightKg && weightKg > 0 ? Math.round(weightKg * anchorOption.coefficient) : null;

  const estimatedFtp = viaAEstimate ?? viaBEstimate;

  function reset() {
    setTwentyMinInput("");
    setAnchor(null);
  }

  function handleApply() {
    if (!estimatedFtp) return;
    onApply(estimatedFtp);
    setOpen(false);
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger className="cursor-pointer font-mono text-[11px] font-semibold text-terracotta underline underline-offset-2 hover:text-terracotta-hover">
        ¿No sabes tu FTP? Estimar.
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] w-full max-w-md overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm font-bold tracking-wide text-zinc-900 uppercase">
            Estimar mi FTP
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5 text-sm">
          <section className="flex flex-col gap-2">
            <span className="font-mono text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
              Vía A · Si tienes datos de potencia o Strava
            </span>
            <p className="text-xs text-neutral-600">
              Si conoces tu FTP o lo has consultado en{" "}
              <a
                href="https://www.strava.com/athlete/analysis"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                Strava Athlete Analysis
              </a>
              , introduce tus vatios en 20 minutos (o los vatios estimados de Strava en un
              puerto).
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                placeholder="ej. 250"
                aria-label="Vatios en 20 minutos"
                value={twentyMinInput}
                onChange={(e) => {
                  setTwentyMinInput(e.target.value);
                  if (e.target.value) setAnchor(null);
                }}
                className={cn(fieldClass, "w-28")}
              />
              <span className="font-mono text-xs text-neutral-500">W (20 min)</span>
            </div>
            {viaAEstimate && (
              <p className="font-mono text-xs text-neutral-700">
                FTP estimado (95%): <span className="font-bold text-zinc-900">{viaAEstimate} W</span>
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2 border-t border-zinc-100 pt-4">
            <span className="font-mono text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
              Vía B · Estimación rápida por anclajes reales de ruta (sin datos)
            </span>
            <p className="text-xs text-neutral-600">
              Selecciona la opción que mejor describe tus salidas habituales:
            </p>
            {!weightKg && (
              <p className="text-xs text-status-warning">
                Introduce tu peso en el campo &quot;Peso (kg)&quot; para poder usar esta vía.
              </p>
            )}
            <div className="flex flex-col gap-2">
              {WKG_ANCHORS.map((opt) => (
                <RadioCard
                  key={opt.value}
                  name="ftp-anchor"
                  value={opt.value}
                  checked={anchor === opt.value}
                  title={opt.label}
                  onChange={() => {
                    setAnchor(opt.value);
                    setTwentyMinInput("");
                  }}
                >
                  {opt.description}
                </RadioCard>
              ))}
            </div>
          </section>

          <div className="border-t border-zinc-100 pt-4">
            <p className="font-mono text-sm text-neutral-700">
              Tu FTP estimado es de:{" "}
              <span className="font-bold text-zinc-900">{estimatedFtp ? `${estimatedFtp} W` : "—"}</span>
            </p>
            <button
              type="button"
              onClick={handleApply}
              disabled={!estimatedFtp}
              className={cn(
                primaryButtonClass,
                "mt-3 w-full",
                !estimatedFtp && "cursor-not-allowed opacity-40"
              )}
            >
              Usar este FTP
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

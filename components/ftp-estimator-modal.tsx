"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
// is available. Labels/descriptions condensed to one short line each
// ("Rediseño Ultra-Compacto") so all 4 options plus Vía A and the apply
// button fit on one mobile screen with no vertical scroll.
const WKG_ANCHORS: {
  value: WkgAnchor;
  label: string;
  coefficient: number;
  description: string;
}[] = [
  {
    value: "occasional",
    label: "Ocasional (~2.2 W/kg)",
    coefficient: 2.2,
    description: "1-2 días/semana · 20-23 km/h en llano",
  },
  {
    value: "regular",
    label: "Habitual (~2.8 W/kg)",
    coefficient: 2.8,
    description: "2-3 días/semana · 25-28 km/h y ritmo sostenido",
  },
  {
    value: "demanding",
    label: "Exigente (~3.4 W/kg)",
    coefficient: 3.4,
    description: "Entreno frecuente · +30 km/h y aprieto en puertos",
  },
  {
    value: "competitive",
    label: "Competitivo (~4.0 W/kg)",
    coefficient: 4.0,
    description: "Competición · Relevos a fuego y ritmo muy alto",
  },
];

/**
 * "Estimar" — a compact modal offering two independent FTP-estimation
 * paths so an athlete with no power meter (or who simply doesn't know
 * their number offhand) can still fill in a real starting FTP rather than
 * leaving it blank or guessing. Vía A (a real 20-min power figure) takes
 * priority over Vía B (a self-reported riding profile) whenever both are
 * present, since real power data is a more precise anchor than a category
 * guess.
 *
 * Ultra-compact by design — one-line rows, condensed copy, no long
 * paragraphs — so the whole thing (Vía A, all 4 Vía B options, and the
 * apply button) fits on one mobile screen with zero vertical scroll,
 * inside `DialogContent`'s own `max-h-[85vh] overflow-y-auto` as a
 * backstop rather than the expected path. `sm:max-w-md` is the *only*
 * width override passed to `DialogContent` — deliberately not a bare
 * `max-w-md`/`w-full`, both of which would win over the shared Dialog
 * primitive's own mobile-safe `max-w-[calc(100%-2rem)]` in `cn()`'s
 * tailwind-merge (later utility wins on the same property) and reopen the
 * exact "modal touches the screen edges" bug this pass fixes — the base
 * component already guarantees a ~1rem side margin on every viewport
 * without this component needing to redeclare it.
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
      <DialogTrigger className="cursor-pointer font-mono text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-900">
        Estimar
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-xl p-4 sm:max-w-md sm:p-5">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm font-bold tracking-wide text-zinc-900 uppercase">
            Estimar mi FTP
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <section className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
              Vía A · Test 20 min / Strava
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-neutral-600">Vatios 20m:</span>
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
                className={cn(fieldClass, "w-20 px-2 py-1.5 text-sm")}
              />
              <span className="text-xs text-neutral-500">W</span>
              {viaAEstimate && (
                <span className="font-mono text-xs text-neutral-700">
                  → 95%: <span className="font-bold text-zinc-900">{viaAEstimate} W</span>
                </span>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-1.5 border-t border-zinc-100 pt-3">
            <span className="font-mono text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
              Vía B · Anclajes reales de ruta
            </span>
            {!weightKg && (
              <p className="text-[11px] text-status-warning">
                Introduce tu peso para poder usar esta vía.
              </p>
            )}
            <div className="flex flex-col">
              {WKG_ANCHORS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-start gap-2 rounded-sm px-1 py-1 transition-colors duration-150 hover:bg-[#F8F7F5]"
                >
                  <input
                    type="radio"
                    name="ftp-anchor"
                    checked={anchor === opt.value}
                    onChange={() => {
                      setAnchor(opt.value);
                      setTwentyMinInput("");
                    }}
                    className="mt-0.5 size-3.5 shrink-0 cursor-pointer accent-terracotta"
                  />
                  <span className="text-xs leading-snug text-neutral-700">
                    <span className="font-semibold text-zinc-900">{opt.label}</span>{" "}
                    <span className="text-neutral-500">· {opt.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <div className="border-t border-zinc-100 pt-3">
            <p className="font-mono text-sm text-neutral-700">
              Tu FTP estimado:{" "}
              <span className="font-bold text-zinc-900">{estimatedFtp ? `${estimatedFtp} W` : "—"}</span>
            </p>
            <button
              type="button"
              onClick={handleApply}
              disabled={!estimatedFtp}
              className={cn(
                primaryButtonClass,
                "mt-2 w-full",
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

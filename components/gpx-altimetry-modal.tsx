"use client";

import { useState } from "react";
import { Maximize2, X, Utensils, Zap, Droplets, ShoppingBag } from "lucide-react";
import { ElevationSparkline } from "@/components/elevation-sparkline";

export type TacticalPoint = {
  key: string;
  distanceFraction: number; // 0 to 1
  km: number;
  elevationM?: number;
  type: "gel" | "solid" | "stop" | "water";
  title: string;
};

export function GpxAltimetryPreview({
  points,
  totalDistanceKm,
  tacticalPoints = [],
}: {
  points: { distanceFraction: number; elevationM: number }[] | null;
  totalDistanceKm: number | null;
  tacticalPoints?: TacticalPoint[];
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (!points || points.length < 2) return null;

  return (
    <>
      <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-neutral-50/80 p-3.5 font-mono text-xs shadow-xs">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-neutral-900">
            Perfil Altimétrico Táctico
          </span>
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-neutral-800 transition-colors hover:bg-neutral-100 cursor-pointer"
          >
            <Maximize2 className="size-3 text-neutral-600" />
            <span> Expandir Altimetría </span>
          </button>
        </div>

        <div className="relative overflow-hidden rounded border border-neutral-200 bg-white p-2">
          <ElevationSparkline points={points} heightPx={50} />
        </div>
      </div>

      {isOpen && (
        <GpxAltimetryModal
          points={points}
          totalDistanceKm={totalDistanceKm}
          tacticalPoints={tacticalPoints}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
}

export function GpxAltimetryModal({
  points,
  totalDistanceKm,
  tacticalPoints,
  onClose,
}: {
  points: { distanceFraction: number; elevationM: number }[];
  totalDistanceKm: number | null;
  tacticalPoints: TacticalPoint[];
  onClose: () => void;
}) {
  const elevations = points.map((p) => p.elevationM);
  const minEle = Math.min(...elevations);
  const maxEle = Math.max(...elevations);
  const eleRange = maxEle - minEle || 1;
  const distKm = totalDistanceKm || 100;

  // Y-axis ticks (4 graduations)
  const yTicks = [
    Math.round(maxEle),
    Math.round(minEle + eleRange * 0.66),
    Math.round(minEle + eleRange * 0.33),
    Math.round(minEle),
  ];

  // X-axis ticks (5 graduations)
  const xTicks = [
    0,
    Math.round(distKm * 0.25),
    Math.round(distKm * 0.5),
    Math.round(distKm * 0.75),
    Math.round(distKm),
  ];

  const toX = (fraction: number) => Math.max(0, Math.min(100, fraction * 100));
  const toY = (elevationM: number) => 100 - ((elevationM - minEle) / eleRange) * 100;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.distanceFraction).toFixed(2)},${toY(p.elevationM).toFixed(2)}`)
    .join(" ");

  const areaPath = `${linePath} L100,100 L0,100 Z`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-6 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="flex h-[92vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-2xl overflow-hidden font-mono border border-neutral-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 bg-neutral-50">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-neutral-900">
              Perfil Altimétrico Táctico & Mapeo de Nutrición
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 transition-colors cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Modal Main Scrollable Chart Area */}
        <div className="flex-1 overflow-x-auto overflow-y-auto p-4 sm:p-6 bg-[#fcfbf9]">
          <div className="min-w-[750px] flex flex-col gap-4">
            {/* Legend Header */}
            <div className="flex items-center gap-4 text-[11px] text-neutral-600 border-b border-neutral-200 pb-2">
              <span className="font-semibold text-neutral-900 uppercase">Leyenda Táctica:</span>
              <span className="flex items-center gap-1">
                <Zap className="size-3.5 text-amber-600" /> Pre-Puerto (Geles 10-15m)
              </span>
              <span className="flex items-center gap-1">
                <Utensils className="size-3.5 text-neutral-700" /> Llano (Sólidos)
              </span>
              <span className="flex items-center gap-1">
                <Droplets className="size-3.5 text-blue-600" /> Relleno Hídrico
              </span>
            </div>

            {/* Chart with Y and X Axis */}
            <div className="grid grid-cols-[60px_1fr] gap-2 items-stretch h-[380px] pt-4">
              {/* Y Axis (Meters) */}
              <div className="flex flex-col justify-between text-right text-[10px] font-bold text-neutral-500 pr-2 border-r border-neutral-300">
                {yTicks.map((y, idx) => (
                  <span key={idx}>{y}m</span>
                ))}
              </div>

              {/* Chart Canvas Area */}
              <div className="relative w-full h-full border-b border-neutral-300">
                {/* Horizontal Grid lines */}
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-20">
                  <div className="border-b border-neutral-400 w-full" />
                  <div className="border-b border-neutral-400 w-full" />
                  <div className="border-b border-neutral-400 w-full" />
                  <div className="border-b border-neutral-400 w-full" />
                </div>

                {/* SVG Profile */}
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full overflow-visible"
                >
                  <defs>
                    <linearGradient id="modal-elevation-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#70685b" stopOpacity="0.2" />
                      <stop offset="100%" stopColor="#70685b" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                  <path d={areaPath} fill="url(#modal-elevation-fill)" stroke="none" />
                  <path
                    d={linePath}
                    fill="none"
                    stroke="#121212"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>

                {/* Tactical Point Markers */}
                {tacticalPoints.map((pt) => {
                  const leftPct = pt.distanceFraction * 100;
                  const matchingPt = points.find(
                    (p) => Math.abs(p.distanceFraction - pt.distanceFraction) < 0.05
                  );
                  const ptEle = matchingPt ? matchingPt.elevationM : minEle;
                  const topPct = toY(ptEle);

                  return (
                    <div
                      key={pt.key}
                      style={{ left: `${leftPct}%`, top: `${Math.min(75, Math.max(10, topPct))}%` }}
                      className="absolute -translate-x-1/2 -translate-y-full flex flex-col items-center z-10"
                    >
                      <div className="rounded-md border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-md flex items-center gap-1 whitespace-nowrap">
                        {pt.type === "gel" && <Zap className="size-2.5 text-amber-400" />}
                        {pt.type === "solid" && <Utensils className="size-2.5 text-white" />}
                        {pt.type === "stop" && <ShoppingBag className="size-2.5 text-amber-400" />}
                        {pt.type === "water" && <Droplets className="size-2.5 text-blue-400" />}
                        <span>{pt.title}</span>
                      </div>
                      <div className="w-0.5 h-3 bg-neutral-900" />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* X Axis (Km) */}
            <div className="grid grid-cols-[60px_1fr] gap-2">
              <div />
              <div className="flex justify-between text-[10px] font-bold text-neutral-500 pt-1">
                {xTicks.map((x, idx) => (
                  <span key={idx}>Km {x}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-200 px-4 py-3 bg-neutral-50 flex items-center justify-between text-xs text-neutral-600 font-mono">
          <span>Toma pre-puerto (10-15m antes &gt;4%) · Sólidos en llanos · Bloqueo en bajadas (&lt;-3%)</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

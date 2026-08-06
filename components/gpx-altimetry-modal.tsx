"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Maximize2, RotateCcw, X, Utensils, Zap, Droplets, ShoppingBag } from "lucide-react";
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
  const svgRef = useRef<SVGSVGElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  // Detects portrait mode on small screens so we can show a rotate hint.
  const [isPortrait, setIsPortrait] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait) and (max-width: 768px)");
    const update = (e: MediaQueryListEvent | MediaQueryList) => setIsPortrait(e.matches);
    update(mq);
    mq.addEventListener("change", update as (e: MediaQueryListEvent) => void);
    // Attempt to lock orientation to landscape on supporting browsers
    // (e.g. Chrome on Android). Fails silently if not supported or if
    // the document isn't in fullscreen — no-op is the correct behaviour.
    if (typeof screen !== "undefined" && screen.orientation && "lock" in screen.orientation) {
      (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
        .lock?.("landscape")
        .catch(() => {
          // Not supported / not in fullscreen — ignore.
        });
    }
    return () => {
      mq.removeEventListener("change", update as (e: MediaQueryListEvent) => void);
      // Release orientation lock on close
      if (typeof screen !== "undefined" && screen.orientation && "unlock" in screen.orientation) {
        (screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.();
      }
    };
  }, []);


  const elevations = points.map((p) => p.elevationM);
  const minEle = Math.min(...elevations);
  const maxEle = Math.max(...elevations);
  const eleRange = maxEle - minEle || 1;
  const distKm = totalDistanceKm || 100;

  const yTicks = [
    Math.round(maxEle),
    Math.round(minEle + eleRange * 0.66),
    Math.round(minEle + eleRange * 0.33),
    Math.round(minEle),
  ];

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

  /** Renders the chart directly to a Canvas and triggers a PNG download.
   *  No external deps — pure browser Canvas 2D API. */
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const W = 1600;
      const H = 700;
      const PAD_LEFT = 90;
      const PAD_RIGHT = 50;
      const PAD_TOP = 90;
      const PAD_BOTTOM = 70;
      const chartW = W - PAD_LEFT - PAD_RIGHT;
      const chartH = H - PAD_TOP - PAD_BOTTOM;

      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Background
      ctx.fillStyle = "#fcfbf9";
      ctx.fillRect(0, 0, W, H);

      // Title
      ctx.fillStyle = "#121212";
      ctx.font = "bold 18px monospace";
      ctx.textAlign = "left";
      ctx.fillText("RATIO · Perfil Altimétrico Táctico", PAD_LEFT, 38);
      ctx.fillStyle = "#6b6b6b";
      ctx.font = "13px monospace";
      ctx.fillText(`${distKm} km  ·  ${Math.round(minEle)}m – ${Math.round(maxEle)}m`, PAD_LEFT, 60);

      // Y-axis grid lines and labels
      ctx.lineWidth = 1;
      yTicks.forEach((y, idx) => {
        const pct = idx / (yTicks.length - 1);
        const yPx = PAD_TOP + pct * chartH;
        ctx.strokeStyle = "#e5e5e5";
        ctx.beginPath();
        ctx.moveTo(PAD_LEFT, yPx);
        ctx.lineTo(PAD_LEFT + chartW, yPx);
        ctx.stroke();
        ctx.fillStyle = "#888";
        ctx.font = "11px monospace";
        ctx.textAlign = "right";
        ctx.fillText(`${y}m`, PAD_LEFT - 8, yPx + 4);
      });

      // X-axis labels
      ctx.textAlign = "center";
      xTicks.forEach((x, idx) => {
        const pct = idx / (xTicks.length - 1);
        const xPx = PAD_LEFT + pct * chartW;
        ctx.fillStyle = "#888";
        ctx.font = "11px monospace";
        ctx.fillText(`Km ${x}`, xPx, H - 18);
      });

      // Elevation area fill
      ctx.beginPath();
      points.forEach((p, i) => {
        const xPx = PAD_LEFT + (toX(p.distanceFraction) / 100) * chartW;
        const yPx = PAD_TOP + (toY(p.elevationM) / 100) * chartH;
        if (i === 0) ctx.moveTo(xPx, yPx);
        else ctx.lineTo(xPx, yPx);
      });
      const lastP = points[points.length - 1];
      ctx.lineTo(PAD_LEFT + (toX(lastP.distanceFraction) / 100) * chartW, PAD_TOP + chartH);
      ctx.lineTo(PAD_LEFT, PAD_TOP + chartH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, PAD_TOP, 0, PAD_TOP + chartH);
      grad.addColorStop(0, "rgba(112,104,91,0.25)");
      grad.addColorStop(1, "rgba(112,104,91,0.02)");
      ctx.fillStyle = grad;
      ctx.fill();

      // Elevation line
      ctx.beginPath();
      ctx.strokeStyle = "#121212";
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      points.forEach((p, i) => {
        const xPx = PAD_LEFT + (toX(p.distanceFraction) / 100) * chartW;
        const yPx = PAD_TOP + (toY(p.elevationM) / 100) * chartH;
        if (i === 0) ctx.moveTo(xPx, yPx);
        else ctx.lineTo(xPx, yPx);
      });
      ctx.stroke();

      // Tactical point markers
      for (const pt of tacticalPoints) {
        const xPx = PAD_LEFT + pt.distanceFraction * chartW;
        const matchingP = points.find((p) => Math.abs(p.distanceFraction - pt.distanceFraction) < 0.05);
        const ptEle = matchingP ? matchingP.elevationM : minEle;
        const yRaw = PAD_TOP + (toY(ptEle) / 100) * chartH;
        const yBadge = Math.min(PAD_TOP + chartH - 32, Math.max(PAD_TOP + 16, yRaw - 28));

        // Stem
        ctx.beginPath();
        ctx.strokeStyle = "#121212";
        ctx.lineWidth = 1;
        ctx.moveTo(xPx, yBadge + 22);
        ctx.lineTo(xPx, yRaw);
        ctx.stroke();

        // Badge
        const label = pt.title.length > 24 ? pt.title.slice(0, 24) + "…" : pt.title;
        ctx.font = "bold 10px monospace";
        const textW = ctx.measureText(label).width + 24;
        ctx.fillStyle = "#121212";
        ctx.beginPath();
        (ctx as CanvasRenderingContext2D).roundRect(xPx - textW / 2, yBadge, textW, 20, 4);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.fillText(label, xPx, yBadge + 13);
      }

      // Watermark
      ctx.fillStyle = "#ccc";
      ctx.font = "11px monospace";
      ctx.textAlign = "right";
      ctx.fillText("ratio.velo", W - PAD_RIGHT, H - 6);

      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "ficha-tactica-ratio.png";
        a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } finally {
      setIsExporting(false);
    }
  };

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

        {/* Portrait orientation hint — visible only on narrow screens */}
        {isPortrait && (
          <div className="flex items-center gap-2 border-b border-amber-200/60 bg-[#fcf8f2] px-4 py-2 font-mono text-[11px] text-amber-900">
            <RotateCcw className="size-3.5 shrink-0 text-amber-600" />
            Gira la pantalla para mejor visualización táctica
          </div>
        )}

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
                  ref={svgRef}
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <Download className="size-3.5" />
              {isExporting ? "Generando…" : "Descargar Ficha Táctica"}
            </button>
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
    </div>
  );
}

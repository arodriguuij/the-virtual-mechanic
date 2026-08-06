"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Maximize2, X, Utensils, Zap, Droplets, ShoppingBag } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TacticalPoint = {
  key: string;
  distanceFraction: number; // 0 to 1
  km: number;
  elevationM?: number;
  type: "gel" | "solid" | "stop" | "water";
  title: string;
};

// ─── Preview Card (replaces the inline sparkline in Card 05) ─────────────────

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

  const distKm = totalDistanceKm ?? 0;
  const count = tacticalPoints.length;

  return (
    <>
      {/* Dark action card — PNS style */}
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-neutral-900 p-4 text-white">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-widest text-neutral-400">
            Perfil Táctico de Ruta
          </p>
          <p className="mt-0.5 truncate font-mono text-sm font-bold text-amber-400">
            {distKm > 0 ? `${distKm} km` : "Ruta GPX"}{" "}
            {count > 0 && (
              <span className="font-normal text-neutral-300">
                · {count} toma{count !== 1 ? "s" : ""} programada{count !== 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-2 font-mono text-[11px] font-bold text-neutral-900 transition-colors hover:bg-neutral-100 cursor-pointer"
        >
          <Maximize2 className="size-3.5" />
          Ver Altimetría
        </button>
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

// ─── Full-screen Modal ────────────────────────────────────────────────────────

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
  const [isExporting, setIsExporting] = useState(false);
  // For CSS-based landscape rotation we just need the viewport dimensions,
  // which we capture in a one-time ref — no state needed.
  const containerRef = useRef<HTMLDivElement>(null);

  // Prevent body scroll while modal is open.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // ── Chart maths ────────────────────────────────────────────────────────────
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

  /** Convert a 0–1 fraction to a 0–100 SVG-viewBox X coordinate. */
  const toX = (f: number) => Math.max(0, Math.min(100, f * 100));
  /** Convert elevation to a 0–100 SVG-viewBox Y coordinate (top = high). */
  const toY = (e: number) => 100 - ((e - minEle) / eleRange) * 100;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.distanceFraction).toFixed(2)},${toY(p.elevationM).toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L100,100 L0,100 Z`;

  // ── Stagger anti-collision ─────────────────────────────────────────────────
  // Assign a vertical offset tier (0 or 1) to each marker so that points
  // closer than MIN_GAP_FRACTION apart don't overlap.
  const MIN_GAP_FRACTION = 4 / distKm; // 4 km expressed as a fraction
  const staggeredPoints = tacticalPoints.map((pt, i) => {
    const prev = tacticalPoints[i - 1];
    const tier =
      prev && Math.abs(pt.distanceFraction - prev.distanceFraction) < MIN_GAP_FRACTION ? 1 : 0;
    return { ...pt, tier };
  });

  // ── Nearest elevation lookup ───────────────────────────────────────────────
  function nearestElevation(fraction: number): number {
    let best = points[0];
    let bestDelta = Math.abs(points[0].distanceFraction - fraction);
    for (const p of points) {
      const d = Math.abs(p.distanceFraction - fraction);
      if (d < bestDelta) {
        bestDelta = d;
        best = p;
      }
    }
    return best.elevationM;
  }

  // ── Canvas PNG export ──────────────────────────────────────────────────────
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const W = 1600;
      const H = 700;
      const PAD_L = 90;
      const PAD_R = 50;
      const PAD_T = 90;
      const PAD_B = 70;
      const CW = W - PAD_L - PAD_R;
      const CH = H - PAD_T - PAD_B;

      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;

      // Background
      ctx.fillStyle = "#fcfbf9";
      ctx.fillRect(0, 0, W, H);

      // Title & subtitle
      ctx.fillStyle = "#121212";
      ctx.font = "bold 18px monospace";
      ctx.textAlign = "left";
      ctx.fillText("RATIO · Perfil Altimétrico Táctico", PAD_L, 38);
      ctx.fillStyle = "#6b6b6b";
      ctx.font = "13px monospace";
      ctx.fillText(
        `${distKm} km  ·  ${Math.round(minEle)}m – ${Math.round(maxEle)}m  ·  ${tacticalPoints.length} tomas`,
        PAD_L,
        60
      );

      // Y-axis grid + labels
      yTicks.forEach((y, idx) => {
        const yPx = PAD_T + (idx / (yTicks.length - 1)) * CH;
        ctx.strokeStyle = "#e5e5e5";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD_L, yPx);
        ctx.lineTo(PAD_L + CW, yPx);
        ctx.stroke();
        ctx.fillStyle = "#888";
        ctx.font = "11px monospace";
        ctx.textAlign = "right";
        ctx.fillText(`${y}m`, PAD_L - 8, yPx + 4);
      });

      // X-axis labels
      xTicks.forEach((x, idx) => {
        const xPx = PAD_L + (idx / (xTicks.length - 1)) * CW;
        ctx.fillStyle = "#888";
        ctx.font = "11px monospace";
        ctx.textAlign = "center";
        ctx.fillText(`Km ${x}`, xPx, H - 18);
      });

      // Elevation area
      ctx.beginPath();
      points.forEach((p, i) => {
        const xPx = PAD_L + (toX(p.distanceFraction) / 100) * CW;
        const yPx = PAD_T + (toY(p.elevationM) / 100) * CH;
        i === 0 ? ctx.moveTo(xPx, yPx) : ctx.lineTo(xPx, yPx);
      });
      const lp = points[points.length - 1];
      ctx.lineTo(PAD_L + (toX(lp.distanceFraction) / 100) * CW, PAD_T + CH);
      ctx.lineTo(PAD_L, PAD_T + CH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + CH);
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
        const xPx = PAD_L + (toX(p.distanceFraction) / 100) * CW;
        const yPx = PAD_T + (toY(p.elevationM) / 100) * CH;
        i === 0 ? ctx.moveTo(xPx, yPx) : ctx.lineTo(xPx, yPx);
      });
      ctx.stroke();

      // Tactical markers with stagger
      staggeredPoints.forEach((pt) => {
        const xPx = PAD_L + pt.distanceFraction * CW;
        const yRaw = PAD_T + (toY(nearestElevation(pt.distanceFraction)) / 100) * CH;
        // Stagger: tier-1 markers float 40px higher
        const yBadge = Math.min(
          PAD_T + CH - 36,
          Math.max(PAD_T + 14, yRaw - 30 - pt.tier * 42)
        );

        // Dashed stem
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = "#a3a3a3";
        ctx.lineWidth = 1;
        ctx.moveTo(xPx, yBadge + 22);
        ctx.lineTo(xPx, yRaw);
        ctx.stroke();
        ctx.setLineDash([]);

        // Badge
        const typePrefix = pt.type === "gel" ? "⚡" : pt.type === "solid" ? "🍌" : pt.type === "stop" ? "🛒" : "💧";
        const label = `Km ${pt.km} · ${typePrefix} ${pt.title}`;
        const truncated = label.length > 30 ? label.slice(0, 30) + "…" : label;
        ctx.font = "bold 10px monospace";
        const tw = ctx.measureText(truncated).width + 20;
        ctx.fillStyle = "#121212";
        ctx.beginPath();
        (ctx as CanvasRenderingContext2D & { roundRect: (x: number, y: number, w: number, h: number, r: number) => void })
          .roundRect(xPx - tw / 2, yBadge, tw, 20, 4);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.fillText(truncated, xPx, yBadge + 13);
      });

      // Watermark
      ctx.fillStyle = "#ccc";
      ctx.font = "11px monospace";
      ctx.textAlign = "right";
      ctx.fillText("ratio.velo", W - PAD_R, H - 6);

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

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    /*
     * CSS-forced landscape on portrait mobile:
     * On small screens in portrait orientation the entire dialog is rotated
     * 90° via CSS so the user doesn't need to unlock their device rotation.
     * On landscape or desktop the rotation is 0° (no-op).
     */
    <div
      className="
        fixed inset-0 z-99999
        flex items-center justify-center
        bg-neutral-950/70 backdrop-blur-sm
        animate-in fade-in duration-200
        [@media_(max-width:768px)_and_(orientation:portrait)]:p-0
        p-2 sm:p-6
      "
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        className="
          flex flex-col rounded-xl bg-white shadow-2xl overflow-hidden font-mono border border-neutral-200
          /* Normal (landscape / desktop): fills available space. Widened at
             lg:/xl: (Ajuste de Layout Desktop para Modal de Altimetría) so
             a wide monitor gets real extra horizontal resolution for the
             km axis instead of the chart staying capped at a phone-sized
             `max-w-5xl` on a panoramic screen. `h-[92vh]` (a definite,
             fixed height, not a `max-h` cap) is deliberately kept as-is —
             it's exactly what lets the chart area's own `flex-1` below
             expand to fill whatever vertical room is actually left after
             the header/legend/footer, instead of the modal auto-shrinking
             to content height and leaving nothing for `flex-1` to grow
             into. */
          w-full max-w-5xl lg:max-w-6xl xl:max-w-7xl h-[92vh]
          /* Layout Fullscreen Completo para Modal Apaisado Rotado — portrait
             mobile takes the container fully out of the parent's flex flow
             (`fixed`) and centers/rotates it with one explicit `transform`
             instead of relying on the flex parent's own centering plus a bare
             `rotate-90` utility: the previous version sized the box at
             `w-[100vh] h-[100vw]` (viewport units, which on mobile Safari/
             Chrome can exceed the *actually visible* viewport before the
             browser chrome collapses) while still being flex-centered as a
             normal child, which is what left visible gaps around the
             rotated box rather than it genuinely filling the screen.
             `100dvh`/`100dvw` (dynamic viewport units) track the real
             visible viewport instead, and `fixed` + `top-1/2 left-1/2` +
             one combined `translate(-50%,-50%) rotate(90deg)` transform
             centers and rotates the box in a single, unambiguous step,
             independent of the parent's own flex layout. */
          [@media_(max-width:768px)_and_(orientation:portrait)]:fixed
          [@media_(max-width:768px)_and_(orientation:portrait)]:top-1/2
          [@media_(max-width:768px)_and_(orientation:portrait)]:left-1/2
          [@media_(max-width:768px)_and_(orientation:portrait)]:m-0
          [@media_(max-width:768px)_and_(orientation:portrait)]:w-dvh
          [@media_(max-width:768px)_and_(orientation:portrait)]:h-dvw
          [@media_(max-width:768px)_and_(orientation:portrait)]:max-w-none
          [@media_(max-width:768px)_and_(orientation:portrait)]:max-h-none
          [@media_(max-width:768px)_and_(orientation:portrait)]:rounded-none
          [@media_(max-width:768px)_and_(orientation:portrait)]:border-0
          [@media_(max-width:768px)_and_(orientation:portrait)]:z-99999
          [@media_(max-width:768px)_and_(orientation:portrait)]:transform-[translate(-50%,-50%)_rotate(90deg)]
        "
      >
        {/* Header — a "micro-barra" on portrait mobile: after rotation this
            app's own DOM-height budget for the whole box is only `100dvw`
            (the phone's physical width, ~360-430px), the scarce dimension
            the chart's own Y-axis has to share with this bar — shrinking it
            to a minimal height leaves the chart the most room possible. */}
        <div
          className="
            flex shrink-0 items-center justify-between border-b border-neutral-200 px-4 py-3 bg-neutral-50
            [@media_(max-width:768px)_and_(orientation:portrait)]:h-9
            [@media_(max-width:768px)_and_(orientation:portrait)]:px-2
            [@media_(max-width:768px)_and_(orientation:portrait)]:py-1
          "
        >
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

        {/* Scrollable chart area */}
        <div className="flex-1 overflow-x-auto overflow-y-auto p-4 sm:p-6 bg-[#fcfbf9] [@media_(max-width:768px)_and_(orientation:portrait)]:p-2">
          <div className="min-w-[750px] flex h-full flex-col gap-4 [@media_(max-width:768px)_and_(orientation:portrait)]:min-w-0 [@media_(max-width:768px)_and_(orientation:portrait)]:w-full">

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-600 border-b border-neutral-200 pb-2">
              <span className="font-semibold text-neutral-900 uppercase">Leyenda:</span>
              <span className="flex items-center gap-1"><Zap className="size-3.5 text-amber-600" /> Pre-Puerto (Gel 10-15m)</span>
              <span className="flex items-center gap-1"><Utensils className="size-3.5 text-neutral-700" /> Llano (Sólidos)</span>
              <span className="flex items-center gap-1"><Droplets className="size-3.5 text-blue-600" /> Hídrico</span>
              <span className="flex items-center gap-1"><ShoppingBag className="size-3.5 text-neutral-500" /> Parada</span>
            </div>

            {/* Chart: Y-axis + SVG canvas — `flex-1` at every breakpoint
                (not just portrait mobile) so the canvas actually expands to
                fill whatever vertical room the modal's own fixed `h-[92vh]`
                leaves available, rather than sitting at a flat `h-[380px]`
                that left a large empty band above the footer on a tall
                desktop viewport ("Ajuste de Layout Desktop..."). `min-h-*`
                is a floor, not a fixed size, so it still grows past 380px/
                480px whenever more room is actually available; portrait
                mobile cancels that floor (`min-h-0`) since its own real
                DOM-height budget post-rotation (~300-330px, see the header/
                footer micro-bar comments above) is smaller than either
                floor and a fixed minimum there would force an overflow. */}
            <div className="grid flex-1 grid-cols-[60px_1fr] gap-2 items-stretch min-h-95 pt-4 lg:min-h-120 [@media_(max-width:768px)_and_(orientation:portrait)]:min-h-0">
              {/* Y Axis */}
              <div className="flex flex-col justify-between text-right text-[10px] font-bold text-neutral-500 pr-2 border-r border-neutral-300">
                {yTicks.map((y, i) => <span key={i}>{y}m</span>)}
              </div>

              {/* SVG canvas */}
              <div className="relative w-full h-full border-b border-neutral-300">
                {/* Grid lines */}
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-20">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="border-b border-neutral-400 w-full" />)}
                </div>

                {/* Elevation SVG */}
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
                  <path d={linePath} fill="none" stroke="#121212" strokeWidth={2} vectorEffect="non-scaling-stroke" />

                  {/* Dashed vertical stems (SVG layer, under badge overlay) */}
                  {staggeredPoints.map((pt) => {
                    const x = toX(pt.distanceFraction);
                    const y = toY(nearestElevation(pt.distanceFraction));
                    return (
                      <line
                        key={`stem-${pt.key}`}
                        x1={x} y1={y}
                        x2={x} y2={100}
                        stroke="#a3a3a3"
                        strokeWidth={0.4}
                        strokeDasharray="1.5 1.5"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </svg>

                {/* Badge overlay (HTML, above SVG) */}
                {staggeredPoints.map((pt) => {
                  const leftPct = pt.distanceFraction * 100;
                  const eleY = toY(nearestElevation(pt.distanceFraction));
                  // Base top % follows the elevation curve; tier-1 floats higher
                  const topPct = Math.min(72, Math.max(4, eleY - 2 - pt.tier * 18));

                  return (
                    <div
                      key={pt.key}
                      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                      className="absolute -translate-x-1/2 -translate-y-full flex flex-col items-center z-10"
                    >
                      <div className="rounded-md border border-neutral-800 bg-neutral-900 px-1.5 py-[3px] text-[9px] font-bold text-white shadow-md flex items-center gap-1 whitespace-nowrap">
                        {pt.type === "gel"   && <Zap         className="size-2.5 text-amber-400 shrink-0" />}
                        {pt.type === "solid" && <Utensils    className="size-2.5 text-neutral-200 shrink-0" />}
                        {pt.type === "stop"  && <ShoppingBag className="size-2.5 text-amber-400 shrink-0" />}
                        {pt.type === "water" && <Droplets    className="size-2.5 text-blue-400 shrink-0" />}
                        <span>Km {pt.km} · {pt.title}</span>
                      </div>
                      {/* Stem connector dot */}
                      <div className="w-px h-3 bg-neutral-600" />
                      <div className="size-1 rounded-full bg-neutral-600" />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* X Axis */}
            <div className="grid grid-cols-[60px_1fr] gap-2">
              <div />
              <div className="flex justify-between text-[10px] font-bold text-neutral-500 pt-1">
                {xTicks.map((x, i) => <span key={i}>Km {x}</span>)}
              </div>
            </div>
          </div>
        </div>

        {/* Footer — also compacted on portrait mobile (same micro-bar
            reasoning as the header above) so the export/close actions stay
            reachable without eating into the chart's own scarce DOM-height
            budget. */}
        <div
          className="
            shrink-0 border-t border-neutral-200 px-4 py-3 bg-neutral-50 flex items-center justify-between gap-2 text-xs text-neutral-600 font-mono
            [@media_(max-width:768px)_and_(orientation:portrait)]:px-2
            [@media_(max-width:768px)_and_(orientation:portrait)]:py-1
          "
        >
          <span className="hidden sm:block">
            Pre-puerto (10-15m antes &gt;4%) · Sólidos en llanos · Bloqueo bajadas (&lt;-3%)
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors [@media_(max-width:768px)_and_(orientation:portrait)]:px-2 [@media_(max-width:768px)_and_(orientation:portrait)]:py-1"
            >
              <Download className="size-3.5" />
              <span className="[@media_(max-width:768px)_and_(orientation:portrait)]:hidden">
                {isExporting ? "Generando…" : "Descargar Ficha Táctica"}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 cursor-pointer [@media_(max-width:768px)_and_(orientation:portrait)]:px-2 [@media_(max-width:768px)_and_(orientation:portrait)]:py-1"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

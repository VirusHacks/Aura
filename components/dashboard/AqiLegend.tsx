"use client";

import { useEffect, useRef } from "react";
import { Compass, Home, Minus, Plus, RotateCcw, RotateCw } from "lucide-react";
import { AQI_BANDS } from "@/lib/aqi";
import { cameraBridge } from "@/lib/camera-bridge";
import { useSimStore } from "@/store/simulation-store";

export function AqiLegend() {
  return (
    <section className="aq-panel pointer-events-auto px-3 py-2.5" aria-label="AQI legend">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="aq-eyebrow">Indian AQI (CPCB bands)</span>
        <span className="text-[9.5px] text-[var(--faint)]">stylised city · not to scale</span>
      </div>
      <div className="grid grid-cols-6 gap-[3px]">
        {AQI_BANDS.map((b) => (
          <div key={b.category} className="min-w-0">
            <div className="h-1.5 rounded-full" style={{ background: b.color }} />
            <div className="mt-1 truncate text-[9.5px] font-medium text-[var(--ink-2)]">{b.category}</div>
            <div className="aq-num text-[9px] text-[var(--faint)]">
              {b.min}–{b.max}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MapControls() {
  const resetView = useSimStore((s) => s.resetView);
  const needle = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (needle.current) needle.current.style.transform = `rotate(${(-cameraBridge.azimuth() * 180) / Math.PI + 45}deg)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="aq-panel pointer-events-auto flex flex-col items-center gap-0.5 p-1" role="toolbar" aria-label="Camera controls" aria-orientation="vertical">
      <button type="button" className="aq-icon-btn" aria-label="Zoom in" title="Zoom in (+)" onClick={() => cameraBridge.zoom(0.3)}>
        <Plus size={15} />
      </button>
      <button type="button" className="aq-icon-btn" aria-label="Zoom out" title="Zoom out (−)" onClick={() => cameraBridge.zoom(-0.4)}>
        <Minus size={15} />
      </button>
      <div className="my-0.5 h-px w-5 bg-[var(--line)]" />
      <button type="button" className="aq-icon-btn" aria-label="Rotate left" title="Rotate (Q)" onClick={() => cameraBridge.rotate(Math.PI / 8)}>
        <RotateCcw size={14} />
      </button>
      <button type="button" className="aq-icon-btn" aria-label="Rotate right" title="Rotate (E)" onClick={() => cameraBridge.rotate(-Math.PI / 8)}>
        <RotateCw size={14} />
      </button>
      <button type="button" className="aq-icon-btn" aria-label="Face north" title="Face north" onClick={() => cameraBridge.resetNorth()}>
        <Compass ref={needle} size={15} className="text-[var(--accent)]" />
      </button>
      <div className="my-0.5 h-px w-5 bg-[var(--line)]" />
      <button type="button" className="aq-icon-btn" aria-label="Reset view" title="Reset view" onClick={resetView}>
        <Home size={15} />
      </button>
    </div>
  );
}

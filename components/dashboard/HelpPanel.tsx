"use client";

import { useEffect, useState } from "react";
import { Hand, Keyboard, Mouse, X } from "lucide-react";
import { useSimStore } from "@/store/simulation-store";
import { useDismiss } from "../ui/Popover";

const ROWS: { icon: typeof Mouse; title: string; items: [string, string][] }[] = [
  {
    icon: Mouse,
    title: "Mouse",
    items: [
      ["Drag", "Pan across the city"],
      ["Right-drag", "Rotate and tilt"],
      ["Scroll", "Zoom toward the cursor"],
      ["Click", "Select a zone, landmark, building or source"],
    ],
  },
  {
    icon: Hand,
    title: "Touch",
    items: [
      ["One finger", "Pan"],
      ["Pinch / two fingers", "Zoom and rotate"],
      ["Tap", "Select"],
    ],
  },
  {
    icon: Keyboard,
    title: "Keyboard",
    items: [
      ["W A S D / arrows", "Pan"],
      ["Q / E", "Rotate"],
      ["+ / −", "Zoom"],
      ["/", "Search"],
      ["Esc", "Deselect"],
    ],
  },
];

export function HelpPanel() {
  const open = useSimStore((s) => s.helpOpen);
  const setOpen = useSimStore((s) => s.setHelpOpen);
  const ref = useDismiss(open, () => setOpen(false));
  if (!open) return null;
  return (
    <div className="pointer-events-auto fixed inset-0 z-[70] grid place-items-center bg-black/15 p-4" role="dialog" aria-modal="true" aria-label="How to explore AEROSCOPE">
      <div ref={ref} className="aq-panel-strong aq-rise aq-scroll max-h-[90dvh] w-full max-w-[560px] p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="aq-eyebrow mb-1.5">Guide</p>
            <h2 className="text-[18px] font-semibold tracking-tight">Exploring the city</h2>
          </div>
          <button type="button" className="aq-icon-btn" aria-label="Close guide" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {ROWS.map(({ icon: Icon, title, items }) => (
            <div key={title}>
              <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold">
                <Icon size={14} className="text-[var(--accent)]" />
                {title}
              </div>
              <dl className="space-y-1.5">
                {items.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11.5px] font-medium text-[var(--ink)]">{k}</dt>
                    <dd className="text-[11px] text-[var(--muted)]">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <div className="aq-divider my-4" />
        <div className="space-y-2 text-[11.5px] leading-relaxed text-[var(--ink-2)]">
          <p>
            <strong>What you are seeing.</strong> A stylised, schematic Delhi — landmark positions are arranged for legibility and are not survey accurate.
            Colours on the ground and rooftops show a continuous AQI field interpolated between 17 zones.
          </p>
          <p>
            <strong>Data.</strong> Zone baselines are a deterministic <em>demo dataset</em>, not official or live readings. Time of day and atmosphere presets
            apply a transparent multiplier model (traffic share, mixing height, wind dilution) — every reading is labelled simulated.
          </p>
          <p>
            <strong>Limitations.</strong> Plumes, haze and wind streams are illustrative animations driven by the scenario wind vector. They do not reproduce
            atmospheric physics or dispersion.
          </p>
        </div>
      </div>
    </div>
  );
}

/** One-time gesture hint after the city loads. */
export function GestureHint() {
  const ready = useSimStore((s) => s.sceneReady);
  const [visible, setVisible] = useState(true);
  const [touch] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setVisible(false), 7000);
    return () => clearTimeout(t);
  }, [ready]);
  if (!ready || !visible) return null;
  return (
    <div className="aq-panel-strong aq-rise pointer-events-auto absolute left-1/2 top-[76px] z-30 flex -translate-x-1/2 items-center gap-3 px-3.5 py-2 text-[11.5px] text-[var(--ink-2)] max-md:top-[150px]">
      {touch ? <Hand size={14} className="text-[var(--accent)]" /> : <Mouse size={14} className="text-[var(--accent)]" />}
      <span>{touch ? "One finger to pan · pinch to zoom & rotate · tap to select" : "Drag to pan · right-drag to rotate · scroll to zoom · click to inspect"}</span>
      <button type="button" className="text-[var(--muted)] hover:text-[var(--ink)]" aria-label="Dismiss hint" onClick={() => setVisible(false)}>
        <X size={13} />
      </button>
    </div>
  );
}

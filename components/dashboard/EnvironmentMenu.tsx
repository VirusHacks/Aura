"use client";

import { CloudSun, Navigation } from "lucide-react";
import { compass } from "@/lib/formatting";
import { PRESET_BY_ID, SCENARIO_PRESETS, scenarioConditions } from "@/lib/simulation-engine";
import { useSimStore } from "@/store/simulation-store";
import { Popover } from "../ui/Popover";

/** Arrow pointing where the wind blows TO (bearing + 180). */
export function WindArrow({ from, size = 14 }: { from: number; size?: number }) {
  return (
    <Navigation
      size={size}
      className="shrink-0 text-[var(--accent)]"
      style={{ transform: `rotate(${from + 180 - 45}deg)`, transition: "transform 0.6s ease" }}
      fill="currentColor"
      aria-hidden
    />
  );
}

export function EnvironmentPanel() {
  const preset = useSimStore((s) => s.preset);
  const setPreset = useSimStore((s) => s.setPreset);
  const timeIndex = useSimStore((s) => s.timeIndex);
  const reducedMotion = useSimStore((s) => s.reducedMotion);
  const setReducedMotion = useSimStore((s) => s.setReducedMotion);
  const cond = scenarioConditions(timeIndex, preset);
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-2.5 pb-1.5 pt-2">
        <span className="aq-eyebrow">Atmosphere preset</span>
        <span className="aq-badge bg-[var(--amber-soft)] text-[var(--amber)]">SIMULATED</span>
      </div>
      <div role="radiogroup" aria-label="Atmosphere preset" className="flex flex-col">
        {SCENARIO_PRESETS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} className="aq-row items-start" onClick={() => setPreset(p.id)}>
            <span
              className="mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border"
              style={{ borderColor: preset === p.id ? "var(--accent)" : "var(--line-strong)" }}
            >
              {preset === p.id && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{p.label}</span>
                <span className="aq-num text-[10.5px] text-[var(--muted)]">
                  ×{p.load.toFixed(2)} · {p.windSpeed} m/s
                </span>
              </span>
              <span className="block text-[11px] leading-snug text-[var(--muted)]">{p.description}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="aq-divider my-1.5" />
      <div className="flex items-center gap-3 px-2.5 py-2 text-[12px]">
        <WindArrow from={cond.windFrom} size={16} />
        <div className="flex-1">
          <div className="font-medium text-[var(--ink)]">
            Wind from {compass(cond.windFrom)} · {cond.windSpeed} m/s
          </div>
          <div className="text-[11px] text-[var(--muted)]">
            Haze {(cond.haze * 100).toFixed(0)}% · traffic ×{cond.trafficLevel.toFixed(2)}
          </div>
        </div>
      </div>
      <button type="button" role="menuitemcheckbox" aria-checked={reducedMotion} className="aq-row" onClick={() => setReducedMotion(!reducedMotion)}>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Reduced motion</span>
          <span className="block text-[11px] text-[var(--muted)]">Slow animation, quicker camera moves</span>
        </span>
        <span className="aq-switch" data-on={reducedMotion} aria-hidden />
      </button>
      <p className="px-2.5 pb-2 pt-1 text-[10.5px] leading-snug text-[var(--faint)]">
        Presets apply a transparent multiplier model to the demo baseline. Not a forecast or dispersion model.
      </p>
    </div>
  );
}

export function EnvironmentMenu() {
  const preset = useSimStore((s) => s.preset);
  return (
    <Popover
      label="Weather and atmosphere"
      width={340}
      align="right"
      trigger={
        <>
          <CloudSun size={15} />
          <span className="hidden xl:inline">{PRESET_BY_ID[preset].label}</span>
        </>
      }
    >
      {() => <EnvironmentPanel />}
    </Popover>
  );
}

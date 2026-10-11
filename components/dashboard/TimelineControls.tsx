"use client";

import { useEffect } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { PRESET_BY_ID, TIME_STEPS } from "@/lib/simulation-engine";
import { useSimStore } from "@/store/simulation-store";

const STEP_MS = 2600;

export function TimelineControls({ compact = false }: { compact?: boolean }) {
  const timeIndex = useSimStore((s) => s.timeIndex);
  const playing = useSimStore((s) => s.playing);
  const preset = useSimStore((s) => s.preset);
  const setPlaying = useSimStore((s) => s.setPlaying);
  const setTimeIndex = useSimStore((s) => s.setTimeIndex);
  const resetTimeline = useSimStore((s) => s.resetTimeline);
  const stepTime = useSimStore((s) => s.stepTime);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(stepTime, STEP_MS);
    return () => clearInterval(id);
  }, [playing, stepTime]);

  const step = TIME_STEPS[timeIndex];
  const fill = `${(timeIndex / (TIME_STEPS.length - 1)) * 100}%`;
  return (
    <section className="aq-panel pointer-events-auto flex items-center gap-2 px-2.5 py-2" aria-label="Simulation timeline">
      <button type="button" className="aq-icon-btn is-active !h-8 !w-8 shrink-0" aria-label={playing ? "Pause simulation" : "Play simulation"} onClick={() => setPlaying(!playing)}>
        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
      </button>
      <button type="button" className="aq-icon-btn !h-8 !w-8 shrink-0" aria-label="Reset timeline" title="Reset to 15:00" onClick={resetTimeline}>
        <RotateCcw size={14} />
      </button>
      <div className="flex w-[64px] shrink-0 flex-col leading-none">
        <span className="aq-num text-[15px] font-semibold text-[var(--ink)]">{step.label}</span>
        <span className="mt-1 text-[10px] text-[var(--muted)]">{step.period}</span>
      </div>
      <div className="min-w-0 flex-1 px-1">
        <input
          type="range"
          min={0}
          max={TIME_STEPS.length - 1}
          step={1}
          value={timeIndex}
          onChange={(e) => setTimeIndex(Number(e.target.value))}
          className="aq-range"
          style={{ ["--fill" as string]: fill }}
          aria-label="Simulated time of day"
          aria-valuetext={`${step.label} ${step.period}`}
        />
        {!compact && (
          <div className="mt-0.5 hidden justify-between px-[2px] sm:flex">
            {TIME_STEPS.map((t) => (
              <button
                key={t.index}
                type="button"
                onClick={() => setTimeIndex(t.index)}
                className={`aq-num w-8 text-center text-[9.5px] first:text-left last:text-right ${t.index === timeIndex ? "font-semibold text-[var(--accent-strong)]" : "text-[var(--faint)] hover:text-[var(--ink-2)]"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
        <span className="aq-badge bg-[var(--amber-soft)] text-[9.5px] tracking-[0.08em] text-[var(--amber)]">SIMULATED SCENARIO</span>
        <span className="text-[10px] text-[var(--muted)]">{PRESET_BY_ID[preset].label}</span>
      </div>
    </section>
  );
}

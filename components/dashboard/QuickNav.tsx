"use client";

import { Home } from "lucide-react";
import { LANDMARKS } from "@/data/landmarks";
import { useSimStore } from "@/store/simulation-store";
import { AqiValue } from "../ui/Aqi";
import { selectLandmark } from "./actions";

const QUICK = LANDMARKS.filter((l) => l.quickNav);

export function QuickNav() {
  const selection = useSimStore((s) => s.selection);
  const readings = useSimStore((s) => s.readings);
  const resetView = useSimStore((s) => s.resetView);
  return (
    <nav className="aq-panel pointer-events-auto w-[188px] p-1.5" aria-label="Quick navigation">
      <div className="aq-eyebrow px-2 pb-1.5 pt-1.5">Jump to</div>
      {QUICK.map((l) => {
        const zone = readings.find((r) => r.id === l.zoneId);
        const active = selection?.kind === "landmark" && selection.id === l.id;
        return (
          <button key={l.id} type="button" className="aq-row !py-1.5 text-[12px]" aria-current={active} data-active={active} onClick={() => selectLandmark(l.id)}>
            <span className="flex-1 truncate font-medium">{l.name}</span>
            {zone && <AqiValue aqi={zone.aqi} />}
          </button>
        );
      })}
      <div className="aq-divider my-1" />
      <button type="button" className="aq-row !py-1.5 text-[12px] text-[var(--ink-2)]" onClick={resetView}>
        <Home size={13} className="text-[var(--muted)]" />
        <span className="flex-1">City overview</span>
      </button>
    </nav>
  );
}

"use client";

import { Car, CircleDashed, Factory, Layers, Sparkles, Tag, Thermometer, Wind } from "lucide-react";
import { useSimStore } from "@/store/simulation-store";
import type { LayerId } from "@/types/scene";
import { Popover } from "../ui/Popover";

export const LAYERS: { id: LayerId; label: string; hint: string; icon: typeof Layers }[] = [
  { id: "heatmap", label: "AQI heatmap", hint: "Continuous field + band isolines", icon: Thermometer },
  { id: "labels", label: "AQI labels", hint: "Floating zone markers", icon: Tag },
  { id: "sources", label: "Pollution sources", hint: "Traffic, construction, industry…", icon: Factory },
  { id: "plumes", label: "Particle plumes", hint: "Source plumes & ambient haze", icon: Sparkles },
  { id: "wind", label: "Wind flow", hint: "Illustrative wind streams", icon: Wind },
  { id: "traffic", label: "Traffic", hint: "Moving vehicles", icon: Car },
  { id: "boundaries", label: "Zone boundaries", hint: "Nominal zone extents", icon: CircleDashed },
];

export function LayerList() {
  const layers = useSimStore((s) => s.layers);
  const toggle = useSimStore((s) => s.toggleLayer);
  return (
    <div className="flex flex-col">
      <div className="aq-eyebrow px-2.5 pb-1.5 pt-2">Map layers</div>
      {LAYERS.map(({ id, label, hint, icon: Icon }) => (
        <button key={id} type="button" role="menuitemcheckbox" aria-checked={layers[id]} className="aq-row" onClick={() => toggle(id)}>
          <Icon size={15} className="shrink-0 text-[var(--muted)]" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{label}</span>
            <span className="block text-[11px] text-[var(--muted)]">{hint}</span>
          </span>
          <span className="aq-switch" data-on={layers[id]} aria-hidden />
        </button>
      ))}
    </div>
  );
}

export function LayerMenu() {
  const active = useSimStore((s) => Object.values(s.layers).filter(Boolean).length);
  return (
    <Popover
      label="Map layers"
      width={290}
      align="right"
      trigger={
        <>
          <Layers size={15} />
          <span className="hidden xl:inline">Layers</span>
          <span className="aq-num rounded-[5px] bg-[var(--hover)] px-1 text-[10px] text-[var(--muted)]">{active}</span>
        </>
      }
    >
      {() => <LayerList />}
    </Popover>
  );
}

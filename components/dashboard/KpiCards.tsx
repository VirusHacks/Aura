"use client";

import { Activity, AlertTriangle, Droplets } from "lucide-react";
import { getAqiBand } from "@/lib/aqi";
import { useSimStore } from "@/store/simulation-store";
import { AqiBadge } from "../ui/Aqi";
import { selectZone } from "./actions";

function Card({
  icon: Icon,
  label,
  children,
  detail,
}: {
  icon: typeof Activity;
  label: string;
  children: React.ReactNode;
  detail: React.ReactNode;
}) {
  return (
    <div className="aq-panel flex min-w-[150px] flex-1 flex-col gap-1.5 px-3 py-2.5 sm:min-w-[188px] sm:gap-2 sm:px-3.5 sm:py-3">
      <div className="flex items-center gap-1.5">
        <Icon size={13} className="text-[var(--accent)]" />
        <span className="aq-eyebrow">{label}</span>
      </div>
      <div className="flex items-end gap-2">{children}</div>
      <div className="hidden text-[10.5px] leading-snug text-[var(--muted)] sm:block">{detail}</div>
    </div>
  );
}

export function KpiCards() {
  const summary = useSimStore((s) => s.summary);
  const readings = useSimStore((s) => s.readings);
  const sorted = [...readings].sort((a, b) => a.aqi - b.aqi);
  return (
    <div className="aq-scroll flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" role="group" aria-label="City-wide indicators">
      <Card icon={Activity} label="City-wide avg AQI" detail={<>Simple mean of {summary.zoneCount} zones · not population-weighted</>}>
        <span className="text-[28px] font-semibold leading-none tracking-tight">{summary.avgAqi}</span>
        <span className="pb-0.5">
          <AqiBadge aqi={summary.avgAqi} />
        </span>
      </Card>
      <Card
        icon={AlertTriangle}
        label="High-pollution zones"
        detail={
          <div className="flex flex-col gap-1.5">
            <div className="flex h-2 gap-[2px]" aria-label="Zones ordered by AQI">
              {sorted.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  title={`${z.name}: ${z.aqi} (${z.category})`}
                  aria-label={`${z.name}: AQI ${z.aqi}, ${z.category}`}
                  onClick={() => selectZone(z.id)}
                  className="h-full flex-1 rounded-[2px] transition-transform hover:scale-y-150"
                  style={{ background: getAqiBand(z.aqi).color }}
                />
              ))}
            </div>
            <span>Zones in Poor, Very Poor or Severe (AQI &gt; 200)</span>
          </div>
        }
      >
        <span className="text-[28px] font-semibold leading-none tracking-tight">{summary.highCount}</span>
        <span className="pb-0.5 text-[13px] text-[var(--muted)]">/ {summary.zoneCount}</span>
      </Card>
      <Card icon={Droplets} label="City-wide avg PM2.5" detail={<>Arithmetic mean of zone PM2.5 · simulated scenario</>}>
        <span className="text-[28px] font-semibold leading-none tracking-tight">{summary.avgPm25}</span>
        <span className="pb-0.5 text-[12px] text-[var(--muted)]">µg/m³</span>
      </Card>
    </div>
  );
}

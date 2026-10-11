"use client";

import { ArrowLeft, Building, ChevronDown, Droplets, Gauge, Thermometer, Wind, X } from "lucide-react";
import { CITY_REGIONS } from "@/data/city-regions";
import { LANDMARK_BY_ID } from "@/data/landmarks";
import { getAqiBand } from "@/lib/aqi";
import { BUILDING_KINDS, getCityModel } from "@/lib/city-generator";
import { REGION_LABEL, SOURCE_COLOR, SOURCE_LABEL, compass, formatScenarioTime } from "@/lib/formatting";
import { PRESET_BY_ID, TIME_STEPS } from "@/lib/simulation-engine";
import { useSelectedZoneId, useSimStore } from "@/store/simulation-store";
import type { SourceCategory, ZoneReading } from "@/types/air-quality";
import { SOURCE_ICON } from "../ui/source-icons";
import { AqiBadge, AqiGauge, AqiScale, AqiValue } from "../ui/Aqi";
import { WindArrow } from "./EnvironmentMenu";
import { ZoneTrendChart } from "./TrendChart";
import { flyToRegion, selectZone } from "./actions";

function Metric({ icon: Icon, label, value, unit }: { icon: typeof Gauge; label: string; value: React.ReactNode; unit?: string }) {
  return (
    <div className="rounded-[10px] border border-[var(--line)] px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--muted)]">
        <Icon size={12} />
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-[16px] font-semibold text-[var(--ink)]">{value}</span>
        {unit && <span className="text-[10.5px] text-[var(--muted)]">{unit}</span>}
      </div>
    </div>
  );
}

export function SourceChips({ sources }: { sources: SourceCategory[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((c) => {
        const Icon = SOURCE_ICON[c];
        return (
          <span key={c} className="aq-chip">
            <Icon size={12} style={{ color: SOURCE_COLOR[c] }} />
            {SOURCE_LABEL[c]}
          </span>
        );
      })}
    </div>
  );
}

function ProvenanceFooter({ zone }: { zone: ZoneReading }) {
  const preset = useSimStore((s) => s.preset);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--line)] pt-2.5 text-[10.5px] text-[var(--muted)]">
      <span className="aq-badge bg-[var(--amber-soft)] text-[var(--amber)]">{zone.provenance === "verified" ? "VERIFIED BASELINE" : "DEMO DATA"}</span>
      <span className="aq-badge bg-[var(--hover)] text-[var(--muted)]">SIMULATED</span>
      <span className="aq-num">
        Scenario time {formatScenarioTime(zone.timestamp)} IST · {PRESET_BY_ID[preset].label}
      </span>
    </div>
  );
}

function ZoneDetail({ zone }: { zone: ZoneReading }) {
  const trend = useSimStore((s) => s.trend);
  const timeIndex = useSimStore((s) => s.timeIndex);
  const band = getAqiBand(zone.aqi);
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-4">
        <AqiGauge aqi={zone.aqi} />
        <div className="min-w-0 flex-1 space-y-2">
          <AqiBadge aqi={zone.aqi} />
          <p className="text-[11.5px] leading-snug text-[var(--ink-2)]">{band.advice}</p>
          <p className="text-[10.5px] text-[var(--muted)]">Dominant pollutant: {zone.dominant}</p>
        </div>
      </div>
      <AqiScale aqi={zone.aqi} />
      <div className="grid grid-cols-2 gap-2">
        <Metric icon={Droplets} label="PM2.5" value={<span className="aq-num">{zone.pm25}</span>} unit="µg/m³" />
        <Metric icon={Gauge} label="PM10" value={<span className="aq-num">{zone.pm10}</span>} unit="µg/m³" />
        <Metric icon={Thermometer} label="Temperature" value={<span className="aq-num">{zone.temperature}</span>} unit="°C" />
        <Metric
          icon={Wind}
          label="Wind"
          value={
            <span className="inline-flex items-center gap-1.5">
              <WindArrow from={zone.windFrom} size={13} />
              <span className="aq-num">{zone.windSpeed}</span>
            </span>
          }
          unit={`m/s ${compass(zone.windFrom)}`}
        />
      </div>
      <div>
        <div className="aq-eyebrow mb-2">Representative sources</div>
        <SourceChips sources={zone.sources} />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="aq-eyebrow">AQI through the simulated day</span>
          <span className="text-[10px] text-[var(--faint)]">now {TIME_STEPS[timeIndex].label}</span>
        </div>
        <ZoneTrendChart trend={trend} zoneId={zone.id} currentIndex={timeIndex} />
      </div>
      <ProvenanceFooter zone={zone} />
    </div>
  );
}

function CityOverview() {
  const summary = useSimStore((s) => s.summary);
  const readings = useSimStore((s) => s.readings);
  const preset = useSimStore((s) => s.preset);
  const ranked = [...readings].sort((a, b) => b.aqi - a.aqi);
  const top = ranked.slice(0, 5);
  const best = ranked[ranked.length - 1];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="aq-eyebrow mb-2">Most polluted zones</div>
        <div className="flex flex-col gap-0.5">
          {top.map((z) => (
            <button key={z.id} type="button" className="aq-row !py-1.5" onClick={() => selectZone(z.id)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">{z.name}</span>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-[var(--hover)]">
                  <span className="block h-full rounded-full" style={{ width: `${(z.aqi / 500) * 100}%`, background: getAqiBand(z.aqi).color }} />
                </span>
              </span>
              <span className="aq-num w-8 text-right text-[12.5px] font-semibold">{z.aqi}</span>
              <AqiBadge aqi={z.aqi} compact />
            </button>
          ))}
        </div>
        {best && (
          <button type="button" className="aq-row mt-1 !py-1.5 text-[11.5px] text-[var(--muted)]" onClick={() => selectZone(best.id)}>
            <span className="flex-1">
              Cleanest: <span className="font-medium text-[var(--ink)]">{best.name}</span>
            </span>
            <AqiValue aqi={best.aqi} />
          </button>
        )}
      </div>
      <div>
        <div className="aq-eyebrow mb-2">Regions · simple mean</div>
        <div className="flex flex-col gap-0.5">
          {summary.regionAverages.map((r) => (
            <button key={r.region} type="button" className="aq-row !py-1.5" onClick={() => flyToRegion(r.region)}>
              <span className="flex-1 text-[12px] font-medium">{CITY_REGIONS.find((x) => x.id === r.region)?.name}</span>
              <span className="text-[10.5px] text-[var(--faint)]">{r.zoneCount} zones</span>
              <AqiValue aqi={r.avgAqi} />
            </button>
          ))}
        </div>
      </div>
      <p className="rounded-[10px] border border-[var(--line)] p-2.5 text-[11px] leading-relaxed text-[var(--muted)]">
        <span className="font-medium text-[var(--ink-2)]">{PRESET_BY_ID[preset].label}.</span> {PRESET_BY_ID[preset].description} Select any zone,
        landmark, building or source in the city to inspect it.
      </p>
    </div>
  );
}

function useHeader() {
  const selection = useSimStore((s) => s.selection);
  const readings = useSimStore((s) => s.readings);
  const sources = useSimStore((s) => s.sources);
  const zoneId = useSelectedZoneId();
  const zoneCount = useSimStore((s) => s.summary.zoneCount);
  const zone = readings.find((r) => r.id === zoneId) ?? null;
  if (!selection) return { eyebrow: "City overview", title: `Delhi · ${zoneCount} zones`, sub: "Stylised simulation", zone: null, extra: null };
  if (selection.kind === "zone" && zone) return { eyebrow: "Air-quality zone", title: zone.name, sub: REGION_LABEL[zone.region], zone, extra: null };
  if (selection.kind === "landmark") {
    const l = LANDMARK_BY_ID[selection.id];
    return {
      eyebrow: "Landmark",
      title: l?.name ?? "Landmark",
      sub: `${REGION_LABEL[l.region]} · in ${zone?.name ?? "—"}`,
      zone,
      extra: <p className="text-[12px] leading-relaxed text-[var(--ink-2)]">{l?.description}</p>,
    };
  }
  if (selection.kind === "source") {
    const s = sources.find((x) => x.id === selection.id);
    if (s) {
      const Icon = SOURCE_ICON[s.category];
      return {
        eyebrow: "Emission source",
        title: s.name,
        sub: `${SOURCE_LABEL[s.category]} · in ${zone?.name ?? "—"}`,
        zone,
        extra: (
          <div className="space-y-2.5 rounded-[10px] border border-[var(--line)] p-2.5">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-[8px]" style={{ background: `${SOURCE_COLOR[s.category]}1f`, color: SOURCE_COLOR[s.category] }}>
                <Icon size={15} />
              </span>
              <div className="flex-1">
                <div className="text-[12px] font-semibold">{SOURCE_LABEL[s.category]}</div>
                <div className="text-[11px] text-[var(--muted)]">{s.note}</div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10.5px] text-[var(--muted)]">
                <span>Activity index (demo, relative)</span>
                <span className="aq-num font-semibold text-[var(--ink)]">{s.activity.toFixed(2)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--hover)]">
                <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${s.activity * 100}%`, transition: "width 0.5s ease" }} />
              </div>
            </div>
          </div>
        ),
      };
    }
  }
  if (selection.kind === "building") {
    const b = getCityModel().buildings;
    const floors = Math.max(1, Math.round(b.h[selection.id] / 0.62));
    return {
      eyebrow: "Building",
      title: BUILDING_KINDS[b.kind[selection.id]],
      sub: `${REGION_LABEL[b.region[selection.id]]} · in ${zone?.name ?? "—"}`,
      zone,
      extra: (
        <div className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] p-2.5 text-[12px] text-[var(--ink-2)]">
          <Building size={14} className="text-[var(--muted)]" />
          <span>
            Approx. {floors} floor{floors > 1 ? "s" : ""} · procedurally generated — readings below are for the surrounding zone.
          </span>
        </div>
      ),
    };
  }
  return { eyebrow: "City overview", title: "Delhi", sub: "", zone: null, extra: null };
}

export function SelectedZonePanel({ mobile = false }: { mobile?: boolean }) {
  const select = useSimStore((s) => s.select);
  const resetView = useSimStore((s) => s.resetView);
  const selection = useSimStore((s) => s.selection);
  const header = useHeader();
  return (
    <section
      className={`aq-panel pointer-events-auto flex flex-col overflow-hidden ${mobile ? "max-h-[58dvh] rounded-b-none" : "max-h-full"}`}
      aria-label={header.eyebrow}
    >
      {mobile && (
        <button type="button" className="mx-auto mt-1.5 h-1 w-10 rounded-full bg-[var(--line-strong)]" aria-label="Close details" onClick={() => select(null)} />
      )}
      <div className="flex items-start gap-2 px-4 pb-3 pt-3.5">
        <div className="min-w-0 flex-1">
          <div className="aq-eyebrow mb-1.5">{header.eyebrow}</div>
          <h2 className="truncate text-[17px] font-semibold leading-tight tracking-tight">{header.title}</h2>
          {header.sub && <div className="mt-0.5 truncate text-[11.5px] text-[var(--muted)]">{header.sub}</div>}
        </div>
        {selection && (
          <>
            <button type="button" className="aq-icon-btn" title="Back to city overview" aria-label="Back to city overview" onClick={resetView}>
              <ArrowLeft size={15} />
            </button>
            <button type="button" className="aq-icon-btn" title="Deselect (Esc)" aria-label="Deselect" onClick={() => select(null)}>
              {mobile ? <ChevronDown size={16} /> : <X size={15} />}
            </button>
          </>
        )}
      </div>
      <div className="aq-scroll flex-1 space-y-3.5 px-4 pb-4">
        {header.extra}
        {header.zone ? (
          <>
            {selection?.kind !== "zone" && (
              <button type="button" className="aq-row !px-0 !py-0 text-[11px] font-medium text-[var(--accent)] hover:!bg-transparent" onClick={() => selectZone(header.zone!.id)}>
                Zone · {header.zone.name} →
              </button>
            )}
            <ZoneDetail zone={header.zone} />
          </>
        ) : (
          <CityOverview />
        )}
      </div>
    </section>
  );
}

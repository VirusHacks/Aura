"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp } from "lucide-react";
import { getAqiBand } from "@/lib/aqi";
import { REGION_LABEL, SOURCE_COLOR, SOURCE_LABEL } from "@/lib/formatting";
import { TIME_STEPS } from "@/lib/simulation-engine";
import { useSelectedZoneId, useSimStore, type BottomTab } from "@/store/simulation-store";
import type { ZoneReading } from "@/types/air-quality";
import { SOURCE_ICON } from "../ui/source-icons";
import { AqiBadge, AqiValue } from "../ui/Aqi";
import { CityTrendChart } from "./TrendChart";
import { selectSource, selectZone } from "./actions";

type SortKey = "name" | "region" | "aqi" | "pm25" | "pm10";

function SortHeader({ label, k, sort, setSort, align = "left" }: { label: string; k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; setSort: (s: { key: SortKey; dir: 1 | -1 }) => void; align?: "left" | "right" }) {
  const active = sort.key === k;
  return (
    <th style={{ textAlign: align }} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 uppercase tracking-[0.08em] ${active ? "text-[var(--ink)]" : ""}`}
        onClick={() => setSort({ key: k, dir: active ? (sort.dir === 1 ? -1 : 1) : k === "name" || k === "region" ? 1 : -1 })}
      >
        {label}
        {active && (sort.dir === 1 ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
      </button>
    </th>
  );
}

function ZoneTable() {
  const readings = useSimStore((s) => s.readings);
  const setHovered = useSimStore((s) => s.setHoveredZone);
  const selectedId = useSelectedZoneId();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "aqi", dir: -1 });
  const rows = useMemo(() => {
    const get = (r: ZoneReading) => (sort.key === "name" ? r.name : sort.key === "region" ? REGION_LABEL[r.region] : r[sort.key]);
    return [...readings].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      return (typeof x === "string" ? x.localeCompare(String(y)) : x - Number(y)) * sort.dir;
    });
  }, [readings, sort]);
  return (
    <table className="aq-table">
      <thead>
        <tr>
          <SortHeader label="Zone" k="name" sort={sort} setSort={setSort} />
          <SortHeader label="Region" k="region" sort={sort} setSort={setSort} />
          <SortHeader label="AQI" k="aqi" sort={sort} setSort={setSort} align="right" />
          <th>Category</th>
          <SortHeader label="PM2.5" k="pm25" sort={sort} setSort={setSort} align="right" />
          <SortHeader label="PM10" k="pm10" sort={sort} setSort={setSort} align="right" />
        </tr>
      </thead>
      <tbody onMouseLeave={() => setHovered(null)}>
        {rows.map((r) => (
          <tr
            key={r.id}
            aria-selected={r.id === selectedId}
            tabIndex={0}
            onClick={() => selectZone(r.id)}
            onKeyDown={(e) => e.key === "Enter" && selectZone(r.id)}
            onMouseEnter={() => setHovered(r.id)}
          >
            <td className="font-medium !text-[var(--ink)]">{r.name}</td>
            <td>{REGION_LABEL[r.region]}</td>
            <td style={{ textAlign: "right" }}>
              <AqiValue aqi={r.aqi} />
            </td>
            <td>
              <AqiBadge aqi={r.aqi} />
            </td>
            <td className="aq-num" style={{ textAlign: "right" }}>
              {r.pm25}
            </td>
            <td className="aq-num" style={{ textAlign: "right" }}>
              {r.pm10}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourceTable() {
  const sources = useSimStore((s) => s.sources);
  const readings = useSimStore((s) => s.readings);
  const selection = useSimStore((s) => s.selection);
  const rows = useMemo(() => [...sources].sort((a, b) => b.activity - a.activity), [sources]);
  return (
    <table className="aq-table">
      <thead>
        <tr>
          <th>Source</th>
          <th>Category</th>
          <th>Zone</th>
          <th style={{ textAlign: "right" }}>Activity (demo)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => {
          const Icon = SOURCE_ICON[s.category];
          return (
            <tr key={s.id} aria-selected={selection?.kind === "source" && selection.id === s.id} tabIndex={0} onClick={() => selectSource(s.id)} onKeyDown={(e) => e.key === "Enter" && selectSource(s.id)}>
              <td className="font-medium !text-[var(--ink)]">{s.name}</td>
              <td>
                <span className="inline-flex items-center gap-1.5">
                  <Icon size={12} style={{ color: SOURCE_COLOR[s.category] }} />
                  {SOURCE_LABEL[s.category]}
                </span>
              </td>
              <td>{readings.find((r) => r.id === s.zoneId)?.name ?? "—"}</td>
              <td style={{ textAlign: "right" }}>
                <span className="inline-flex items-center gap-2">
                  <span className="h-1 w-14 overflow-hidden rounded-full bg-[var(--hover)]">
                    <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${s.activity * 100}%` }} />
                  </span>
                  <span className="aq-num w-7 text-right">{s.activity.toFixed(2)}</span>
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TrendsView() {
  const trend = useSimStore((s) => s.trend);
  const readings = useSimStore((s) => s.readings);
  const timeIndex = useSimStore((s) => s.timeIndex);
  const setTimeIndex = useSimStore((s) => s.setTimeIndex);
  const selectedId = useSelectedZoneId();
  const zones = useMemo(() => [...readings].sort((a, b) => b.aqi - a.aqi), [readings]);
  const ids = useMemo(() => readings.map((r) => r.id), [readings]);
  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full border-separate border-spacing-[2px] text-[11px]" aria-label="AQI per zone across the simulated day">
          <thead>
            <tr>
              <th className="sticky left-0 bg-[var(--panel-solid)] pr-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Zone</th>
              {TIME_STEPS.map((t) => (
                <th key={t.index} className="px-0.5 pb-1 text-[10px] font-medium text-[var(--muted)]">
                  <button type="button" onClick={() => setTimeIndex(t.index)} className={`aq-num rounded px-1 ${t.index === timeIndex ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-strong)]" : "hover:text-[var(--ink)]"}`}>
                    {t.label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id} className="cursor-pointer" onClick={() => selectZone(z.id)}>
                <td className={`sticky left-0 max-w-[150px] truncate bg-[var(--panel-solid)] pr-2 ${z.id === selectedId ? "font-semibold text-[var(--accent-strong)]" : "text-[var(--ink-2)]"}`}>{z.name}</td>
                {TIME_STEPS.map((t) => {
                  const v = Number(trend[t.index]?.[z.id] ?? 0);
                  const band = getAqiBand(v);
                  return (
                    <td
                      key={t.index}
                      title={`${z.name} · ${t.label}: AQI ${v} (${band.category}) — simulated`}
                      className={`aq-num h-[22px] min-w-[34px] rounded-[4px] text-center font-semibold transition hover:brightness-110 ${t.index === timeIndex ? "ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--panel-solid)]" : ""}`}
                      style={{ background: band.color, color: band.ink }}
                    >
                      {v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="min-w-0">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="aq-eyebrow">City mean & zone range</span>
          <span className="text-[10px] text-[var(--faint)]">simple mean · simulated</span>
        </div>
        <CityTrendChart trend={trend} zoneIds={ids} currentIndex={timeIndex} />
        <p className="mt-1 text-[10.5px] leading-snug text-[var(--muted)]">
          Line: mean of all zones. Band: cleanest to worst zone at each step. Values come from the same scenario model as the map.
        </p>
      </div>
    </div>
  );
}

const TABS: { id: BottomTab; label: string }[] = [
  { id: "zones", label: "Zones" },
  { id: "sources", label: "Sources" },
  { id: "trends", label: "Trends" },
];

export function BottomPanel() {
  const tab = useSimStore((s) => s.bottomTab);
  const setTab = useSimStore((s) => s.setBottomTab);
  const open = useSimStore((s) => s.bottomOpen);
  const setOpen = useSimStore((s) => s.setBottomOpen);
  const zoneCount = useSimStore((s) => s.readings.length);
  const sourceCount = useSimStore((s) => s.sources.length);
  const counts = { zones: zoneCount, sources: sourceCount };
  return (
    <section className="aq-panel pointer-events-auto flex flex-col overflow-hidden" aria-label="City data">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <div role="tablist" aria-label="Data views" className="flex gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`aq-btn !h-7 !px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${tab === t.id && open ? "is-active" : ""}`}
              onClick={() => (tab === t.id && open ? setOpen(false) : setTab(t.id))}
            >
              {t.label}
              {t.id !== "trends" && <span className="aq-num text-[10px] font-medium text-[var(--faint)]">{counts[t.id]}</span>}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="hidden text-[10.5px] text-[var(--faint)] sm:inline">Demo data · simulated scenario</span>
        <button type="button" className="aq-icon-btn !h-7 !w-7" aria-label={open ? "Collapse data panel" : "Expand data panel"} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
      </div>
      {open && (
        <div className="aq-scroll max-h-[min(212px,28dvh)] border-t border-[var(--line)]" role="tabpanel">
          {tab === "zones" && <ZoneTable />}
          {tab === "sources" && <SourceTable />}
          {tab === "trends" && <TrendsView />}
        </div>
      )}
    </section>
  );
}

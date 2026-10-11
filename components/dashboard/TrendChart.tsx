"use client";

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AQI_BANDS, getAqiBand } from "@/lib/aqi";
import type { TrendPoint } from "@/lib/simulation-engine";

const AXIS = { fontSize: 10, fill: "var(--muted)" };

interface TipRow {
  value: number;
  label: string;
  color?: string;
}

function TipBox({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div className="aq-panel-strong min-w-[140px] px-2.5 py-2 text-[11px]">
      <div className="mb-1 text-[10px] font-semibold tracking-[0.08em] text-[var(--muted)]">{title} · SIMULATED</div>
      {rows.map((r) => {
        const band = getAqiBand(r.value);
        return (
          <div key={r.label} className="flex items-center gap-2 py-0.5">
            <span className="h-[2px] w-3 rounded-full" style={{ background: r.color ?? band.color }} />
            <span className="aq-num text-[13px] font-semibold text-[var(--ink)]">{r.value}</span>
            <span className="text-[var(--muted)]">{r.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function BandBackdrop() {
  return (
    <>
      {AQI_BANDS.map((b) => (
        <ReferenceArea key={b.category} y1={b.min} y2={b.max + 1} fill={b.color} fillOpacity={0.07} strokeOpacity={0} ifOverflow="hidden" />
      ))}
    </>
  );
}

/** AQI of one zone across the simulated day (single series: no legend). */
export function ZoneTrendChart({ trend, zoneId, currentIndex, height = 132 }: { trend: TrendPoint[]; zoneId: string; currentIndex: number; height?: number }) {
  const data = useMemo(() => trend.map((p) => ({ label: p.label, period: p.period, aqi: Number(p[zoneId] ?? 0) })), [trend, zoneId]);
  const max = Math.max(...data.map((d) => d.aqi));
  const yMax = Math.min(500, Math.ceil((max + 40) / 100) * 100);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height={height} minWidth={0} initialDimension={{ width: 300, height }}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="aq-zone-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <BandBackdrop />
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="0" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval={1} />
          <YAxis domain={[0, yMax]} ticks={[0, 100, 200, 300, 400, 500].filter((t) => t <= yMax)} tick={AXIS} tickLine={false} axisLine={false} width={44} />
          <ReferenceLine x={data[currentIndex]?.label} stroke="var(--accent)" strokeWidth={1} />
          <Tooltip
            cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? <TipBox title={String(label)} rows={[{ value: Number(payload[0].value), label: getAqiBand(Number(payload[0].value)).category }]} /> : null
            }
          />
          <Area
            type="monotone"
            dataKey="aqi"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#aq-zone-area)"
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; payload?: { aqi: number }; index?: number }) => (
              <circle
                key={props.index}
                cx={props.cx}
                cy={props.cy}
                r={props.index === currentIndex ? 5.5 : 4}
                fill={getAqiBand(props.payload?.aqi ?? 0).color}
                stroke="var(--panel-solid)"
                strokeWidth={2}
              />
            )}
            activeDot={{ r: 6, stroke: "var(--panel-solid)", strokeWidth: 2, fill: "var(--accent)" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** City mean with the zone min–max envelope across the simulated day. */
export function CityTrendChart({ trend, zoneIds, currentIndex, height = 170 }: { trend: TrendPoint[]; zoneIds: string[]; currentIndex: number; height?: number }) {
  const data = useMemo(
    () =>
      trend.map((p) => {
        const values = zoneIds.map((id) => Number(p[id] ?? 0));
        return { label: p.label, city: Number(p.city), range: [Math.min(...values), Math.max(...values)] as [number, number] };
      }),
    [trend, zoneIds],
  );
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height={height} minWidth={0} initialDimension={{ width: 300, height }}>
        <ComposedChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -18 }}>
          <BandBackdrop />
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 500]} ticks={[0, 100, 200, 300, 400, 500]} tick={AXIS} tickLine={false} axisLine={false} width={44} />
          <ReferenceLine x={data[currentIndex]?.label} stroke="var(--accent)" strokeWidth={1} />
          <Tooltip
            cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof data)[number];
              return (
                <TipBox
                  title={String(label)}
                  rows={[
                    { value: d.city, label: "City mean", color: "var(--accent)" },
                    { value: d.range[1], label: "Worst zone", color: "var(--muted)" },
                    { value: d.range[0], label: "Cleanest zone", color: "var(--muted)" },
                  ]}
                />
              );
            }}
          />
          <Area type="monotone" dataKey="range" stroke="none" fill="var(--muted)" fillOpacity={0.12} isAnimationActive={false} />
          <Line type="monotone" dataKey="city" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4, fill: "var(--accent)", stroke: "var(--panel-solid)", strokeWidth: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

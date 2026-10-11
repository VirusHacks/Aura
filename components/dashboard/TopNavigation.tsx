"use client";

import { useState } from "react";
import { Bell, Clock3, HelpCircle, Map, Menu, Moon, Search, Sun, Sunrise, Sunset, X } from "lucide-react";
import { CITY_REGIONS } from "@/data/city-regions";
import { getAqiBand } from "@/lib/aqi";
import { resolveLighting } from "@/lib/lighting";
import { TIME_STEPS } from "@/lib/simulation-engine";
import { useSimStore } from "@/store/simulation-store";
import type { LightingMode } from "@/types/scene";
import { AqiValue } from "../ui/Aqi";
import { Popover } from "../ui/Popover";
import { flyToRegion, selectZone } from "./actions";
import { EnvironmentMenu, EnvironmentPanel } from "./EnvironmentMenu";
import { LayerList, LayerMenu } from "./LayerMenu";
import { SearchBox } from "./SearchBox";

export function Logo() {
  return (
    <div className="flex items-center gap-2.5 pr-1">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <circle cx="13" cy="13" r="11.5" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
        <path d="M5 15.5c2.4-2.6 4.6-2.6 7 0s4.6 2.6 7 0" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M7 10.5c2-2 4-2 6 0s4 2 6 0" fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
      </svg>
      <div className="whitespace-nowrap leading-none">
        <div className="text-[13.5px] font-bold tracking-[0.18em] text-[var(--ink)]">AEROSCOPE</div>
        <div className="mt-[3px] text-[8px] font-semibold tracking-[0.16em] text-[var(--muted)] sm:text-[8.5px] sm:tracking-[0.2em]">DELHI AIR INTELLIGENCE</div>
      </div>
    </div>
  );
}

function RegionList({ onPick }: { onPick: () => void }) {
  const summary = useSimStore((s) => s.summary);
  return (
    <div className="flex flex-col">
      <div className="aq-eyebrow px-2.5 pb-1.5 pt-2">Fly to region</div>
      {CITY_REGIONS.map((r) => {
        const avg = summary.regionAverages.find((x) => x.region === r.id);
        return (
          <button
            key={r.id}
            type="button"
            className="aq-row items-start"
            onClick={() => {
              flyToRegion(r.id);
              onPick();
            }}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{r.name}</span>
              <span className="line-clamp-2 block text-[11px] leading-snug text-[var(--muted)]">{r.description}</span>
            </span>
            {avg && (
              <span className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5">
                <AqiValue aqi={avg.avgAqi} />
                <span className="text-[10px] text-[var(--faint)]">{avg.zoneCount} zones</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function RegionMenu() {
  return (
    <Popover
      label="City regions"
      width={360}
      trigger={
        <>
          <Map size={15} />
          <span className="hidden lg:inline">Regions</span>
        </>
      }
    >
      {(close) => <RegionList onPick={close} />}
    </Popover>
  );
}

function TimeChip() {
  const timeIndex = useSimStore((s) => s.timeIndex);
  const playing = useSimStore((s) => s.playing);
  const step = TIME_STEPS[timeIndex];
  return (
    <div className="hidden h-8 items-center gap-2 rounded-[9px] border border-[var(--line)] px-2.5 text-[12px] md:flex" title="Simulated scenario time">
      <Clock3 size={14} className={`text-[var(--accent)] ${playing ? "aq-pulse" : ""}`} />
      <span className="aq-num font-semibold text-[var(--ink)]">{step.label}</span>
      <span className="hidden text-[var(--muted)] lg:inline">{step.period}</span>
      <span className="aq-badge bg-[var(--hover)] text-[9.5px] tracking-[0.08em] text-[var(--muted)]">SIM</span>
    </div>
  );
}

function AlertList({ onPick }: { onPick: () => void }) {
  const readings = useSimStore((s) => s.readings);
  const alerts = readings.filter((r) => r.aqi > 300).sort((a, b) => b.aqi - a.aqi);
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-2.5 pb-1.5 pt-2">
        <span className="aq-eyebrow">Very Poor & Severe zones</span>
        <span className="text-[10px] text-[var(--faint)]">simulated</span>
      </div>
      {alerts.length === 0 && <p className="px-2.5 py-3 text-[12px] text-[var(--muted)]">No zone is above AQI 300 in this scenario.</p>}
      {alerts.map((z) => {
        const band = getAqiBand(z.aqi);
        return (
          <button
            key={z.id}
            type="button"
            className="aq-row"
            onClick={() => {
              selectZone(z.id);
              onPick();
            }}
          >
            <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: band.color }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{z.name}</span>
              <span className="block text-[11px] text-[var(--muted)]">
                {band.category} · PM2.5 {z.pm25} µg/m³
              </span>
            </span>
            <span className="aq-num text-[13px] font-semibold">{z.aqi}</span>
          </button>
        );
      })}
    </div>
  );
}

function AlertsMenu() {
  const count = useSimStore((s) => s.readings.filter((r) => r.aqi > 300).length);
  return (
    <Popover
      label={`${count} air-quality alerts`}
      width={300}
      align="right"
      className="aq-icon-btn relative"
      trigger={
        <>
          <Bell size={15} />
          {count > 0 && (
            <span className="aq-num absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#e03131] px-1 text-[9.5px] font-bold text-white ring-2 ring-[var(--panel-solid)]">
              {count}
            </span>
          )}
        </>
      }
    >
      {(close) => <AlertList onPick={close} />}
    </Popover>
  );
}

const LIGHTING_OPTIONS: { id: LightingMode; label: string; icon: typeof Sun; hint: string }[] = [
  { id: "auto", label: "Follow clock", icon: Sunrise, hint: "Lighting tracks simulated time" },
  { id: "day", label: "Day", icon: Sun, hint: "Bright sky, soft shadows" },
  { id: "sunset", label: "Sunset", icon: Sunset, hint: "Warm, low sun" },
  { id: "night", label: "Night", icon: Moon, hint: "Street & window lights" },
];

export function LightingList({ onPick }: { onPick?: () => void }) {
  const mode = useSimStore((s) => s.lighting);
  const setLighting = useSimStore((s) => s.setLighting);
  return (
    <div role="radiogroup" aria-label="Lighting" className="flex flex-col">
      <div className="aq-eyebrow px-2.5 pb-1.5 pt-2">Day / night</div>
      {LIGHTING_OPTIONS.map(({ id, label, icon: Icon, hint }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={mode === id}
          className="aq-row"
          onClick={() => {
            setLighting(id);
            onPick?.();
          }}
        >
          <Icon size={15} className="shrink-0 text-[var(--muted)]" />
          <span className="flex-1">
            <span className="block font-medium">{label}</span>
            <span className="block text-[11px] text-[var(--muted)]">{hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function LightingMenu() {
  const mode = useSimStore((s) => s.lighting);
  const timeIndex = useSimStore((s) => s.timeIndex);
  const resolved = resolveLighting(mode, timeIndex);
  const Icon = resolved === "night" ? Moon : resolved === "sunset" ? Sunset : Sun;
  return (
    <Popover label="Day and night lighting" width={250} align="right" className={`aq-icon-btn${mode !== "auto" ? " is-active" : ""}`} trigger={<Icon size={15} />}>
      {(close) => <LightingList onPick={close} />}
    </Popover>
  );
}

export function DataStatus() {
  const dataset = useSimStore((s) => s.dataset);
  const status = useSimStore((s) => s.datasetStatus);
  const message = useSimStore((s) => s.datasetMessage);
  const verified = dataset.provenance === "verified";
  return (
    <Popover
      label="Data status"
      width={320}
      align="right"
      className={`aq-status${verified ? " !text-[#2f9e44]" : ""}`}
      trigger={
        <>
          <span className={`aq-status__dot ${status === "loading" ? "aq-pulse" : ""}`} />
          <span className="whitespace-nowrap">
            {verified ? "Verified" : "Demo"}
            <span className="hidden sm:inline"> data</span>
          </span>
        </>
      }
    >
      {() => (
        <div className="space-y-2 p-2.5 text-[12px] leading-relaxed text-[var(--ink-2)]">
          <p className="aq-eyebrow">Data provenance</p>
          <p>
            <strong className="text-[var(--ink)]">{dataset.sourceLabel}.</strong>{" "}
            {verified
              ? "Baselines come from a configured verified provider."
              : "Values are hand-authored and deterministic. They are not official or live readings."}
          </p>
          <p>All readings shown are derived through the simulated scenario model (time of day × atmosphere preset), so they are labelled SIMULATED.</p>
          <p className="text-[11px] text-[var(--muted)]">
            API status:{" "}
            {status === "ready" ? "loaded from /api/air-quality/zones" : status === "loading" ? "loading…" : status === "error" ? `unavailable — using bundled data (${message ?? "error"})` : "bundled dataset"}
          </p>
          <p className="text-[11px] text-[var(--muted)]">City geometry is a stylised, schematic layout — not survey accurate.</p>
        </div>
      )}
    </Popover>
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  const setHelpOpen = useSimStore((s) => s.setHelpOpen);
  return (
    <>
      <button type="button" className="aq-icon-btn md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
        <Menu size={17} />
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-black/20" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="aq-panel-strong aq-rise aq-scroll absolute inset-x-3 top-3 max-h-[calc(100dvh-24px)] p-1.5">
            <div className="flex items-center justify-between px-2 py-1.5">
              <Logo />
              <button type="button" className="aq-icon-btn" aria-label="Close menu" onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <RegionList onPick={() => setOpen(false)} />
            <div className="aq-divider my-1" />
            <LayerList />
            <div className="aq-divider my-1" />
            <EnvironmentPanel />
            <div className="aq-divider my-1" />
            <LightingList />
            <div className="aq-divider my-1" />
            <AlertList onPick={() => setOpen(false)} />
            <div className="aq-divider my-1" />
            <button
              type="button"
              className="aq-row"
              onClick={() => {
                setOpen(false);
                setHelpOpen(true);
              }}
            >
              <HelpCircle size={15} className="text-[var(--muted)]" />
              <span className="font-medium">Help & navigation guide</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function TopNavigation() {
  const setHelpOpen = useSimStore((s) => s.setHelpOpen);
  const [mobileSearch, setMobileSearch] = useState(false);
  return (
    <header className="aq-panel pointer-events-auto absolute inset-x-3 top-3 z-40 flex h-[52px] items-center gap-1.5 px-2.5 sm:gap-2">
      <Logo />
      <div className="mx-1 hidden h-6 w-px bg-[var(--line)] md:block" />
      <div className="hidden w-[min(300px,26vw)] md:block">
        <SearchBox />
      </div>
      <div className="hidden md:block">
        <RegionMenu />
      </div>
      <div className="flex-1" />
      <div className="hidden items-center gap-1 md:flex">
        <LayerMenu />
        <EnvironmentMenu />
      </div>
      <TimeChip />
      <div className="hidden md:block">
        <AlertsMenu />
      </div>
      <div className="hidden md:block">
        <LightingMenu />
      </div>
      <DataStatus />
      <button type="button" className="aq-icon-btn hidden md:inline-grid" aria-label="Help and navigation guide" onClick={() => setHelpOpen(true)}>
        <HelpCircle size={15} />
      </button>
      <button type="button" className="aq-icon-btn md:hidden" aria-label="Search" onClick={() => setMobileSearch((v) => !v)}>
        <Search size={16} />
      </button>
      <MobileMenu />
      {mobileSearch && (
        <div className="aq-panel-strong aq-rise absolute inset-x-0 top-[calc(100%+8px)] p-2 md:hidden">
          <SearchBox autoFocus onDone={() => setMobileSearch(false)} />
        </div>
      )}
    </header>
  );
}

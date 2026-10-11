"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { resolveLighting } from "@/lib/lighting";
import { parseZoneDataset } from "@/lib/zone-schema";
import { useSimStore } from "@/store/simulation-store";
import { AqiLegend, MapControls } from "./dashboard/AqiLegend";
import { BottomPanel } from "./dashboard/BottomPanel";
import { GestureHint, HelpPanel } from "./dashboard/HelpPanel";
import { KpiCards } from "./dashboard/KpiCards";
import { LoadingScreen } from "./dashboard/LoadingScreen";
import { QuickNav } from "./dashboard/QuickNav";
import { SceneLabels } from "./dashboard/SceneLabels";
import { SelectedZonePanel } from "./dashboard/SelectedZonePanel";
import { TimelineControls } from "./dashboard/TimelineControls";
import { TopNavigation } from "./dashboard/TopNavigation";

// The WebGL scene is client-only and code-split away from the dashboard.
const CityCanvas = dynamic(() => import("./world/CityCanvas"), { ssr: false });

function useDataset() {
  const setDataset = useSimStore((s) => s.setDataset);
  const setStatus = useSimStore((s) => s.setDatasetStatus);
  useEffect(() => {
    const ctrl = new AbortController();
    setStatus("loading");
    fetch("/api/air-quality/zones", { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { fallbackReason?: string };
        setDataset(parseZoneDataset(body), "ready", body.fallbackReason ?? null);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setStatus("error", err instanceof Error ? err.message : "Failed to load");
      });
    return () => ctrl.abort();
  }, [setDataset, setStatus]);
}

function useGlobalEffects() {
  const lighting = useSimStore((s) => s.lighting);
  const timeIndex = useSimStore((s) => s.timeIndex);
  const resolved = resolveLighting(lighting, timeIndex);

  useEffect(() => {
    let stored = false;
    try {
      stored = window.localStorage.getItem("aeroscope-ui") !== null;
    } catch {
      stored = false;
    }
    void Promise.resolve(useSimStore.persist.rehydrate()).then(() => {
      // Respect the OS preference unless the viewer already chose a setting.
      if (!stored && window.matchMedia("(prefers-reduced-motion: reduce)").matches) useSimStore.getState().setReducedMotion(true);
    });
    if (window.matchMedia("(max-width: 767px)").matches) useSimStore.getState().setBottomOpen(false);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.lighting = resolved;
  }, [resolved]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const s = useSimStore.getState();
      if (s.helpOpen) s.setHelpOpen(false);
      else if (s.selection) s.select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return resolved;
}

export default function AeroscopeApp() {
  useDataset();
  const lighting = useGlobalEffects();
  const hasSelection = useSimStore((s) => s.selection !== null);

  return (
    <main className="fixed inset-0 overflow-hidden">
      <div className="aq-sky" aria-hidden>
        <div className="aq-sky__day" style={{ opacity: lighting === "day" ? 1 : 0 }} />
        <div className="aq-sky__sunset" style={{ opacity: lighting === "sunset" ? 1 : 0 }} />
        <div className="aq-sky__night" style={{ opacity: lighting === "night" ? 1 : 0 }} />
      </div>

      <div className="absolute inset-0 z-10">
        <CityCanvas />
      </div>

      {/* 3D-anchored labels: plain DOM, positioned each frame by the scene. */}
      <div className="pointer-events-none absolute inset-0 z-[15] overflow-hidden">
        <SceneLabels />
      </div>

      {/* HUD: the container ignores the pointer so the city stays draggable between panels. */}
      <div className="pointer-events-none absolute inset-0 z-20">
        <TopNavigation />

        <div className="absolute left-3 right-3 top-[76px] md:right-auto md:w-auto">
          <KpiCards />
        </div>

        <div className="absolute left-3 top-[188px] hidden lg:block">
          <QuickNav />
        </div>

        {/* Right detail panel (desktop) */}
        <div className="absolute bottom-[112px] right-3 top-[76px] hidden w-[352px] flex-col justify-start md:flex">
          <SelectedZonePanel />
        </div>

        {/* Bottom dock */}
        <div className="absolute bottom-3 left-3 right-3 flex flex-col gap-2 md:right-[376px] md:max-w-[780px]">
          <TimelineControls />
          <BottomPanel />
        </div>

        {/* Legend + camera controls */}
        <div className="absolute bottom-3 right-3 hidden w-[352px] md:block">
          <AqiLegend />
        </div>
        <div className="absolute right-[376px] top-[76px] hidden md:block">
          <MapControls />
        </div>

        {/* Mobile bottom sheet for details */}
        {hasSelection && (
          <div className="aq-rise absolute inset-x-0 bottom-0 z-30 md:hidden">
            <SelectedZonePanel mobile />
          </div>
        )}

        <GestureHint />
        <HelpPanel />
      </div>

      <LoadingScreen />
    </main>
  );
}

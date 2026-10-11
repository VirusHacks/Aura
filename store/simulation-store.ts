"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEMO_DATASET } from "../data/demo-zones";
import { LANDMARK_BY_ID } from "../data/landmarks";
import { POLLUTION_SOURCES } from "../data/pollution-sources";
import { DEFAULT_VIEW, type ZoomLevel } from "../lib/camera-presets";
import {
  computeReadings,
  computeSourceReadings,
  computeTrend,
  summarize,
  type CitySummary,
  type TrendPoint,
} from "../lib/simulation-engine";
import type { ScenarioPresetId, SourceReading, ZoneDataset, ZoneReading } from "../types/air-quality";
import type { CameraView, LayerId, LightingMode, Selection } from "../types/scene";

export type DatasetStatus = "bundled" | "loading" | "ready" | "error";
export type BottomTab = "zones" | "sources" | "trends";

export interface CameraRequest {
  view: CameraView;
  nonce: number;
}

interface Derived {
  readings: ZoneReading[];
  sources: SourceReading[];
  summary: CitySummary;
  trend: TrendPoint[];
}

export interface SimulationState extends Derived {
  dataset: ZoneDataset;
  datasetStatus: DatasetStatus;
  datasetMessage: string | null;
  timeIndex: number;
  playing: boolean;
  preset: ScenarioPresetId;
  lighting: LightingMode;
  layers: Record<LayerId, boolean>;
  selection: Selection | null;
  hoveredZoneId: string | null;
  hoveredLandmarkId: string | null;
  cameraRequest: CameraRequest | null;
  zoomLevel: ZoomLevel;
  reducedMotion: boolean;
  bottomOpen: boolean;
  bottomTab: BottomTab;
  helpOpen: boolean;
  sceneReady: boolean;

  setDataset: (dataset: ZoneDataset, status: DatasetStatus, message?: string | null) => void;
  setDatasetStatus: (status: DatasetStatus, message?: string | null) => void;
  setTimeIndex: (i: number) => void;
  stepTime: () => void;
  setPlaying: (p: boolean) => void;
  resetTimeline: () => void;
  setPreset: (p: ScenarioPresetId) => void;
  setLighting: (l: LightingMode) => void;
  toggleLayer: (id: LayerId) => void;
  select: (s: Selection | null, view?: CameraView) => void;
  setHoveredZone: (id: string | null) => void;
  setHoveredLandmark: (id: string | null) => void;
  flyTo: (view: CameraView) => void;
  resetView: () => void;
  setZoomLevel: (z: ZoomLevel) => void;
  setReducedMotion: (v: boolean) => void;
  setBottomOpen: (v: boolean) => void;
  setBottomTab: (t: BottomTab) => void;
  setHelpOpen: (v: boolean) => void;
  setSceneReady: (v: boolean) => void;
}

const DEFAULT_LAYERS: Record<LayerId, boolean> = {
  heatmap: true,
  labels: true,
  sources: true,
  plumes: true,
  wind: true,
  traffic: true,
  boundaries: false,
};

function derive(dataset: ZoneDataset, timeIndex: number, preset: ScenarioPresetId): Derived {
  const readings = computeReadings(dataset, timeIndex, preset);
  return {
    readings,
    sources: computeSourceReadings(POLLUTION_SOURCES, timeIndex, preset),
    summary: summarize(readings),
    trend: computeTrend(dataset, preset),
  };
}

const INITIAL_TIME = 3;
const INITIAL_PRESET: ScenarioPresetId = "traffic-haze";

let nonce = 0;

export const useSimStore = create<SimulationState>()(
  persist(
    (set, get) => ({
      dataset: DEMO_DATASET,
      datasetStatus: "bundled",
      datasetMessage: null,
      timeIndex: INITIAL_TIME,
      playing: false,
      preset: INITIAL_PRESET,
      lighting: "auto",
      layers: DEFAULT_LAYERS,
      selection: null,
      hoveredZoneId: null,
      hoveredLandmarkId: null,
      cameraRequest: null,
      zoomLevel: "far",
      reducedMotion: false,
      bottomOpen: true,
      bottomTab: "zones",
      helpOpen: false,
      sceneReady: false,
      ...derive(DEMO_DATASET, INITIAL_TIME, INITIAL_PRESET),

      setDataset: (dataset, status, message = null) =>
        set((s) => ({ dataset, datasetStatus: status, datasetMessage: message, ...derive(dataset, s.timeIndex, s.preset) })),
      setDatasetStatus: (status, message = null) => set({ datasetStatus: status, datasetMessage: message }),
      setTimeIndex: (i) => set((s) => ({ timeIndex: i, ...derive(s.dataset, i, s.preset) })),
      stepTime: () => {
        const i = (get().timeIndex + 1) % 8;
        get().setTimeIndex(i);
      },
      setPlaying: (p) => set({ playing: p }),
      resetTimeline: () => set((s) => ({ playing: false, timeIndex: INITIAL_TIME, ...derive(s.dataset, INITIAL_TIME, s.preset) })),
      setPreset: (p) => set((s) => ({ preset: p, ...derive(s.dataset, s.timeIndex, p) })),
      setLighting: (l) => set({ lighting: l }),
      toggleLayer: (id) => set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),
      select: (selection, view) =>
        set(() => ({
          selection,
          ...(view ? { cameraRequest: { view, nonce: ++nonce } } : {}),
        })),
      setHoveredZone: (id) => set({ hoveredZoneId: id }),
      setHoveredLandmark: (id) => set({ hoveredLandmarkId: id }),
      flyTo: (view) => set({ cameraRequest: { view, nonce: ++nonce } }),
      resetView: () => set({ selection: null, cameraRequest: { view: DEFAULT_VIEW, nonce: ++nonce } }),
      setZoomLevel: (z) => set({ zoomLevel: z }),
      setReducedMotion: (v) => set({ reducedMotion: v }),
      setBottomOpen: (v) => set({ bottomOpen: v }),
      setBottomTab: (t) => set({ bottomTab: t, bottomOpen: true }),
      setHelpOpen: (v) => set({ helpOpen: v }),
      setSceneReady: (v) => set({ sceneReady: v }),
    }),
    {
      name: "aeroscope-ui",
      version: 1,
      skipHydration: true,
      partialize: (s) => ({ layers: s.layers, reducedMotion: s.reducedMotion, lighting: s.lighting }),
    },
  ),
);

export function useSelectedZoneId(): string | null {
  return useSimStore((s) => {
    const sel = s.selection;
    if (!sel) return null;
    if (sel.kind === "zone") return sel.id;
    if (sel.kind === "building") return sel.zoneId;
    if (sel.kind === "source") return s.sources.find((x) => x.id === sel.id)?.zoneId ?? null;
    return LANDMARK_BY_ID[sel.id]?.zoneId ?? null;
  });
}

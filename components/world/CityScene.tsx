"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { getCityModel } from "@/lib/city-generator";
import { viewForPoint } from "@/lib/camera-presets";
import { useSelectedZoneId, useSimStore } from "@/store/simulation-store";
import { Buildings } from "./Buildings";
import { CameraController } from "./CameraController";
import { CityGround } from "./CityGround";
import { Clouds, Lighting, WorldClock } from "./Environment";
import { Landmarks } from "./Landmarks";
import { MetroSystem } from "./MetroSystem";
import { AmbientHaze, AqiHeatmap, SourcePlumes, ZoneBoundaries } from "./PollutionLayers";
import { RoadNetwork } from "./RoadNetwork";
import { GroundPicker, SelectionRing, nearestZone } from "./SceneInteraction";
import { StreetFurniture, Vegetation } from "./StreetLife";
import { TrafficSystem } from "./TrafficSystem";
import { WindFlow } from "./WindFlow";
import { LabelProjector } from "./LabelProjector";
import { SourceMarkers, ZoneMarkers } from "./ZoneMarkers";

export interface SceneQuality {
  mobile: boolean;
  shadowMapSize: number;
  groundTexture: number;
  trafficDensity: number;
  plumePerSource: number;
  hazePerZone: number;
  windCount: number;
}

function ReadySignal() {
  const frames = useRef(0);
  const setSceneReady = useSimStore((s) => s.setSceneReady);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === 4) setSceneReady(true);
  });
  return null;
}

export default function CityScene({ quality }: { quality: SceneQuality }) {
  const city = useMemo(() => getCityModel(), []);
  const layers = useSimStore((s) => s.layers);
  const readings = useSimStore((s) => s.readings);
  const sources = useSimStore((s) => s.sources);
  const selection = useSimStore((s) => s.selection);
  const select = useSimStore((s) => s.select);
  const selectedZoneId = useSelectedZoneId();
  const highlightedZone = selection?.kind === "zone" ? selection.id : null;

  const onBuilding = (index: number, point: THREE.Vector3) => {
    const zone = nearestZone(useSimStore.getState().readings, point.x, point.z, false);
    if (!zone) return;
    select({ kind: "building", id: index, zoneId: zone.id }, viewForPoint(city.buildings.x[index], city.buildings.z[index], 38));
  };

  return (
    <>
      <WorldClock />
      <Lighting shadowMapSize={quality.shadowMapSize} />
      <Clouds />
      <CityGround textureSize={quality.groundTexture} />
      <RoadNetwork city={city} />
      <Buildings city={city} onSelect={onBuilding} />
      <Vegetation city={city} />
      <StreetFurniture city={city} />
      <Landmarks />
      <MetroSystem city={city} />
      <TrafficSystem city={city} density={quality.trafficDensity} visible={layers.traffic} />

      <AqiHeatmap visible={layers.heatmap} />
      <ZoneBoundaries readings={readings} visible={layers.boundaries || highlightedZone !== null} selectedId={selectedZoneId} />
      <SourcePlumes sources={sources} visible={layers.plumes} perSource={quality.plumePerSource} />
      <AmbientHaze zoneCount={readings.length} visible={layers.plumes} perZone={quality.hazePerZone} />
      <WindFlow visible={layers.wind} count={quality.windCount} />

      <ZoneMarkers readings={readings} selectedId={selectedZoneId} visible={layers.labels} />
      <SourceMarkers sources={sources} selectedId={selection?.kind === "source" ? selection.id : null} visible={layers.sources} />
      <LabelProjector />

      <GroundPicker />
      <SelectionRing city={city} />
      <CameraController />
      <ReadySignal />
    </>
  );
}

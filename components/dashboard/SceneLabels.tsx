"use client";

import { memo, useMemo } from "react";
import { LANDMARKS, LANDMARK_BY_ID } from "@/data/landmarks";
import { getAqiBand } from "@/lib/aqi";
import { viewForPoint, type ZoomLevel } from "@/lib/camera-presets";
import { getCityModel } from "@/lib/city-generator";
import { REGION_LABEL, SOURCE_COLOR, SOURCE_LABEL } from "@/lib/formatting";
import { ZONE_LABEL_Y, sourceEmitHeight, useSceneAnchor } from "@/lib/scene-anchors";
import { selectionTarget } from "@/lib/selection-target";
import { useSelectedZoneId, useSimStore } from "@/store/simulation-store";
import type { SourceReading, ZoneReading } from "@/types/air-quality";
import { SOURCE_ICON } from "../ui/source-icons";

const HIDDEN = { display: "none" } as const;

const ZoneLabel = memo(function ZoneLabel({
  zone,
  zoom,
  selected,
  hovered,
  hidden,
}: {
  zone: ZoneReading;
  zoom: ZoomLevel;
  selected: boolean;
  hovered: boolean;
  hidden: boolean;
}) {
  const ref = useSceneAnchor(`zone:${zone.id}`, zone.position[0], ZONE_LABEL_Y, zone.position[1]);
  const select = useSimStore((s) => s.select);
  const band = getAqiBand(zone.aqi);
  const level: ZoomLevel = selected ? "near" : hovered && zoom === "far" ? "mid" : zoom;
  return (
    <div ref={ref} className="aq-anchor" style={hidden ? HIDDEN : undefined}>
      <button
        type="button"
        onClick={() => select({ kind: "zone", id: zone.id }, viewForPoint(zone.position[0], zone.position[1], 96))}
        className={`aq-label aq-label--${level}${selected ? " is-selected" : ""}${hovered ? " is-hovered" : ""}`}
        aria-label={`${zone.name}: AQI ${zone.aqi}, ${band.category}`}
      >
        <span className="aq-label__chip" style={{ background: band.color, color: band.ink }}>
          {zone.aqi}
        </span>
        {level === "far" ? (
          <span className="aq-label__short">{band.short}</span>
        ) : (
          <span className="aq-label__body">
            <span className="aq-label__name">{zone.name}</span>
            <span className="aq-label__meta">
              {band.category}
              {level === "near" && (
                <>
                  {" · "}PM2.5 {zone.pm25} · PM10 {zone.pm10}
                </>
              )}
            </span>
            {level === "near" && <span className="aq-label__region">{REGION_LABEL[zone.region]} · simulated</span>}
          </span>
        )}
      </button>
    </div>
  );
});

const SourceChip = memo(function SourceChip({ source, zoom, selected, hidden }: { source: SourceReading; zoom: ZoomLevel; selected: boolean; hidden: boolean }) {
  const ref = useSceneAnchor(`source:${source.id}`, source.position[0], sourceEmitHeight(source) + 2.8, source.position[1]);
  const select = useSimStore((s) => s.select);
  const Icon = SOURCE_ICON[source.category];
  return (
    <div ref={ref} className="aq-anchor" style={hidden || zoom === "far" ? HIDDEN : undefined}>
      <button
        type="button"
        className={`aq-source${selected ? " is-selected" : ""}`}
        style={{ ["--src" as string]: SOURCE_COLOR[source.category] }}
        onClick={() => select({ kind: "source", id: source.id }, viewForPoint(source.position[0], source.position[1], 42))}
        aria-label={`${SOURCE_LABEL[source.category]} source: ${source.name}`}
      >
        <Icon size={12} strokeWidth={2.2} />
        {zoom === "near" && <span>{source.name}</span>}
      </button>
    </div>
  );
});

function LandmarkTag({ id, zoom }: { id: string; zoom: ZoomLevel }) {
  const l = LANDMARK_BY_ID[id];
  const ref = useSceneAnchor(`landmark:${id}`, l.position[0], l.height + 1.2, l.position[1]);
  const select = useSimStore((s) => s.select);
  return (
    <div ref={ref} className="aq-anchor" style={zoom === "near" ? undefined : HIDDEN}>
      <button type="button" className="aq-tag" onClick={() => select({ kind: "landmark", id }, l.view)}>
        {l.name}
      </button>
    </div>
  );
}

function HoverTag() {
  const id = useSimStore((s) => s.hoveredLandmarkId);
  const l = id ? LANDMARK_BY_ID[id] : null;
  const ref = useSceneAnchor("hover", l?.position[0] ?? 0, (l?.height ?? 0) + 1.5, l?.position[1] ?? 0);
  return (
    <div ref={ref} className="aq-anchor pointer-events-none" style={l ? undefined : HIDDEN}>
      <div className="aq-hover-tag">{l?.name}</div>
    </div>
  );
}

function SelectionTag() {
  const selection = useSimStore((s) => s.selection);
  const readings = useSimStore((s) => s.readings);
  const sources = useSimStore((s) => s.sources);
  const target = useMemo(() => selectionTarget(selection, readings, sources, getCityModel().buildings), [selection, readings, sources]);
  const show = target !== null && selection?.kind !== "zone";
  const ref = useSceneAnchor("selection", target?.x ?? 0, target?.labelY ?? 0, target?.z ?? 0);
  const band = target?.aqi != null ? getAqiBand(target.aqi) : null;
  return (
    <div ref={ref} className="aq-anchor pointer-events-none" style={show ? undefined : HIDDEN}>
      <div className="aq-sel-tag">
        <span className="aq-sel-tag__title">{target?.label}</span>
        {band && (
          <span className="aq-sel-tag__aqi" style={{ background: band.color, color: band.ink }}>
            {target?.aqi} · {band.short}
          </span>
        )}
      </div>
    </div>
  );
}

const TAGGED = LANDMARKS.filter((l) => l.kind !== "road" || l.id === "ito-junction").map((l) => l.id);

/**
 * Floating labels for the 3D scene, rendered in the main DOM tree and
 * positioned every frame by <LabelProjector /> inside the canvas.
 */
export function SceneLabels() {
  const readings = useSimStore((s) => s.readings);
  const sources = useSimStore((s) => s.sources);
  const zoom = useSimStore((s) => s.zoomLevel);
  const layers = useSimStore((s) => s.layers);
  const hovered = useSimStore((s) => s.hoveredZoneId);
  const selection = useSimStore((s) => s.selection);
  const selectedZone = useSelectedZoneId();
  return (
    <div className="aq-labels" aria-label="Map labels">
      {TAGGED.map((id) => (
        <LandmarkTag key={id} id={id} zoom={zoom} />
      ))}
      {sources.map((s) => (
        <SourceChip key={s.id} source={s} zoom={zoom} selected={selection?.kind === "source" && selection.id === s.id} hidden={!layers.sources} />
      ))}
      {readings.map((z) => (
        <ZoneLabel key={z.id} zone={z} zoom={zoom} selected={z.id === selectedZone} hovered={z.id === hovered} hidden={!layers.labels} />
      ))}
      <HoverTag />
      <SelectionTag />
    </div>
  );
}

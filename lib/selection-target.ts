import { LANDMARK_BY_ID } from "../data/landmarks";
import type { SourceReading, ZoneReading } from "../types/air-quality";
import type { Selection } from "../types/scene";
import { BUILDING_KINDS, type BuildingSet } from "./city-generator";
import { sourceEmitHeight } from "./scene-anchors";

export interface SelectionTarget {
  x: number;
  z: number;
  radius: number;
  /** Height for the floating selection tag. */
  labelY: number;
  label: string;
  sub: string;
  aqi: number | null;
}

/** Where a selection sits in the world — shared by the 3D ring and the DOM tag. */
export function selectionTarget(
  selection: Selection | null,
  readings: ZoneReading[],
  sources: SourceReading[],
  buildings: BuildingSet,
): SelectionTarget | null {
  if (!selection) return null;
  const zoneOf = (id: string) => readings.find((r) => r.id === id) ?? null;
  if (selection.kind === "zone") {
    const z = zoneOf(selection.id);
    return z ? { x: z.position[0], z: z.position[1], radius: z.radius, labelY: 6, label: z.name, sub: "Air-quality zone", aqi: null } : null;
  }
  if (selection.kind === "landmark") {
    const l = LANDMARK_BY_ID[selection.id];
    if (!l) return null;
    const z = zoneOf(l.zoneId);
    return { x: l.position[0], z: l.position[1], radius: l.radius, labelY: l.height + 2.8, label: l.name, sub: z?.name ?? "", aqi: z?.aqi ?? null };
  }
  if (selection.kind === "source") {
    const s = sources.find((x) => x.id === selection.id);
    if (!s) return null;
    const z = zoneOf(s.zoneId);
    return { x: s.position[0], z: s.position[1], radius: 2.2, labelY: sourceEmitHeight(s) + 3.6, label: s.name, sub: z?.name ?? "", aqi: z?.aqi ?? null };
  }
  const i = selection.id;
  const z = zoneOf(selection.zoneId);
  return {
    x: buildings.x[i],
    z: buildings.z[i],
    radius: Math.max(buildings.w[i], buildings.d[i]) * 0.9 + 0.6,
    labelY: buildings.h[i] + 1.6,
    label: BUILDING_KINDS[buildings.kind[i]],
    sub: z?.name ?? "",
    aqi: z?.aqi ?? null,
  };
}

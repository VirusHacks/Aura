import { REGION_BY_ID } from "@/data/city-regions";
import { LANDMARK_BY_ID } from "@/data/landmarks";
import { viewForPoint } from "@/lib/camera-presets";
import { useSimStore } from "@/store/simulation-store";
import type { RegionId } from "@/types/air-quality";

export function selectZone(id: string) {
  const s = useSimStore.getState();
  const z = s.readings.find((r) => r.id === id);
  if (!z) return;
  s.select({ kind: "zone", id }, viewForPoint(z.position[0], z.position[1], 96));
}

export function selectLandmark(id: string) {
  const l = LANDMARK_BY_ID[id];
  if (!l) return;
  useSimStore.getState().select({ kind: "landmark", id }, l.view);
}

export function selectSource(id: string) {
  const s = useSimStore.getState();
  const src = s.sources.find((x) => x.id === id);
  if (!src) return;
  s.select({ kind: "source", id }, viewForPoint(src.position[0], src.position[1], 42));
}

export function flyToRegion(id: RegionId) {
  const s = useSimStore.getState();
  s.select(null);
  s.flyTo(REGION_BY_ID[id].view);
}

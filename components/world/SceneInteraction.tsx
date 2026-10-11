"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { CityModel } from "@/lib/city-generator";
import { WORLD, WORLD_DEPTH, WORLD_WIDTH } from "@/lib/city-layout";
import { viewForPoint } from "@/lib/camera-presets";
import { worldUniforms } from "@/lib/world-uniforms";
import { useSimStore } from "@/store/simulation-store";
import type { ZoneReading } from "@/types/air-quality";
import { selectionTarget } from "@/lib/selection-target";
import { motion } from "@/lib/live/motion";
import { liveIsDriving, useLiveStore } from "@/store/live-store";

export function nearestZone(readings: ZoneReading[], x: number, z: number, strict = true): ZoneReading | null {
  let best: ZoneReading | null = null;
  let bestScore = Infinity;
  for (const r of readings) {
    const score = Math.hypot(x - r.position[0], z - r.position[1]) / r.radius;
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (strict && bestScore > 1.1) return null;
  return best;
}

/**
 * Invisible ground catcher: clicking open city selects the zone under the
 * cursor — or, during a live trip with click-to-walk on, walks the character there.
 */
export function GroundPicker() {
  const select = useSimStore((s) => s.select);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    if (liveIsDriving() && useLiveStore.getState().clickToWalk) {
      motion.target = { x: e.point.x, z: e.point.z };
      return;
    }
    const readings = useSimStore.getState().readings;
    const zone = nearestZone(readings, e.point.x, e.point.z);
    if (zone) select({ kind: "zone", id: zone.id }, viewForPoint(zone.position[0], zone.position[1], 96));
    else select(null);
  };
  return (
    <mesh position={[(WORLD.minX + WORLD.maxX) / 2, 0, (WORLD.minZ + WORLD.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} onClick={onClick}>
      <planeGeometry args={[WORLD_WIDTH, WORLD_DEPTH]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

export function SelectionRing({ city }: { city: CityModel }) {
  const selection = useSimStore((s) => s.selection);
  const readings = useSimStore((s) => s.readings);
  const sources = useSimStore((s) => s.sources);
  const ring = useRef<THREE.Mesh>(null);
  const wave = useRef<THREE.Mesh>(null);
  const target = useMemo(() => selectionTarget(selection, readings, sources, city.buildings), [selection, readings, sources, city]);

  const building = selection?.kind === "building" ? selection.id : null;
  const outline = useMemo(() => {
    if (building === null) return null;
    const b = city.buildings;
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(b.w[building] + 0.08, b.h[building] + 0.08, b.d[building] + 0.08));
    return { geo, x: b.x[building], z: b.z[building], h: b.h[building], rot: b.rot[building] };
  }, [building, city]);
  useEffect(() => () => outline?.geo.dispose(), [outline]);

  useFrame(() => {
    if (!target) return;
    const t = worldUniforms.uTime.value;
    if (ring.current) {
      const s = 1 + Math.sin(t * 3) * 0.035 * worldUniforms.uMotion.value;
      ring.current.scale.set(s, s, s);
    }
    if (wave.current) {
      const p = (t * 0.6) % 1;
      const s = 0.55 + p * 0.75;
      wave.current.scale.set(s, s, s);
      (wave.current.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.5;
    }
  });

  if (!target) return null;
  const isZone = selection?.kind === "zone";
  // The floating name tag is a DOM label (see SceneLabels).
  return (
    <group>
      <group position={[target.x, 0.14, target.z]}>
        <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={8} raycast={() => null}>
          <ringGeometry args={[target.radius - (isZone ? 0.35 : 0.22), target.radius, 96]} />
          <meshBasicMaterial color="#22c3e6" transparent opacity={0.9} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh ref={wave} rotation={[-Math.PI / 2, 0, 0]} renderOrder={8} raycast={() => null}>
          <ringGeometry args={[target.radius * 0.96, target.radius, 96]} />
          <meshBasicMaterial color="#22c3e6" transparent opacity={0.4} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      {outline && (
        <lineSegments geometry={outline.geo} position={[outline.x, outline.h / 2, outline.z]} rotation={[0, outline.rot, 0]} renderOrder={9}>
          <lineBasicMaterial color="#22c3e6" depthTest={false} transparent opacity={0.95} />
        </lineSegments>
      )}
    </group>
  );
}

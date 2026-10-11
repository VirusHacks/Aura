"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { CityModel } from "@/lib/city-generator";
import { roadSegments } from "@/lib/city-generator";
import {
  ANCHORS,
  BRIDGE_DECK,
  BRIDGE_RAMP,
  CP,
  RIVER_BANK,
  RIVER_HALF_WIDTH,
  WORLD,
  isRiver,
  riverX,
} from "@/lib/city-layout";
import { writeMatrix } from "@/lib/geometry";
import type { RoadDef, RoadKind, Vec2 } from "@/types/scene";

const ROAD_COLOR: Record<RoadKind, string> = {
  ring: "#7d8288",
  highway: "#7a7f85",
  arterial: "#878b90",
  street: "#a2a4a5",
  market: "#b7aa94",
};
const ROAD_Y: Record<RoadKind, number> = {
  street: 0.022,
  market: 0.026,
  arterial: 0.03,
  ring: 0.034,
  highway: 0.036,
};

interface Quad {
  x: number;
  z: number;
  len: number;
  width: number;
  angle: number;
}

/** Split a road into flat quads, skipping river spans (they become bridge decks). */
function roadQuads(road: RoadDef): Quad[] {
  const quads: Quad[] = [];
  for (const [a, b] of roadSegments(road)) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-3) continue;
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    let start: number | null = null;
    const push = (t0: number, t1: number) => {
      const extra = road.kind === "street" ? 0 : 0.25;
      const l = t1 - t0 + extra;
      const mid = (t0 + t1) / 2;
      quads.push({ x: a[0] + ux * mid, z: a[1] + uz * mid, len: l, width: road.width, angle: Math.atan2(-uz, ux) });
    };
    const step = 0.5;
    for (let t = 0; t <= len + 1e-6; t += step) {
      const tt = Math.min(t, len);
      const wet = isRiver(a[0] + ux * tt, a[1] + uz * tt, BRIDGE_RAMP);
      if (!wet && start === null) start = tt;
      if (wet && start !== null) {
        push(start, tt);
        start = null;
      }
    }
    if (start !== null) push(start, len);
  }
  return quads;
}

function InstancedQuads({ quads, color, y, widthPad = 0 }: { quads: Quad[]; color: string; y: number; widthPad?: number }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 }),
      Math.max(1, quads.length),
    );
    const arr = m.instanceMatrix.array as Float32Array;
    quads.forEach((q, i) => writeMatrix(arr, i, q.x, y, q.z, q.angle, q.len, 1, q.width + widthPad));
    m.count = quads.length;
    m.instanceMatrix.needsUpdate = true;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    return m;
  }, [geo, quads, color, y, widthPad]);
  useEffect(
    () => () => {
      geo.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    },
    [geo, mesh],
  );
  return <primitive object={mesh} />;
}

function Ring({ inner, outer, x, z, y, color }: { inner: number; outer: number; x: number; z: number; y: number; color: string }) {
  return (
    <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <ringGeometry args={[inner, outer, 72]} />
      <meshStandardMaterial color={color} roughness={0.92} />
    </mesh>
  );
}

function Bridge({ z, width, kind }: { z: number; width: number; kind: "road" | "rail" }) {
  const rx = riverX(z);
  const span = (RIVER_HALF_WIDTH + RIVER_BANK) * 2;
  const rampAngle = Math.atan2(BRIDGE_DECK, BRIDGE_RAMP);
  const rampLen = Math.hypot(BRIDGE_DECK, BRIDGE_RAMP);
  const deckColor = kind === "rail" ? "#8a8178" : "#888c91";
  const piers = useMemo(() => {
    const out: number[] = [];
    for (let x = -span / 2 + 2.5; x <= span / 2 - 2.5; x += 3.6) out.push(x);
    return out;
  }, [span]);
  return (
    <group position={[rx, 0, z]}>
      <mesh position={[0, BRIDGE_DECK - 0.12, 0]} castShadow receiveShadow>
        <boxGeometry args={[span, 0.26, width + 0.6]} />
        <meshStandardMaterial color="#d9d4ca" roughness={0.85} />
      </mesh>
      <mesh position={[0, BRIDGE_DECK + 0.015, 0]} receiveShadow>
        <boxGeometry args={[span, 0.01, width]} />
        <meshStandardMaterial color={deckColor} roughness={0.9} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[s * (span / 2 + (BRIDGE_RAMP / 2)), BRIDGE_DECK / 2 - 0.02, 0]} rotation={[0, 0, -s * rampAngle]} receiveShadow>
            <boxGeometry args={[rampLen, 0.05, width]} />
            <meshStandardMaterial color={deckColor} roughness={0.9} />
          </mesh>
          <mesh position={[0, BRIDGE_DECK + 0.14, s * (width / 2 + 0.22)]} castShadow>
            <boxGeometry args={[span, 0.22, 0.08]} />
            <meshStandardMaterial color="#efebe3" roughness={0.7} />
          </mesh>
        </group>
      ))}
      {piers.map((x) => (
        <mesh key={x} position={[x, -0.2, 0]} castShadow>
          <boxGeometry args={[0.5, 0.9, width * 0.8]} />
          <meshStandardMaterial color="#cfc8bb" roughness={0.9} />
        </mesh>
      ))}
      {kind === "rail" &&
        // Steel truss, the old iron bridge silhouette.
        [-1, 1].map((s) => (
          <group key={`t${s}`} position={[0, BRIDGE_DECK, s * (width / 2 + 0.1)]}>
            <mesh position={[0, 1.6, 0]} castShadow>
              <boxGeometry args={[span, 0.14, 0.12]} />
              <meshStandardMaterial color="#5b6670" roughness={0.6} metalness={0.3} />
            </mesh>
            {Array.from({ length: Math.floor(span / 1.6) }, (_, i) => {
              const x = -span / 2 + 0.8 + i * 1.6;
              return (
                <mesh key={i} position={[x, 0.8, 0]} rotation={[0, 0, i % 2 ? 0.75 : -0.75]} castShadow>
                  <boxGeometry args={[0.08, 2.1, 0.08]} />
                  <meshStandardMaterial color="#5b6670" roughness={0.6} metalness={0.3} />
                </mesh>
              );
            })}
          </group>
        ))}
    </group>
  );
}

function RailTracks() {
  const { sleepers, rails } = useMemo(() => {
    const tracks: { z: number; x0: number; x1: number }[] = [];
    for (const dz of [-0.75, 0.75]) tracks.push({ z: ANCHORS.railwayZ + dz, x0: WORLD.minX, x1: WORLD.maxX });
    // New Delhi station yard.
    for (const z of [-45.2, -46.8, -50.4, -52]) tracks.push({ z, x0: -19.5, x1: 23.5 });
    const s: Quad[] = [];
    const r: Quad[] = [];
    for (const t of tracks) {
      const pieces: [number, number][] = [];
      let start: number | null = null;
      for (let x = t.x0; x <= t.x1; x += 0.5) {
        const wet = isRiver(x, t.z, BRIDGE_RAMP);
        if (!wet && start === null) start = x;
        if (wet && start !== null) {
          pieces.push([start, x]);
          start = null;
        }
      }
      if (start !== null) pieces.push([start, t.x1]);
      for (const [a, b] of pieces) {
        for (let x = a + 0.2; x < b; x += 0.55) s.push({ x, z: t.z, len: 0.16, width: 0.62, angle: 0 });
        for (const g of [-0.17, 0.17]) r.push({ x: (a + b) / 2, z: t.z + g, len: b - a, width: 0.05, angle: 0 });
      }
      // Rails across the bridge deck.
      if (pieces.length > 1) {
        const rx = riverX(t.z);
        const span = (RIVER_HALF_WIDTH + RIVER_BANK + BRIDGE_RAMP) * 2;
        for (const g of [-0.17, 0.17]) r.push({ x: rx, z: t.z + g, len: span, width: 0.05, angle: 0 });
      }
    }
    return { sleepers: s, rails: r };
  }, []);
  return (
    <>
      <InstancedQuads quads={sleepers} color="#7a6a5a" y={0.045} />
      <InstancedQuads quads={rails} color="#4a4e52" y={0.06} />
    </>
  );
}

export function RoadNetwork({ city }: { city: CityModel }) {
  const groups = useMemo(() => {
    const byKind = new Map<RoadKind, Quad[]>();
    const sidewalks: Quad[] = [];
    const dashes: Quad[] = [];
    const medians: Quad[] = [];
    for (const road of city.roads) {
      const quads = roadQuads(road);
      const list = byKind.get(road.kind) ?? [];
      list.push(...quads);
      byKind.set(road.kind, list);
      sidewalks.push(...quads.map((q) => ({ ...q, width: q.width + (road.kind === "street" ? 0.9 : 1.6) })));
      if (road.kind === "ring" || road.kind === "highway") {
        medians.push(...quads.map((q) => ({ ...q, width: 0.28 })));
      } else if (road.kind === "arterial") {
        for (const q of quads) {
          const n = Math.floor(q.len / 2.2);
          for (let i = 0; i < n; i++) {
            const t = -q.len / 2 + 1.1 + i * 2.2;
            const x = q.x + Math.cos(q.angle) * t;
            const z = q.z - Math.sin(q.angle) * t;
            if (city.signals.some((s) => Math.hypot(s.x - x, s.z - z) < 3.4)) continue;
            dashes.push({ x, z, len: 1, width: 0.09, angle: q.angle });
          }
        }
      }
    }
    return { byKind, sidewalks, dashes, medians };
  }, [city]);

  const bridges = useMemo(() => {
    const out: { z: number; width: number; key: string }[] = [];
    for (const road of city.roads) {
      if (road.kind === "street" || road.kind === "market") continue;
      for (const [a, b] of roadSegments(road)) {
        if (Math.abs(a[1] - b[1]) > 1e-3) continue;
        const z = a[1];
        const rx = riverX(z);
        if (Math.min(a[0], b[0]) < rx && Math.max(a[0], b[0]) > rx) out.push({ z, width: road.width, key: road.id });
      }
    }
    return out;
  }, [city]);

  const crosswalks = useMemo<Quad[]>(() => {
    const d = city.crosswalks.data;
    const q: Quad[] = [];
    for (let i = 0; i < city.crosswalks.count; i++) {
      q.push({ x: d[i * 7], z: d[i * 7 + 2], len: d[i * 7 + 4], width: d[i * 7 + 6], angle: d[i * 7 + 3] });
    }
    return q;
  }, [city]);

  const cpRadials = useMemo<Quad[]>(() => {
    const out: Quad[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const r0 = CP.innerRoad[0];
      const r1 = CP.outerRoad[1];
      const mid = (r0 + r1) / 2;
      out.push({
        x: CP.center[0] + Math.cos(a) * mid,
        z: CP.center[1] + Math.sin(a) * mid,
        len: r1 - r0,
        width: 1.6,
        angle: -a,
      });
    }
    // Cardinal radials connect the rings to Janpath and the E–W roads.
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const r0 = CP.innerRoad[0];
      const r1 = CP.outerRoad[1] + 0.5;
      const mid = (r0 + r1) / 2;
      out.push({ x: CP.center[0] + Math.cos(a) * mid, z: CP.center[1] + Math.sin(a) * mid, len: r1 - r0, width: 2.4, angle: -a });
    }
    return out;
  }, []);

  const kinds: RoadKind[] = ["street", "market", "arterial", "ring", "highway"];
  const [cpx, cpz] = CP.center;
  const [igx, igz] = ANCHORS.indiaGate;

  return (
    <group>
      <InstancedQuads quads={groups.sidewalks} color="#d8d1c3" y={0.012} />
      {kinds.map((k) => (
        <InstancedQuads key={k} quads={groups.byKind.get(k) ?? []} color={ROAD_COLOR[k]} y={ROAD_Y[k]} />
      ))}
      <InstancedQuads quads={groups.dashes} color="#f3f0e8" y={0.046} />
      <InstancedQuads quads={groups.medians} color="#c8c3b4" y={0.05} />
      <InstancedQuads quads={crosswalks} color="#f5f3ee" y={0.047} />
      {/* Connaught Place rings */}
      <Ring inner={CP.innerRoad[0]} outer={CP.innerRoad[1]} x={cpx} z={cpz} y={0.031} color={ROAD_COLOR.arterial} />
      <Ring inner={CP.middleRoad[0]} outer={CP.middleRoad[1]} x={cpx} z={cpz} y={0.031} color={ROAD_COLOR.arterial} />
      <Ring inner={CP.outerRoad[0]} outer={CP.outerRoad[1]} x={cpx} z={cpz} y={0.033} color={ROAD_COLOR.arterial} />
      <InstancedQuads quads={cpRadials} color={ROAD_COLOR.arterial} y={0.032} />
      {/* India Gate roundabout */}
      <Ring inner={6.8} outer={8.4} x={igx} z={igz} y={0.033} color={ROAD_COLOR.arterial} />
      {bridges.map((b) => (
        <Bridge key={b.key} z={b.z} width={b.width} kind="road" />
      ))}
      <Bridge z={ANCHORS.railwayZ} width={2.6} kind="rail" />
      <RailTracks />
    </group>
  );
}

export type { Quad, Vec2 };

"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CityModel } from "@/lib/city-generator";
import { deckHeight } from "@/lib/city-layout";
import { createVehicleGeometries, writeMatrix } from "@/lib/geometry";
import { createRng } from "@/lib/rng";
import { buildLanes, signalPhase, type Lane, type VehicleType } from "@/lib/scene-paths";
import { worldUniforms } from "@/lib/world-uniforms";

const TYPES: VehicleType[] = ["car", "auto", "bus", "truck", "van"];

const MIX: Record<NonNullable<Lane["mix"]>, [VehicleType, number][]> = {
  default: [["car", 0.56], ["auto", 0.17], ["bus", 0.09], ["van", 0.09], ["truck", 0.09]],
  freight: [["truck", 0.42], ["car", 0.3], ["van", 0.16], ["bus", 0.12]],
  market: [["auto", 0.85], ["van", 0.15]],
};

const COLORS: Record<VehicleType, string[]> = {
  car: ["#f4f4f2", "#d7dadd", "#9aa1a8", "#2f3439", "#b23b32", "#2d5a8c", "#c9c2b4", "#5d6b78", "#e8e6df", "#7a2e2b", "#ffffff"],
  auto: ["#ffffff"],
  bus: ["#3f8f5b", "#e07b2e", "#c8432f", "#3f8f5b", "#2f6fa8"],
  truck: ["#d9542c", "#2e6fa3", "#e2b331", "#3b8a4f", "#c43c3c", "#7b4fa0"],
  van: ["#f4f4f2", "#e9c46a", "#d7dadd", "#4f7cac"],
};

interface Vehicle {
  lane: number;
  s: number;
  v: number;
  vmax: number;
  len: number;
  type: VehicleType;
  index: number;
}

export function TrafficSystem({ city, density, visible }: { city: CityModel; density: number; visible: boolean }) {
  const geos = useMemo(() => createVehicleGeometries(), []);
  const sim = useMemo(() => {
    const rng = createRng(4242);
    const lanes = buildLanes(city.roads, city.signals, density);
    const vehicles: Vehicle[] = [];
    const laneVehicles: number[][] = lanes.map(() => []);
    const counts: Record<VehicleType, number> = { car: 0, auto: 0, bus: 0, truck: 0, van: 0 };
    const colors: Record<VehicleType, number[]> = { car: [], auto: [], bus: [], truck: [], van: [] };
    lanes.forEach((lane, li) => {
      const mix = MIX[lane.mix ?? "default"];
      const n = lane.vehicleCount;
      for (let k = 0; k < n; k++) {
        let r = rng.next();
        let type: VehicleType = mix[0][0];
        for (const [t, p] of mix) {
          if (r < p) {
            type = t;
            break;
          }
          r -= p;
        }
        const s = ((k + rng.range(0.1, 0.6)) / n) * lane.path.length;
        const vmax = lane.speed * rng.range(0.82, 1.12) * (type === "truck" || type === "bus" ? 0.82 : type === "auto" ? 0.7 : 1);
        const c = new THREE.Color(rng.pick(COLORS[type]));
        colors[type].push(c.r, c.g, c.b);
        laneVehicles[li].push(vehicles.length);
        vehicles.push({ lane: li, s, v: vmax * 0.8, vmax, len: geos[type].length, type, index: counts[type]++ });
      }
    });
    return { lanes, vehicles, laneVehicles, counts, colors };
  }, [city, density, geos]);

  const meshes = useMemo(() => {
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 });
    const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, toneMapped: false });
    const out = {} as Record<VehicleType, { body: THREE.InstancedMesh; lights: THREE.InstancedMesh }>;
    for (const t of TYPES) {
      const n = Math.max(1, sim.counts[t]);
      const body = new THREE.InstancedMesh(geos[t].body, bodyMat, n);
      body.count = sim.counts[t];
      body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(sim.colors[t].length ? sim.colors[t] : [1, 1, 1]), 3);
      body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      body.frustumCulled = false;
      const lights = new THREE.InstancedMesh(geos[t].lights, lightMat, n);
      lights.count = sim.counts[t];
      lights.instanceMatrix = body.instanceMatrix;
      lights.frustumCulled = false;
      out[t] = { body, lights };
    }
    return { out, bodyMat, lightMat };
  }, [geos, sim]);

  useEffect(
    () => () => {
      for (const t of TYPES) {
        meshes.out[t].body.dispose();
        meshes.out[t].lights.dispose();
        geos[t].body.dispose();
        geos[t].lights.dispose();
      }
      meshes.bodyMat.dispose();
      meshes.lightMat.dispose();
    },
    [meshes, geos],
  );

  const scratch = useMemo(() => ({ p: { x: 0, z: 0, angle: 0 }, ew: new Uint8Array(city.signals.length), ns: new Uint8Array(city.signals.length) }), [city]);

  useFrame((_, rawDt) => {
    if (!visible) return;
    const dt = Math.min(rawDt, 0.05) * worldUniforms.uMotion.value;
    const t = worldUniforms.uTime.value;
    // Signal state once per frame: 2 = green, 1 = amber, 0 = red.
    city.signals.forEach((sg, i) => {
      const ph = signalPhase(i, sg.x, sg.z, t);
      scratch.ew[i] = ph.ew === "green" ? 2 : ph.ew === "amber" ? 1 : 0;
      scratch.ns[i] = ph.ns === "green" ? 2 : ph.ns === "amber" ? 1 : 0;
    });
    const { lanes, vehicles, laneVehicles } = sim;
    for (let li = 0; li < lanes.length; li++) {
      const lane = lanes[li];
      const L = lane.path.length;
      const ids = laneVehicles[li];
      const n = ids.length;
      for (let k = 0; k < n; k++) {
        const veh = vehicles[ids[k]];
        const lead = vehicles[ids[(k + 1) % n]];
        let gap = lead.s - veh.s;
        if (gap <= 0) gap += L;
        gap -= (veh.len + lead.len) / 2;
        let target = veh.vmax;
        if (n > 1) target = Math.min(target, Math.max(0, gap - 0.55) * 1.6);
        for (const stop of lane.stops) {
          let d = stop.s - veh.s - veh.len / 2;
          if (lane.path.closed && d < -2) d += L;
          if (d < 0 || d > 9) continue;
          const state = stop.ew ? scratch.ew[stop.signal] : scratch.ns[stop.signal];
          if (state === 2 || (state === 1 && d < 1.2)) continue;
          target = Math.min(target, Math.max(0, d - 0.1) * 1.3);
          break;
        }
        const rate = target < veh.v ? 6 : 1.6;
        veh.v += (target - veh.v) * Math.min(1, dt * rate);
        veh.s += veh.v * dt;
        if (veh.s > L) veh.s -= L;
      }
    }
    // Write matrices.
    const p = scratch.p;
    for (const veh of vehicles) {
      const lane = lanes[veh.lane];
      lane.path.sample(veh.s, p);
      let scale = 1;
      if (lane.wraps) {
        const edge = Math.min(veh.s, lane.path.length - veh.s);
        scale = Math.min(1, Math.max(0, (edge - 0.5) / 3));
      }
      const arr = meshes.out[veh.type].body.instanceMatrix.array as Float32Array;
      writeMatrix(arr, veh.index, p.x, 0.035 + deckHeight(p.x, p.z), p.z, p.angle, scale, scale, scale);
    }
    const night = worldUniforms.uNight.value;
    meshes.lightMat.opacity = night;
    for (const tp of TYPES) {
      meshes.out[tp].body.instanceMatrix.needsUpdate = true;
      meshes.out[tp].lights.visible = night > 0.05;
    }
  });

  return (
    <group visible={visible}>
      {TYPES.map((t) => (
        <group key={t}>
          <primitive object={meshes.out[t].body} />
          <primitive object={meshes.out[t].lights} />
        </group>
      ))}
    </group>
  );
}

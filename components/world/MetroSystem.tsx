"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CityModel } from "@/lib/city-generator";
import { ANCHORS, WORLD, deckHeight, distToPolyline } from "@/lib/city-layout";
import { mergeParts, writeMatrix } from "@/lib/geometry";
import { mat } from "@/lib/materials";
import {
  METRO_CENTERLINE,
  METRO_DECK_Y,
  METRO_STATIONS,
  METRO_TRACK_OFFSET,
  PathCurve,
  RAIL_TRACKS,
  metroCurve,
} from "@/lib/scene-paths";
import { worldUniforms } from "@/lib/world-uniforms";

const COACH_LEN = 2.05;
const COACH_GAP = 0.12;
const COACHES = 6;

function createMetroCoach() {
  return {
    body: mergeParts([
      { geo: new THREE.BoxGeometry(COACH_LEN, 0.62, 0.62), color: "#dfe3e6", at: [0, 0.42, 0] },
      { geo: new THREE.BoxGeometry(COACH_LEN - 0.1, 0.06, 0.63), color: "#2b6cb0", at: [0, 0.2, 0] },
      { geo: new THREE.BoxGeometry(COACH_LEN - 0.2, 0.2, 0.635), color: "#26303a", at: [0, 0.5, 0] },
      { geo: new THREE.BoxGeometry(COACH_LEN - 0.3, 0.05, 0.4), color: "#b9c0c6", at: [0, 0.75, 0] },
    ]),
    glow: (() => {
      const g = new THREE.BoxGeometry(COACH_LEN - 0.24, 0.16, 0.64);
      g.translate(0, 0.5, 0);
      return g;
    })(),
  };
}

function createRailCoach(color: string, stripe: string, loco = false) {
  return mergeParts([
    { geo: new THREE.BoxGeometry(2.2, 0.52, 0.56), color, at: [0, 0.38, 0] },
    { geo: new THREE.BoxGeometry(2.1, 0.12, 0.57), color: "#2b3138", at: [0, 0.48, 0] },
    { geo: new THREE.BoxGeometry(2.2, 0.06, 0.58), color: stripe, at: [0, 0.3, 0] },
    ...(loco ? [{ geo: new THREE.BoxGeometry(0.4, 0.18, 0.5), color: "#2b3138", at: [1.0, 0.52, 0] as [number, number, number] }] : []),
  ]);
}

interface Schedule {
  stops: number[];
  legs: { from: number; to: number; start: number; travel: number; dwellEnd: number }[];
  total: number;
}

/** Shuttle schedule: station to station with eased acceleration and dwell, then back. */
function buildSchedule(curve: PathCurve): Schedule {
  const stops = METRO_STATIONS.map((st) => curve.project(st.at[0], st.at[1]).s).sort((a, b) => a - b);
  const order = [...stops.keys(), ...[...stops.keys()].reverse().slice(1)];
  const legs: Schedule["legs"] = [];
  let t = 0;
  for (let i = 0; i < order.length - 1; i++) {
    const from = stops[order[i]];
    const to = stops[order[i + 1]];
    const travel = Math.abs(to - from) / 9 + 2.5;
    const dwell = 3.5;
    legs.push({ from, to, start: t, travel, dwellEnd: t + travel + dwell });
    t += travel + dwell;
  }
  return { stops, legs, total: t };
}

function scheduleAt(s: Schedule, time: number): number {
  const t = ((time % s.total) + s.total) % s.total;
  for (const leg of s.legs) {
    if (t < leg.dwellEnd) {
      const u = Math.min(1, Math.max(0, (t - leg.start) / leg.travel));
      const e = u * u * u * (u * (u * 6 - 15) + 10);
      return leg.from + (leg.to - leg.from) * e;
    }
  }
  return s.legs[s.legs.length - 1].to;
}

export function MetroSystem({ city }: { city: CityModel }) {
  const centre = useMemo(() => new PathCurve(METRO_CENTERLINE), []);
  const tracks = useMemo(() => [metroCurve(METRO_TRACK_OFFSET), metroCurve(-METRO_TRACK_OFFSET)], []);
  const schedules = useMemo(() => tracks.map(buildSchedule), [tracks]);

  const structure = useMemo(() => {
    const deck: THREE.Matrix4[] = [];
    const pillars: { x: number; z: number; angle: number }[] = [];
    const tmp = { x: 0, z: 0, angle: 0 };
    const crossing = city.roads.filter((r) => r.id !== "a1" && r.id !== "a4");
    for (let s = 0; s < centre.length; s += 1.5) {
      centre.sample(s, tmp);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(tmp.x, METRO_DECK_Y - 0.25, tmp.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, tmp.angle, 0)),
        new THREE.Vector3(1.62, 0.5, 2.7),
      );
      deck.push(m);
    }
    for (let s = 2; s < centre.length; s += 5) {
      centre.sample(s, tmp);
      // Keep pillars out of junctions so cross traffic passes underneath.
      const blocked = crossing.some((r) => distToPolyline(tmp.x, tmp.z, r.points, r.closed) < r.width / 2 + 0.9);
      if (!blocked) pillars.push({ ...tmp });
    }
    return { deck, pillars };
  }, [centre, city]);

  const res = useMemo(() => {
    const coach = createMetroCoach();
    const deckGeo = new THREE.BoxGeometry(1, 1, 1);
    const pillarGeo = mergeParts([
      { geo: new THREE.CylinderGeometry(0.34, 0.4, METRO_DECK_Y - 0.5, 10), color: "#d6d1c7", at: [0, (METRO_DECK_Y - 0.5) / 2, 0] },
      { geo: new THREE.BoxGeometry(0.8, 0.45, 2.3), color: "#cfc9be", at: [0, METRO_DECK_Y - 0.72, 0] },
    ]);
    const railGeo = new THREE.BoxGeometry(1, 0.05, 0.05);
    return {
      coach,
      deckGeo,
      pillarGeo,
      railGeo,
      deckMat: new THREE.MeshStandardMaterial({ color: "#dcd7cd", roughness: 0.85 }),
      pillarMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
      railMat: new THREE.MeshStandardMaterial({ color: "#5a5f64", roughness: 0.5, metalness: 0.5 }),
      coachMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 }),
      glowMat: new THREE.MeshBasicMaterial({ color: "#ffe2a8", transparent: true, opacity: 0, toneMapped: false }),
      blueCoach: createRailCoach("#2f5aa0", "#e8dcc0"),
      loco: createRailCoach("#c0392b", "#f1c40f", true),
      railCoachMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
    };
  }, []);

  const meshes = useMemo(() => {
    const deck = new THREE.InstancedMesh(res.deckGeo, res.deckMat, structure.deck.length);
    structure.deck.forEach((m, i) => deck.setMatrixAt(i, m));
    deck.castShadow = true;
    deck.receiveShadow = true;
    deck.computeBoundingSphere();

    const pillars = new THREE.InstancedMesh(res.pillarGeo, res.pillarMat, structure.pillars.length);
    structure.pillars.forEach((p, i) => writeMatrix(pillars.instanceMatrix.array as Float32Array, i, p.x, 0, p.z, p.angle, 1, 1, 1));
    pillars.castShadow = true;
    pillars.computeBoundingSphere();

    // Rails: short segments along each track curve.
    const railSegs: number[][] = [];
    const tmp = { x: 0, z: 0, angle: 0 };
    for (const track of tracks) {
      for (let s = 0; s < track.length; s += 1.2) {
        track.sample(s + 0.6, tmp);
        for (const g of [-0.17, 0.17]) {
          railSegs.push([tmp.x - Math.sin(tmp.angle) * g, tmp.z - Math.cos(tmp.angle) * g, tmp.angle]);
        }
      }
    }
    const rails = new THREE.InstancedMesh(res.railGeo, res.railMat, railSegs.length);
    railSegs.forEach(([x, z, a], i) => writeMatrix(rails.instanceMatrix.array as Float32Array, i, x, METRO_DECK_Y + 0.03, z, a, 1.25, 1, 1));
    rails.computeBoundingSphere();

    const n = COACHES * tracks.length;
    const coaches = new THREE.InstancedMesh(res.coach.body, res.coachMat, n);
    coaches.castShadow = true;
    coaches.frustumCulled = false;
    const glow = new THREE.InstancedMesh(res.coach.glow, res.glowMat, n);
    glow.instanceMatrix = coaches.instanceMatrix;
    glow.frustumCulled = false;

    const railN = 10;
    const rail = new THREE.InstancedMesh(res.blueCoach, res.railCoachMat, railN);
    rail.frustumCulled = false;
    rail.castShadow = true;
    const loco = new THREE.InstancedMesh(res.loco, res.railCoachMat, 1);
    loco.frustumCulled = false;
    return { deck, pillars, rails, coaches, glow, rail, loco, railN };
  }, [res, structure, tracks]);

  useEffect(
    () => () => {
      Object.values(meshes).forEach((m) => typeof m !== "number" && m.dispose());
      res.coach.body.dispose();
      res.coach.glow.dispose();
      res.deckGeo.dispose();
      res.pillarGeo.dispose();
      res.railGeo.dispose();
      res.blueCoach.dispose();
      res.loco.dispose();
      [res.deckMat, res.pillarMat, res.railMat, res.coachMat, res.glowMat, res.railCoachMat].forEach((m) => m.dispose());
    },
    [meshes, res],
  );

  const tmp = useMemo(() => ({ x: 0, z: 0, angle: 0 }), []);
  useFrame(() => {
    const t = worldUniforms.uTime.value;
    const arr = meshes.coaches.instanceMatrix.array as Float32Array;
    tracks.forEach((track, ti) => {
      const centreS = scheduleAt(schedules[ti], t + ti * schedules[ti].total * 0.5);
      for (let k = 0; k < COACHES; k++) {
        const s = centreS + (k - (COACHES - 1) / 2) * (COACH_LEN + COACH_GAP);
        track.sample(s, tmp);
        writeMatrix(arr, ti * COACHES + k, tmp.x, METRO_DECK_Y + 0.02, tmp.z, tmp.angle, 1, 1, 1);
      }
    });
    meshes.coaches.instanceMatrix.needsUpdate = true;
    res.glowMat.opacity = worldUniforms.uNight.value * 0.9;
    meshes.glow.visible = worldUniforms.uNight.value > 0.05;

    // Mainline train crossing the city east → west on a long loop.
    const span = WORLD.maxX - WORLD.minX + 40;
    const head = WORLD.maxX + 20 - ((t * 5.5) % span);
    const z = RAIL_TRACKS[0];
    const ra = meshes.rail.instanceMatrix.array as Float32Array;
    const place = (arrRef: Float32Array, i: number, x: number) => {
      const inside = x > WORLD.minX + 1.2 && x < WORLD.maxX - 1.2;
      const y = 0.06 + deckHeight(x, z);
      writeMatrix(arrRef, i, x, y, z, Math.PI, inside ? 1 : 0, inside ? 1 : 0, inside ? 1 : 0);
    };
    place(meshes.loco.instanceMatrix.array as Float32Array, 0, head);
    for (let i = 0; i < meshes.railN; i++) place(ra, i, head + 2.32 * (i + 1));
    meshes.rail.instanceMatrix.needsUpdate = true;
    meshes.loco.instanceMatrix.needsUpdate = true;
  });

  const stations = useMemo(
    () =>
      METRO_STATIONS.map((st) => {
        const p = centre.project(st.at[0], st.at[1]);
        const o = { x: 0, z: 0, angle: 0 };
        centre.sample(p.s, o);
        return { ...st, ...o };
      }),
    [centre],
  );

  const platform = mat("#e4dfd5");
  const roof = mat("#f5f4f0", { roughness: 0.5, floodlit: true });
  return (
    <group>
      <primitive object={meshes.deck} />
      <primitive object={meshes.pillars} />
      <primitive object={meshes.rails} />
      <primitive object={meshes.coaches} />
      <primitive object={meshes.glow} />
      <primitive object={meshes.rail} />
      <primitive object={meshes.loco} />
      {stations.map((st) => (
        <group key={st.id} position={[st.x, METRO_DECK_Y, st.z]} rotation={[0, st.angle, 0]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0, 0.15, s * 1.75]} material={platform} castShadow receiveShadow>
              <boxGeometry args={[9, 0.3, 0.9]} />
            </mesh>
          ))}
          <mesh position={[0, 0.3, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.5, 1, 0.82]} material={roof} castShadow>
            <cylinderGeometry args={[2.3, 2.3, 9.4, 18, 1, true, 0, Math.PI]} />
          </mesh>
          <mesh position={[0, -0.9, 0]} material={mat("#d6d1c7")} castShadow>
            <boxGeometry args={[9, 1.2, 3.3]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export const METRO_RAIL_Z = ANCHORS.railwayZ;

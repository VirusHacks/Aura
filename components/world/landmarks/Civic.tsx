"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { CP } from "@/lib/city-layout";
import { mergeParts, unitBox, writeMatrix, createTreeGeometries } from "@/lib/geometry";
import { mat, PALETTE } from "@/lib/materials";
import { patchBuildingMaterial, patchTreeMaterial, worldUniforms } from "@/lib/world-uniforms";
import { B, Cyl, Repeat } from "./primitives";

type V3 = [number, number, number];

function sectorGeometry(r0: number, r1: number, a0: number, a1: number, h: number) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r1, a0, a1, false);
  s.absarc(0, 0, r0, a1, a0, true);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  return g;
}

// Radials at multiples of π/8: diagonals (odd k) and cardinals (k % 4 === 0).
const CP_CUTS = Array.from({ length: 16 }, (_, k) => k).filter((k) => k % 2 === 1 || k % 4 === 0);

export function ConnaughtPlace() {
  const parts = useMemo(() => {
    const out: { lower: THREE.BufferGeometry; upper: THREE.BufferGeometry; roof: THREE.BufferGeometry }[] = [];
    const columns: V3[] = [];
    for (const [r0, r1, h] of [
      [CP.innerBlock[0], CP.innerBlock[1], 1.75],
      [CP.outerBlock[0], CP.outerBlock[1], 1.95],
    ] as const) {
      for (let i = 0; i < CP_CUTS.length; i++) {
        const k0 = CP_CUTS[i];
        const k1 = i + 1 < CP_CUTS.length ? CP_CUTS[i + 1] : CP_CUTS[0] + 16;
        const w0 = k0 % 4 === 0 ? 1.5 : 1.1;
        const w1 = k1 % 4 === 0 ? 1.5 : 1.1;
        const a0 = (k0 * Math.PI) / 8 + w0 / r0;
        const a1 = (k1 * Math.PI) / 8 - w1 / r0;
        if (a1 <= a0) continue;
        out.push({
          lower: sectorGeometry(r0 + 0.35, r1 - 0.35, a0, a1, 0.75),
          upper: (() => {
            const g = sectorGeometry(r0, r1, a0, a1, h - 0.75);
            g.translate(0, 0.75, 0);
            return g;
          })(),
          roof: (() => {
            const g = sectorGeometry(r0 + 0.12, r1 - 0.12, a0, a1, 0.08);
            g.translate(0, h, 0);
            return g;
          })(),
        });
        for (const r of [r0 + 0.12, r1 - 0.12]) {
          const n = Math.max(2, Math.floor(((a1 - a0) * r) / 0.55));
          for (let j = 0; j <= n; j++) {
            const a = a0 + ((a1 - a0) * j) / n;
            // Shape angle a lands at world (cos a, −sin a) after the −90° X rotation.
            columns.push([CP.center[0] + Math.cos(a) * r, 0, CP.center[1] - Math.sin(a) * r]);
          }
        }
      }
    }
    return { sectors: out, columns };
  }, []);
  const colGeo = useMemo(() => new THREE.BoxGeometry(0.11, 0.75, 0.11).translate(0, 0.375, 0), []);
  useEffect(
    () => () => {
      parts.sectors.forEach((s) => {
        s.lower.dispose();
        s.upper.dispose();
        s.roof.dispose();
      });
      colGeo.dispose();
    },
    [parts, colGeo],
  );
  const white = mat("#f6f3ec", { floodlit: true });
  const arcade = mat("#cfc3ab");
  const roof = mat("#e2ddd2");
  return (
    <group>
      <group position={[CP.center[0], 0, CP.center[1]]}>
        {parts.sectors.map((s, i) => (
          <group key={i}>
            <mesh geometry={s.lower} material={arcade} receiveShadow />
            <mesh geometry={s.upper} material={white} castShadow receiveShadow />
            <mesh geometry={s.roof} material={roof} receiveShadow />
          </group>
        ))}
      </group>
      <Repeat positions={parts.columns} geometry={colGeo} m={white} />
      <CentralParkTrees />
      <TricolourFlag position={[CP.center[0], 0, CP.center[1]]} />
    </group>
  );
}

function CentralParkTrees() {
  const { geo, material, mesh } = useMemo(() => {
    const { round } = createTreeGeometries();
    const material = patchTreeMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
    const n = 14;
    const m = new THREE.InstancedMesh(round, material, n);
    const arr = m.instanceMatrix.array as Float32Array;
    const color = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 4.4 + (i % 2) * 0.5;
      writeMatrix(arr, i, CP.center[0] + Math.cos(a) * r, 0, CP.center[1] + Math.sin(a) * r, a, 0.8, 0.8, 0.8);
      m.setColorAt(i, color.set(i % 3 ? "#7fa35a" : "#6d9450"));
    }
    m.castShadow = true;
    m.computeBoundingSphere();
    return { geo: round, material, mesh: m };
  }, []);
  useEffect(
    () => () => {
      geo.dispose();
      material.dispose();
      mesh.dispose();
    },
    [geo, material, mesh],
  );
  return <primitive object={mesh} />;
}

function createFlagTexture() {
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#FF9933";
  ctx.fillRect(0, 0, 96, 22);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 21, 96, 22);
  ctx.fillStyle = "#138808";
  ctx.fillRect(0, 42, 96, 22);
  ctx.strokeStyle = "#000080";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(48, 32, 8, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(48, 32);
    ctx.lineTo(48 + Math.cos(a) * 8, 32 + Math.sin(a) * 8);
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function TricolourFlag({ position }: { position: V3 }) {
  const { geo, material, tex } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(3.2, 2.1, 16, 4);
    geo.translate(1.6, 0, 0);
    const tex = createFlagTexture();
    const material = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = worldUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
transformed.z += sin(position.x * 2.2 - uTime * 3.0) * 0.12 * (position.x / 3.2);
transformed.y -= (position.x / 3.2) * 0.12;`,
        );
    };
    material.customProgramCacheKey = () => "aeroscope-flag";
    return { geo, material, tex };
  }, []);
  useEffect(
    () => () => {
      geo.dispose();
      material.dispose();
      tex.dispose();
    },
    [geo, material, tex],
  );
  return (
    <group position={position}>
      <Cyl p={[0, 0, 0]} r={0.09} rTop={0.06} h={13} m={mat("#d7dadd", { metalness: 0.5, roughness: 0.35 })} seg={8} />
      <mesh geometry={geo} material={material} position={[0.06, 11.8, 0]} castShadow />
    </group>
  );
}

/** Glass/office towers that share the city facade shader. */
export function TowerCluster({ towers }: { towers: [number, number, number, number, number, string][] }) {
  const { geo, material, mesh } = useMemo(() => {
    const geo = unitBox();
    geo.setAttribute("aStyle", new THREE.InstancedBufferAttribute(new Float32Array(towers.length).fill(2), 1));
    const material = patchBuildingMaterial(new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.15 }));
    const m = new THREE.InstancedMesh(geo, material, towers.length);
    const arr = m.instanceMatrix.array as Float32Array;
    const c = new THREE.Color();
    towers.forEach(([x, z, w, d, h, color], i) => {
      writeMatrix(arr, i, x, 0, z, 0, w, h, d);
      m.setColorAt(i, c.set(color));
    });
    m.castShadow = true;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    return { geo, material, mesh: m };
  }, [towers]);
  useEffect(
    () => () => {
      geo.dispose();
      material.dispose();
      mesh.dispose();
    },
    [geo, material, mesh],
  );
  return <primitive object={mesh} />;
}

const NEHRU_TOWERS: [number, number, number, number, number, string][] = [
  [42.2, 52, 3, 3, 12.6, "#a9bccb"],
  [47.2, 51.2, 3.4, 2.4, 9.4, "#b6c6d2"],
  [51, 54.6, 2.4, 3, 14.2, "#9db2c2"],
  [43.6, 57.6, 3, 3, 8.2, "#c2cfd8"],
  [48.6, 58.4, 3, 2.6, 10.6, "#a2b6c4"],
];

export function NehruPlace() {
  return (
    <group>
      <TowerCluster towers={NEHRU_TOWERS} />
      <B p={[46, 0, 60.6]} s={[11, 0.9, 1.6]} m={mat("#e6e1d6")} />
    </group>
  );
}

function createCoachGeometry(body: string, stripe: string) {
  return mergeParts([
    { geo: new THREE.BoxGeometry(2.2, 0.5, 0.56), color: body, at: [0, 0.37, 0] },
    { geo: new THREE.BoxGeometry(2.1, 0.12, 0.57), color: "#2b3138", at: [0, 0.47, 0] },
    { geo: new THREE.BoxGeometry(2.2, 0.06, 0.58), color: stripe, at: [0, 0.3, 0] },
    { geo: new THREE.BoxGeometry(2.1, 0.06, 0.48), color: "#a7adb3", at: [0, 0.64, 0] },
  ]);
}

export function NewDelhiStation() {
  const red = mat("#b5503c", { floodlit: true });
  const cream = mat("#efe3cb", { floodlit: true });
  const canopy = mat("#8ea2b0", { metalness: 0.2, roughness: 0.6 });
  const platform = mat("#d8d2c6");
  const posts = useMemo<V3[]>(() => {
    const p: V3[] = [];
    for (const z of [-46.0, -51.2]) for (let x = -17; x <= 21; x += 2.5) p.push([x, 0.22, z]);
    return p;
  }, []);
  const postGeo = useMemo(() => new THREE.BoxGeometry(0.08, 1.1, 0.08).translate(0, 0.55, 0), []);
  const coaches = useMemo(() => {
    const blue = createCoachGeometry("#2f5aa0", "#e8dcc0");
    const raj = createCoachGeometry("#a8382c", "#e8c37a");
    const a: V3[] = Array.from({ length: 7 }, (_, i) => [-16 + i * 2.32, 0.06, -45.2]);
    const b: V3[] = Array.from({ length: 8 }, (_, i) => [2 + i * 2.32, 0.06, -52]);
    return { blue, raj, a, b };
  }, []);
  useEffect(
    () => () => {
      postGeo.dispose();
      coaches.blue.dispose();
      coaches.raj.dispose();
    },
    [postGeo, coaches],
  );
  const coachMat = mat("#ffffff", { vertexColors: true, roughness: 0.6 });
  return (
    <group>
      <B p={[2, 0, -41.4]} s={[24, 2.2, 3.6]} m={red} />
      <B p={[2, 1.15, -41.4]} s={[24.1, 0.25, 3.7]} m={cream} />
      <B p={[2, 2.2, -41.4]} s={[24.2, 0.16, 3.8]} m={cream} />
      {[-4.5, 8.5].map((x) => (
        <group key={x}>
          <B p={[x, 0, -41.2]} s={[3.2, 3.5, 4.2]} m={cream} />
          <B p={[x, 3.5, -41.2]} s={[3.4, 0.2, 4.4]} m={red} />
          <B p={[x, 0, -39.08]} s={[1.6, 1.8, 0.06]} m={mat(PALETTE.shadowInset)} shadow={false} />
        </group>
      ))}
      {[-46.0, -51.2].map((z) => (
        <group key={z}>
          <B p={[2, 0, z]} s={[40, 0.22, 0.85]} m={platform} />
          <B p={[2, 1.32, z]} s={[40, 0.07, 1.5]} m={canopy} />
        </group>
      ))}
      <Repeat positions={posts} geometry={postGeo} m={canopy} />
      {/* Foot overbridge across the yard */}
      <B p={[8, 2.5, -47.6]} s={[1.1, 0.22, 9.6]} m={mat("#c9c5bd")} />
      {[-43.4, -51.8].map((z) => (
        <B key={z} p={[8, 0, z]} s={[0.25, 2.5, 0.25]} m={mat("#c9c5bd")} />
      ))}
      <Repeat positions={coaches.a} geometry={coaches.blue} m={coachMat} shadow />
      <Repeat positions={coaches.b} geometry={coaches.raj} m={coachMat} shadow />
    </group>
  );
}

export function Aiims() {
  const white = mat("#f1f0ec", { floodlit: true });
  const glass = mat("#9fb4c3", { roughness: 0.35 });
  const red = mat("#d93a3a", { emissive: "#7a1010" });
  return (
    <group>
      <B p={[-11.5, 0, 45]} s={[12, 3.2, 3]} m={white} />
      <B p={[-11.5, 1.2, 43.48]} s={[11.6, 1.4, 0.05]} m={glass} shadow={false} />
      <B p={[-15.6, 0, 49.6]} s={[4, 2.6, 5.8]} m={white} />
      <B p={[-8.2, 0, 50.6]} s={[6, 1.4, 3.2]} m={white} />
      {/* Red cross on the roof */}
      <B p={[-11.5, 3.2, 45]} s={[1.8, 0.06, 0.55]} m={red} shadow={false} />
      <B p={[-11.5, 3.2, 45]} s={[0.55, 0.06, 1.8]} m={red} shadow={false} />
      <B p={[-8.2, 1.4, 50.6]} s={[1.2, 0.04, 1.2]} m={mat("#3f8f5b")} shadow={false} />
    </group>
  );
}

export function SchoolCampus() {
  const cream = mat("#efe2c4", { floodlit: true });
  const band = mat("#d9824a");
  return (
    <group>
      <B p={[15.5, 0, 50.2]} s={[12, 1.5, 2]} m={cream} />
      <B p={[15.5, 1.5, 50.2]} s={[12.1, 0.14, 2.1]} m={band} />
      {[10.4, 20.6].map((x) => (
        <group key={x}>
          <B p={[x, 0, 52.6]} s={[1.8, 1.3, 3.2]} m={cream} />
          <B p={[x, 1.3, 52.6]} s={[1.9, 0.12, 3.3]} m={band} />
        </group>
      ))}
      <Cyl p={[15.5, 0, 59.4]} r={0.04} h={2.6} m={mat("#d7dadd")} seg={6} />
    </group>
  );
}

export function BusTerminal({ which }: { which: "kashmere-gate" | "anand-vihar" }) {
  const canopy = mat("#e7e3da", { roughness: 0.7 });
  const term = mat("#c9d2d8", { roughness: 0.5 });
  const kg = which === "kashmere-gate";
  const postGeo = useMemo(() => new THREE.BoxGeometry(0.12, 1.5, 0.12).translate(0, 0.75, 0), []);
  const posts = useMemo<V3[]>(() => {
    const p: V3[] = [];
    if (kg) for (let x = -41; x <= -29; x += 3) p.push([x, 0, -79.6], [x, 0, -85.6]);
    else for (let x = 100; x <= 112; x += 3) p.push([x, 0, 11], [x, 0, 16.4]);
    return p;
  }, [kg]);
  useEffect(() => () => postGeo.dispose(), [postGeo]);
  return kg ? (
    <group>
      <B p={[-35, 1.5, -82.6]} s={[13.5, 0.12, 6.6]} m={canopy} />
      <B p={[-35, 0, -77.2]} s={[12.5, 1.6, 2]} m={term} />
      <Repeat positions={posts} geometry={postGeo} m={canopy} />
    </group>
  ) : (
    <group>
      <B p={[106, 1.5, 13.7]} s={[13.5, 0.12, 6]} m={canopy} />
      <B p={[106, 0, 18.7]} s={[12, 1.8, 2.4]} m={term} />
      <Repeat positions={posts} geometry={postGeo} m={canopy} />
    </group>
  );
}

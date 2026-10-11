"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ANCHORS, BRIDGE_DECK, riverX } from "@/lib/city-layout";
import { createRng } from "@/lib/rng";
import { mat, PALETTE } from "@/lib/materials";
import { worldUniforms } from "@/lib/world-uniforms";
import { B, Cyl, Repeat } from "./primitives";

type V3 = [number, number, number];

/** A box stretched between two points. */
function Beam({ from, to, t, m }: { from: V3; to: V3; t: number; m: THREE.Material }) {
  const { pos, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return { pos: a.add(b).multiplyScalar(0.5), quat, len };
  }, [from, to]);
  return (
    <mesh position={pos} quaternion={quat} material={m} castShadow>
      <boxGeometry args={[t, len, t]} />
    </mesh>
  );
}

export function SignatureBridge() {
  const z = ANCHORS.signatureBridgeZ;
  const rx = riverX(z);
  const steel = mat("#eef0f1", { roughness: 0.4, metalness: 0.35, floodlit: true });
  const top: V3 = [rx - 2.4, 23, z];
  const legs: V3[] = [
    [rx + 3.8, BRIDGE_DECK, z - 2.3],
    [rx + 3.8, BRIDGE_DECK, z + 2.3],
  ];
  const cables = useMemo(() => {
    const pts: number[] = [];
    for (let i = 0; i < 11; i++) {
      const t = 0.55 + i * 0.04;
      const ax = legs[0][0] + (top[0] - legs[0][0]) * t;
      const ay = BRIDGE_DECK + (top[1] - BRIDGE_DECK) * t;
      for (const side of [-1.5, 1.5]) {
        // Main span (west, over the water) and back-stays (east).
        pts.push(ax, ay, z, rx - 9 + i * 0.75, BRIDGE_DECK + 0.1, z + side);
        pts.push(ax, ay, z, rx + 5 + i * 0.55, BRIDGE_DECK + 0.1, z + side);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
    // Geometry depends only on fixed layout constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rx, z]);
  useEffect(() => () => cables.dispose(), [cables]);
  return (
    <group>
      {legs.map((l, i) => (
        <Beam key={i} from={l} to={top} t={0.7} m={steel} />
      ))}
      <Beam from={[rx + 1.2, 11, z - 1.2]} to={[rx + 1.2, 11, z + 1.2]} t={0.4} m={steel} />
      <lineSegments geometry={cables}>
        <lineBasicMaterial color="#dfe6ea" transparent opacity={0.85} />
      </lineSegments>
    </group>
  );
}

function SawtoothShed({ p, w, d, r = 0 }: { p: V3; w: number; d: number; r?: number }) {
  const wall = mat("#d3d0c8");
  const roof = mat("#7f9bb0", { metalness: 0.2, roughness: 0.6 });
  const n = Math.max(2, Math.floor(w / 1.6));
  const tooth = w / n;
  const geo = useMemo(() => {
    // Right-triangle tooth: sloped roof plus a vertical north-light face.
    const s = new THREE.Shape();
    s.moveTo(-tooth / 2, 0);
    s.lineTo(tooth / 2, 0);
    s.lineTo(tooth / 2, 0.8);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    return g;
  }, [tooth, d]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <group position={p} rotation={[0, r, 0]}>
      <B p={[0, 0, 0]} s={[w, 1.6, d]} m={wall} />
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} geometry={geo} position={[-w / 2 + tooth * (i + 0.5), 1.6, 0]} material={roof} castShadow />
      ))}
    </group>
  );
}

function Chimney({ p, h = 10 }: { p: V3; h?: number }) {
  const conc = mat("#cfcac1");
  const red = mat("#c4473a");
  return (
    <group position={p}>
      <Cyl p={[0, 0, 0]} r={0.55} rTop={0.4} h={h} m={conc} seg={12} />
      <Cyl p={[0, h - 1.4, 0]} r={0.43} h={0.5} m={red} seg={12} shadow={false} />
      <Cyl p={[0, h - 0.5, 0]} r={0.41} h={0.5} m={red} seg={12} shadow={false} />
    </group>
  );
}

function Tank({ p, r = 1.3, h = 1.8 }: { p: V3; r?: number; h?: number }) {
  return (
    <group position={p}>
      <Cyl p={[0, 0, 0]} r={r} h={h} m={mat("#dfe2e4", { metalness: 0.4, roughness: 0.35 })} seg={18} />
      <Cyl p={[0, h, 0]} r={r} rTop={r * 0.2} h={0.35} m={mat("#c7ccd0", { metalness: 0.4, roughness: 0.35 })} seg={18} />
    </group>
  );
}

function Pile({ p, r, h, color }: { p: V3; r: number; h: number; color: string }) {
  return (
    <mesh position={[p[0], p[1] + h / 2, p[2]]} material={mat(color, { roughness: 1 })} castShadow receiveShadow>
      <coneGeometry args={[r, h, 9]} />
    </mesh>
  );
}

export function Industry() {
  return (
    <group>
      {/* Mayapuri */}
      <SawtoothShed p={[-95.5, 0, -16.5]} w={8} d={5} />
      <SawtoothShed p={[-88, 0, -27]} w={9} d={5.5} />
      <B p={[-85.5, 0, -14.5]} s={[4.5, 2.4, 3.5]} m={mat("#c9cdd0")} />
      <Chimney p={[-95, 0, -26]} />
      <Chimney p={[-86, 0, -17]} h={8.5} />
      <Tank p={[-98.6, 0, -30]} />
      <Tank p={[-95.6, 0, -30]} />
      <Tank p={[-99, 0, -21.5]} r={1.1} h={2.4} />
      <Pile p={[-90.5, 0, -21]} r={1.6} h={0.9} color="#8a5a3c" />
      <Pile p={[-92.5, 0, -13.8]} r={1.2} h={0.7} color="#7a6656" />
      <B p={[-91.5, 1.6, -22.4]} s={[11, 0.18, 0.3]} m={mat(PALETTE.steel, { metalness: 0.4 })} />
      {[-96.5, -91.5, -86.5].map((x) => (
        <B key={x} p={[x, 0, -22.4]} s={[0.15, 1.6, 0.15]} m={mat(PALETTE.steel)} />
      ))}
      {/* Sahibabad edge */}
      <SawtoothShed p={[124, 0, 32.5]} w={7} d={4.5} />
      <Chimney p={[127, 0, 29]} h={8} />
      <Tank p={[131.5, 0, 26]} r={1.1} />
      <Tank p={[131.5, 0, 33]} r={1.1} />
    </group>
  );
}

function TowerCrane({ p, h, jib, phase }: { p: V3; h: number; jib: number; phase: number }) {
  const slew = useRef<THREE.Group>(null);
  const yellow = mat(PALETTE.craneYellow, { roughness: 0.6 });
  const conc = mat("#9a968f");
  useFrame(() => {
    if (!slew.current) return;
    const t = worldUniforms.uTime.value * worldUniforms.uMotion.value;
    slew.current.rotation.y = phase + Math.sin(t * 0.07 + phase) * 1.3;
  });
  const lattice = useMemo<V3[]>(() => Array.from({ length: Math.floor(h / 1.1) }, (_, i) => [0, i * 1.1 + 0.5, 0]), [h]);
  const ringGeo = useMemo(() => new THREE.BoxGeometry(0.62, 0.06, 0.62), []);
  useEffect(() => () => ringGeo.dispose(), [ringGeo]);
  return (
    <group position={p}>
      <B p={[0, 0, 0]} s={[1.4, 0.4, 1.4]} m={conc} />
      <B p={[0, 0.4, 0]} s={[0.5, h, 0.5]} m={yellow} />
      <Repeat positions={lattice} geometry={ringGeo} m={yellow} />
      <group ref={slew} position={[0, h + 0.4, 0]}>
        <B p={[jib / 2 - 0.5, 0, 0]} s={[jib, 0.38, 0.38]} m={yellow} />
        <B p={[-2.2, 0, 0]} s={[4.4, 0.34, 0.5]} m={yellow} />
        <B p={[-3.6, -0.5, 0]} s={[1.1, 0.8, 0.8]} m={conc} />
        <B p={[0.4, -0.55, 0.45]} s={[0.6, 0.55, 0.5]} m={mat("#e9eef0")} />
        <mesh position={[0, 1.2, 0]} material={yellow} castShadow>
          <coneGeometry args={[0.35, 2.4, 4]} />
        </mesh>
        <B p={[jib * 0.62, -0.25, 0]} s={[0.5, 0.18, 0.45]} m={mat("#5a5f63")} />
        <mesh position={[jib * 0.62, -h * 0.25, 0]}>
          <boxGeometry args={[0.03, h * 0.45, 0.03]} />
          <meshBasicMaterial color="#3a3d40" />
        </mesh>
        <B p={[jib * 0.62, -h * 0.5 - 0.35, 0]} s={[0.9, 0.3, 0.6]} m={mat("#b98e5c")} />
      </group>
    </group>
  );
}

function Skeleton({ p, nx, nz, floors, spacing = 2.1 }: { p: V3; nx: number; nz: number; floors: number; spacing?: number }) {
  const conc = mat("#bdb8af");
  const slab = mat("#cfcac1");
  const cols = useMemo<V3[]>(() => {
    const out: V3[] = [];
    for (let f = 0; f < floors; f++) {
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          if (f === floors - 1 && (i + j) % 2 === 1) continue;
          out.push([(i - (nx - 1) / 2) * spacing, f * 0.95, (j - (nz - 1) / 2) * spacing]);
        }
      }
    }
    return out;
  }, [nx, nz, floors, spacing]);
  const colGeo = useMemo(() => new THREE.BoxGeometry(0.22, 0.82, 0.22).translate(0, 0.41, 0), []);
  useEffect(() => () => colGeo.dispose(), [colGeo]);
  const w = (nx - 1) * spacing + 0.6;
  const d = (nz - 1) * spacing + 0.6;
  return (
    <group position={p}>
      <Repeat positions={cols} geometry={colGeo} m={conc} shadow />
      {Array.from({ length: floors - 1 }, (_, f) => (
        <B key={f} p={[0, (f + 1) * 0.95 - 0.13, 0]} s={[w, 0.13, d]} m={slab} />
      ))}
    </group>
  );
}

function Fence({ x0, x1, z0, z1, gate }: { x0: number; x1: number; z0: number; z1: number; gate?: [number, number] }) {
  const geo = useMemo(() => new THREE.BoxGeometry(1.0, 0.7, 0.06).translate(0, 0.35, 0), []);
  const geoZ = useMemo(() => new THREE.BoxGeometry(0.06, 0.7, 1.0).translate(0, 0.35, 0), []);
  const { xs, zs } = useMemo(() => {
    const xs: V3[] = [];
    const zs: V3[] = [];
    for (let x = x0 + 0.5; x < x1; x += 1.0) {
      if (gate && x > gate[0] && x < gate[1]) continue;
      xs.push([x, 0, z0], [x, 0, z1]);
    }
    for (let z = z0 + 0.5; z < z1; z += 1.0) zs.push([x0, 0, z], [x1, 0, z]);
    return { xs, zs };
  }, [x0, x1, z0, z1, gate]);
  useEffect(
    () => () => {
      geo.dispose();
      geoZ.dispose();
    },
    [geo, geoZ],
  );
  const blue = mat(PALETTE.barrierBlue, { roughness: 0.6 });
  return (
    <>
      <Repeat positions={xs} geometry={geo} m={blue} />
      <Repeat positions={zs} geometry={geoZ} m={blue} />
    </>
  );
}

function Excavator({ p, r = 0 }: { p: V3; r?: number }) {
  const y = mat(PALETTE.craneYellow);
  return (
    <group position={p} rotation={[0, r, 0]}>
      <B p={[0, 0, 0]} s={[1.3, 0.3, 0.9]} m={mat("#3a3d40")} />
      <B p={[0, 0.3, 0]} s={[1.0, 0.5, 0.8]} m={y} />
      <Beam from={[0.4, 0.7, 0]} to={[1.4, 1.4, 0]} t={0.15} m={y} />
      <Beam from={[1.4, 1.4, 0]} to={[1.9, 0.3, 0]} t={0.13} m={y} />
    </group>
  );
}

export function ConstructionZones() {
  const piers = useMemo(() => Array.from({ length: 6 }, (_, i) => -74 + i * 3.6), []);
  return (
    <group>
      {/* Outer Ring Works */}
      <Fence x0={-75.5} x1={-54.5} z0={-89.5} z1={-66.5} gate={[-66, -62]} />
      <TowerCrane p={[-70, 0, -84]} h={14} jib={12} phase={0.4} />
      <TowerCrane p={[-60, 0, -73.5]} h={11.5} jib={10} phase={2.2} />
      <Skeleton p={[-65.5, 0, -81.5]} nx={4} nz={3} floors={5} />
      <Skeleton p={[-71.5, 0, -72]} nx={3} nz={3} floors={3} />
      {piers.map((x, i) => (
        <group key={x}>
          <B p={[x, 0, -68.6]} s={[0.6, 3.2, 0.6]} m={mat("#c4bfb6")} />
          <B p={[x, 3.2, -68.6]} s={[0.8, 0.35, 2.4]} m={mat("#c4bfb6")} />
          {i < 3 && <B p={[x + 1.8, 3.55, -68.6]} s={[3.6, 0.35, 2.2]} m={mat("#d2cdc4")} />}
        </group>
      ))}
      <Pile p={[-57.5, 0, -86]} r={1.6} h={1.1} color="#d1b98e" />
      <Pile p={[-56, 0, -82.2]} r={1.2} h={0.9} color="#9a948a" />
      <Pile p={[-62, 0, -88]} r={1.3} h={0.8} color="#c9ae80" />
      <Excavator p={[-58.5, 0, -77]} r={0.6} />
      {/* Laxmi Nagar metro works */}
      <Fence x0={101.5} x1={111.5} z0={-52.5} z1={-44.5} gate={[105, 108]} />
      <TowerCrane p={[104, 0, -50]} h={8} jib={6.5} phase={1.2} />
      <Pile p={[109, 0, -50.5]} r={1.1} h={0.7} color="#cbb28a" />
      <Excavator p={[108, 0, -47]} r={2.4} />
      {/* Hauz Khas redevelopment */}
      <Fence x0={-15.5} x1={-6.5} z0={56.5} z1={63} gate={[-12, -9.5]} />
      <Skeleton p={[-10, 0, 60]} nx={3} nz={2} floors={3} spacing={2} />
      <TowerCrane p={[-14, 0, 58.2]} h={8} jib={6} phase={3.1} />
      <Roadworks />
    </group>
  );
}

function Roadworks() {
  const { orange, white, cones } = useMemo(() => {
    const orange: V3[] = [];
    const white: V3[] = [];
    const cones: V3[] = [];
    for (let z = 89.5, i = 0; z < 103; z += 0.7, i++) (i % 2 ? white : orange).push([-20.45, 0, z]);
    for (let z = 88; z < 104; z += 3.2) cones.push([-20.9, 0, z]);
    return { orange, white, cones };
  }, []);
  const barGeo = useMemo(() => new THREE.BoxGeometry(0.08, 0.32, 0.66).translate(0, 0.16, 0), []);
  const coneGeo = useMemo(() => new THREE.ConeGeometry(0.1, 0.32, 6).translate(0, 0.16, 0), []);
  useEffect(
    () => () => {
      barGeo.dispose();
      coneGeo.dispose();
    },
    [barGeo, coneGeo],
  );
  return (
    <group>
      <Repeat positions={orange} geometry={barGeo} m={mat("#f08c00")} />
      <Repeat positions={white} geometry={barGeo} m={mat("#f5f3ee")} />
      <Repeat positions={cones} geometry={coneGeo} m={mat("#f26b1d")} />
      <B p={[-19.7, 0, 96]} s={[1.0, 0.06, 13]} m={mat("#a8865f", { roughness: 1 })} shadow={false} />
    </group>
  );
}

export function Landfill() {
  const geo = useMemo(() => {
    const g = new THREE.ConeGeometry(7, 5.2, 18, 5, false);
    const pos = g.getAttribute("position");
    const rng = createRng(11);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > 2.4) pos.setY(i, 2.4 + (y - 2.4) * 0.15);
      const n = 1 + (rng.next() - 0.5) * 0.18;
      pos.setX(i, pos.getX(i) * n);
      pos.setZ(i, pos.getZ(i) * n);
    }
    g.computeVertexNormals();
    g.translate(0, 2.6, 0);
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <group position={[127, 0, 89]}>
      <mesh geometry={geo} material={mat("#9c8b6d", { roughness: 1 })} castShadow receiveShadow />
      <B p={[-1, 3.2, 0.6]} s={[1.2, 0.5, 0.6]} m={mat("#d9542c")} />
      <B p={[1.4, 3.2, -1.2]} s={[1.2, 0.5, 0.6]} m={mat("#2e6fa3")} />
    </group>
  );
}

export function TollPlaza() {
  const angle = Math.atan2(56, 86);
  const canopy = mat("#e9e6df");
  const booth = mat("#f2b51d");
  return (
    <group position={[-98.03, 0, 73.92]} rotation={[0, angle, 0]}>
      <B p={[0, 1.7, 0]} s={[2.4, 0.26, 7.8]} m={canopy} />
      {[-3.6, 0, 3.6].map((z) => (
        <B key={z} p={[0, 0, z]} s={[0.25, 1.7, 0.25]} m={mat("#c9c5bd")} />
      ))}
      {[-2.6, -1.35, 1.35, 2.6].map((z) => (
        <B key={z} p={[0, 0, z]} s={[0.7, 0.85, 0.35]} m={booth} />
      ))}
      <B p={[0, 1.96, 0]} s={[0.6, 0.35, 5]} m={mat("#2f6f4f")} shadow={false} />
    </group>
  );
}

/** Slow river boats in the reaches between bridges. */
export function RiverBoats() {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const boats = useMemo(
    () => [
      { center: -14, range: 16, phase: 0, speed: 0.045, offset: -2.2 },
      { center: 24, range: 11, phase: 2, speed: 0.06, offset: 2.4 },
      { center: 70, range: 22, phase: 4, speed: 0.04, offset: -1.6 },
      { center: -92, range: 9, phase: 1, speed: 0.05, offset: 1.8 },
    ],
    [],
  );
  useFrame(() => {
    const t = worldUniforms.uTime.value * worldUniforms.uMotion.value;
    boats.forEach((b, i) => {
      const g = refs.current[i];
      if (!g) return;
      const s = Math.sin(t * b.speed + b.phase);
      const z = b.center + s * b.range;
      const x = riverX(z) + b.offset;
      const dir = Math.cos(t * b.speed + b.phase) >= 0 ? 1 : -1;
      const dz = 0.5;
      const dx = riverX(z + dz) - riverX(z);
      g.position.set(x, 0.06, z);
      g.rotation.y = Math.atan2(-dz * dir, dx * dir);
    });
  });
  const hull = mat("#f1ece2");
  const cabin = mat("#2f6f8f");
  return (
    <group>
      {boats.map((b, i) => (
        <group
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
        >
          <B p={[0, 0, 0]} s={[1.0, 0.16, 0.38]} m={hull} />
          <B p={[-0.1, 0.16, 0]} s={[0.4, 0.18, 0.3]} m={cabin} />
        </group>
      ))}
    </group>
  );
}

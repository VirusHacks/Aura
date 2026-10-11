"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { mat, PALETTE } from "@/lib/materials";

type V3 = [number, number, number];

/** Box whose `p` is the centre of its base. */
export function B({ p, s, m, r = 0, shadow = true }: { p: V3; s: V3; m: THREE.Material; r?: number; shadow?: boolean }) {
  return (
    <mesh position={[p[0], p[1] + s[1] / 2, p[2]]} rotation={[0, r, 0]} material={m} castShadow={shadow} receiveShadow>
      <boxGeometry args={s} />
    </mesh>
  );
}

/** Cylinder whose `p` is the centre of its base. */
export function Cyl({
  p,
  r,
  rTop,
  h,
  m,
  seg = 12,
  shadow = true,
}: {
  p: V3;
  r: number;
  rTop?: number;
  h: number;
  m: THREE.Material;
  seg?: number;
  shadow?: boolean;
}) {
  return (
    <mesh position={[p[0], p[1] + h / 2, p[2]]} material={m} castShadow={shadow} receiveShadow>
      <cylinderGeometry args={[rTop ?? r, r, h, seg]} />
    </mesh>
  );
}

/** Hemispherical / onion dome sitting on `p`. */
export function Dome({ p, r, m, stretch = 1, finial = true }: { p: V3; r: number; m: THREE.Material; stretch?: number; finial?: boolean }) {
  return (
    <group position={p}>
      <mesh scale={[1, stretch, 1]} material={m} castShadow>
        <sphereGeometry args={[r, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {finial && (
        <mesh position={[0, r * stretch + r * 0.18, 0]} material={mat("#c9a14a", { metalness: 0.4, roughness: 0.4 })}>
          <coneGeometry args={[r * 0.08, r * 0.4, 6]} />
        </mesh>
      )}
    </group>
  );
}

/** Small domed kiosk (chhatri) — a recurring Mughal/Rajput roof element. */
export function Chhatri({ p, size = 0.6, base = PALETTE.redSandstone, dome = PALETTE.marble }: { p: V3; size?: number; base?: string; dome?: string }) {
  const pillar = mat(base, { floodlit: true });
  const d = mat(dome, { floodlit: true });
  const o = size * 0.42;
  return (
    <group position={p}>
      {[
        [o, o],
        [-o, o],
        [o, -o],
        [-o, -o],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, size * 0.35, z]} material={pillar}>
          <boxGeometry args={[size * 0.12, size * 0.7, size * 0.12]} />
        </mesh>
      ))}
      <mesh position={[0, size * 0.75, 0]} material={pillar} castShadow>
        <boxGeometry args={[size * 1.1, size * 0.1, size * 1.1]} />
      </mesh>
      <Dome p={[0, size * 0.8, 0]} r={size * 0.45} m={d} stretch={1.15} />
    </group>
  );
}

/** A wall with a pointed/semicircular arch opening, extruded along Z. */
export function ArchWall({
  width,
  height,
  depth,
  archWidth,
  archHeight,
  m,
  arches = 1,
}: {
  width: number;
  height: number;
  depth: number;
  archWidth: number;
  archHeight: number;
  m: THREE.Material;
  arches?: number;
}) {
  const geo = useMemo(() => {
    // Single simple contour that dips up into each arch (holes touching the
    // outer edge would break triangulation).
    const s = new THREE.Shape();
    const r = archWidth / 2;
    const spacing = width / arches;
    s.moveTo(-width / 2, 0);
    for (let i = 0; i < arches; i++) {
      const cx = -width / 2 + spacing * (i + 0.5);
      s.lineTo(cx - r, 0);
      s.lineTo(cx - r, archHeight - r);
      s.absarc(cx, archHeight - r, r, Math.PI, 0, true);
      s.lineTo(cx + r, 0);
    }
    s.lineTo(width / 2, 0);
    s.lineTo(width / 2, height);
    s.lineTo(-width / 2, height);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
    g.translate(0, 0, -depth / 2);
    return g;
  }, [width, height, depth, archWidth, archHeight, arches]);
  return <mesh geometry={geo} material={m} castShadow receiveShadow />;
}

/** Instanced copies of one geometry at given positions (cheap repeated detail). */
export function Repeat({
  positions,
  geometry,
  m,
  shadow = false,
}: {
  positions: V3[];
  geometry: THREE.BufferGeometry;
  m: THREE.Material;
  shadow?: boolean;
}) {
  const mesh = useMemo(() => {
    const im = new THREE.InstancedMesh(geometry, m, Math.max(1, positions.length));
    const o = new THREE.Object3D();
    positions.forEach((p, i) => {
      o.position.set(p[0], p[1], p[2]);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
    });
    im.count = positions.length;
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    return im;
  }, [positions, geometry, m, shadow]);
  return <primitive object={mesh} />;
}

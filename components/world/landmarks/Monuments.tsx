"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { mat, PALETTE } from "@/lib/materials";
import { ArchWall, B, Chhatri, Cyl, Dome, Repeat } from "./primitives";

type V3 = [number, number, number];

export function IndiaGate() {
  const sand = mat("#d6b08a", { floodlit: true });
  const sandDark = mat("#c79d74", { floodlit: true });
  return (
    <group position={[20, 0, 8]}>
      <B p={[0, 0, 0]} s={[4.6, 0.45, 8.4]} m={sandDark} />
      <B p={[0, 0.45, 0]} s={[3.6, 0.2, 7.4]} m={sand} />
      <group position={[0, 0.65, 0]} rotation={[0, Math.PI / 2, 0]}>
        <ArchWall width={6.2} height={7.3} depth={2.5} archWidth={2.3} archHeight={5.5} m={sand} />
      </group>
      {/* Small side arches through the piers */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 2.1, s * 2.25]} material={mat(PALETTE.shadowInset)}>
          <boxGeometry args={[2.52, 1.7, 0.7]} />
        </mesh>
      ))}
      <B p={[0, 6.4, 0]} s={[2.75, 0.26, 6.5]} m={sandDark} />
      <B p={[0, 7.95, 0]} s={[2.75, 0.3, 6.6]} m={sandDark} />
      <B p={[0, 8.25, 0]} s={[2.2, 0.75, 5.3]} m={sand} />
      <B p={[0, 9.0, 0]} s={[1.85, 0.5, 4.1]} m={sandDark} />
      <B p={[0, 9.5, 0]} s={[1.45, 0.3, 2.8]} m={sand} />
      <Cyl p={[0, 9.8, 0]} r={0.75} rTop={0.5} h={0.4} m={sandDark} seg={18} />
      {/* Canopy east of the arch */}
      <group position={[6.2, 0, 0]}>
        <B p={[0, 0, 0]} s={[2.2, 0.3, 2.2]} m={sandDark} />
        {[
          [0.75, 0.75],
          [-0.75, 0.75],
          [0.75, -0.75],
          [-0.75, -0.75],
        ].map(([x, z], i) => (
          <B key={i} p={[x, 0.3, z]} s={[0.22, 2.1, 0.22]} m={sand} />
        ))}
        <B p={[0, 2.4, 0]} s={[2, 0.3, 2]} m={sandDark} />
        <Dome p={[0, 2.7, 0]} r={0.75} m={sand} stretch={0.9} />
      </group>
    </group>
  );
}

export function RashtrapatiBhavan() {
  const red = mat("#b8654a", { floodlit: true });
  const cream = mat("#ead9b8", { floodlit: true });
  const dome = mat("#b98a62", { floodlit: true });
  const colGeo = useMemo(() => new THREE.CylinderGeometry(0.1, 0.1, 1.25, 8).translate(0, 0.62, 0), []);
  const cols = useMemo<V3[]>(() => Array.from({ length: 9 }, (_, i) => [3.95, 0.25, -1.8 + i * 0.45]), []);
  return (
    <group position={[-36.5, 0, 8]}>
      <B p={[0, 0, 0]} s={[6, 0.8, 13.5]} m={red} />
      <B p={[0, 0.8, 0]} s={[5.6, 1.2, 13]} m={cream} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <B p={[3.4, 0, s * 5.3]} s={[2.2, 0.8, 2.6]} m={red} />
          <B p={[3.4, 0.8, s * 5.3]} s={[2.0, 1.0, 2.4]} m={cream} />
          <Chhatri p={[3.4, 1.8, s * 5.3]} size={0.6} base="#ead9b8" dome="#b98a62" />
        </group>
      ))}
      <B p={[3.4, 0, 0]} s={[1.3, 0.25, 4.6]} m={red} />
      <B p={[3.45, 1.5, 0]} s={[1.2, 0.3, 4.4]} m={cream} />
      <Repeat positions={cols} geometry={colGeo} m={cream} />
      <Cyl p={[0, 2.0, 0]} r={1.7} h={0.9} m={cream} seg={24} />
      <Dome p={[0, 2.9, 0]} r={1.8} m={dome} stretch={0.95} />
    </group>
  );
}

function wallMerlons(x0: number, z0: number, x1: number, z1: number, y: number, step = 0.8): V3[] {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.floor(len / step);
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    return [x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t] as V3;
  });
}

export function RedFort() {
  const red = mat("#b0513b", { floodlit: true });
  const redDark = mat("#984532", { floodlit: true });
  const marble = mat(PALETTE.marble, { floodlit: true });
  const inset = mat(PALETTE.shadowInset);
  const merlonGeo = useMemo(() => new THREE.BoxGeometry(0.34, 0.36, 0.34).translate(0, 0.18, 0), []);
  const H = 2.6;
  const merlons = useMemo<V3[]>(
    () => [
      ...wallMerlons(37.45, -82.5, 37.45, -72.7, H),
      ...wallMerlons(37.45, -69.3, 37.45, -59.5, H),
      ...wallMerlons(52.55, -82.5, 52.55, -59.5, H),
      ...wallMerlons(37.5, -82.55, 52.5, -82.55, H),
      ...wallMerlons(37.5, -59.45, 52.5, -59.45, H),
    ],
    [],
  );
  const corners: V3[] = [
    [37.45, 0, -82.55],
    [52.55, 0, -82.55],
    [37.45, 0, -59.45],
    [52.55, 0, -59.45],
  ];
  const bastions: V3[] = [
    [37.45, 0, -77],
    [37.45, 0, -65],
    [52.55, 0, -77],
    [52.55, 0, -71],
    [52.55, 0, -65],
    [41.5, 0, -82.55],
    [48.5, 0, -82.55],
    [41.5, 0, -59.45],
    [48.5, 0, -59.45],
  ];
  return (
    <group>
      {/* Walls */}
      <B p={[37.45, 0, -77.6]} s={[0.9, H, 9.8]} m={red} />
      <B p={[37.45, 0, -64.4]} s={[0.9, H, 9.8]} m={red} />
      <B p={[52.55, 0, -71]} s={[0.9, H, 23]} m={red} />
      <B p={[45, 0, -82.55]} s={[15.1, H, 0.9]} m={red} />
      <B p={[45, 0, -59.45]} s={[15.1, H, 0.9]} m={red} />
      <Repeat positions={merlons} geometry={merlonGeo} m={red} />
      {corners.map((p, i) => (
        <group key={i}>
          <Cyl p={p} r={1.15} h={3.4} m={redDark} seg={8} />
          <Chhatri p={[p[0], 3.4, p[2]]} size={1.0} />
        </group>
      ))}
      {bastions.map((p, i) => (
        <Cyl key={i} p={p} r={0.8} h={3.0} m={redDark} seg={8} />
      ))}
      {/* Lahori Gate */}
      <group position={[37.6, 0, -71]}>
        <B p={[0, 0, 0]} s={[2.6, 4.4, 4.2]} m={red} />
        <B p={[-1.32, 0, 0]} s={[0.08, 2.6, 1.5]} m={inset} shadow={false} />
        {[-2.3, 2.3].map((z) => (
          <group key={z}>
            <Cyl p={[-0.3, 0, z]} r={0.78} h={5.0} m={redDark} seg={8} />
            <Chhatri p={[-0.3, 5.0, z]} size={0.9} />
          </group>
        ))}
        {[-1.2, -0.4, 0.4, 1.2].map((z) => (
          <Chhatri key={z} p={[-0.6, 4.4, z]} size={0.42} />
        ))}
      </group>
      {/* Delhi Gate (south) */}
      <group position={[45, 0, -82.6]}>
        <B p={[0, 0, 0]} s={[3.4, 3.6, 2.2]} m={red} />
        <B p={[0, 0, -1.12]} s={[1.3, 2.2, 0.08]} m={inset} shadow={false} />
        {[-1.6, 1.6].map((x) => (
          <Chhatri key={x} p={[x, 3.6, 0]} size={0.7} />
        ))}
      </group>
      {/* Diwan-i-Aam */}
      <group position={[45.5, 0, -71]} rotation={[0, Math.PI / 2, 0]}>
        <B p={[0, 0, 0]} s={[5.6, 0.3, 3.6]} m={redDark} />
        <group position={[0, 0.3, 1.5]}>
          <ArchWall width={5.4} height={1.4} depth={0.4} archWidth={0.6} archHeight={1.1} m={red} arches={7} />
        </group>
        <B p={[0, 0.3, -0.2]} s={[5.4, 1.4, 3.0]} m={red} />
        <B p={[0, 1.7, 0]} s={[5.8, 0.15, 3.8]} m={redDark} />
      </group>
      {/* Marble palaces along the river wall */}
      {[-76.5, -71.2, -65.8].map((z, i) => (
        <group key={z}>
          <B p={[50.4, 0, z]} s={[2.4, 0.2, 4]} m={marble} />
          <B p={[50.4, 0.2, z]} s={[2.0, 1.2, 3.6]} m={marble} />
          <Chhatri p={[49.7, 1.4, z - 1.4]} size={0.45} base={PALETTE.marble} dome="#e9dfc9" />
          <Chhatri p={[49.7, 1.4, z + 1.4]} size={0.45} base={PALETTE.marble} dome="#e9dfc9" />
          {i === 1 && <Dome p={[50.4, 1.4, z]} r={0.6} m={marble} stretch={1.2} />}
        </group>
      ))}
      {/* Moti Masjid */}
      <group position={[47.5, 0, -63.2]}>
        <B p={[0, 0, 0]} s={[2.4, 0.9, 1.6]} m={marble} />
        {[-0.7, 0, 0.7].map((x) => (
          <Dome key={x} p={[x, 0.9, -0.2]} r={0.34} m={marble} stretch={1.4} />
        ))}
      </group>
    </group>
  );
}

function Minaret({ p }: { p: V3 }) {
  const red = mat("#b4573f", { floodlit: true });
  const redDark = mat("#9b4a35", { floodlit: true });
  const marble = mat(PALETTE.marble, { floodlit: true });
  return (
    <group position={p}>
      {[0, 1, 2].map((i) => (
        <group key={i} position={[0, i * 2.4, 0]}>
          <Cyl p={[0, 0, 0]} r={0.34 - i * 0.03} rTop={0.31 - i * 0.03} h={2.2} m={i % 2 ? marble : red} seg={10} />
          <Cyl p={[0, 2.2, 0]} r={0.5 - i * 0.03} h={0.14} m={marble} seg={12} />
          <Cyl p={[0, 2.34, 0]} r={0.33 - i * 0.03} h={0.06} m={redDark} seg={10} />
        </group>
      ))}
      <Chhatri p={[0, 7.2, 0]} size={0.6} />
    </group>
  );
}

export function JamaMasjid() {
  const red = mat("#b4573f", { floodlit: true });
  const redDark = mat("#9b4a35", { floodlit: true });
  const marble = mat(PALETTE.marble, { floodlit: true });
  const inset = mat(PALETTE.shadowInset);
  return (
    <group position={[20, 0, -60]}>
      {/* Plinth with stepped approach from the east */}
      <B p={[0, 0, 0]} s={[11, 1, 11]} m={red} />
      {[0, 1, 2].map((i) => (
        <B key={i} p={[5.5 + 0.9 - i * 0.3, 0, 0]} s={[1.8 - i * 0.6, 0.33 * (i + 1), 3.2]} m={redDark} />
      ))}
      {/* Cloister walls */}
      <B p={[0, 1, -5.25]} s={[11, 0.7, 0.5]} m={red} />
      <B p={[0, 1, 5.25]} s={[11, 0.7, 0.5]} m={red} />
      <B p={[5.25, 1, -3.6]} s={[0.5, 0.7, 3.8]} m={red} />
      <B p={[5.25, 1, 3.6]} s={[0.5, 0.7, 3.8]} m={red} />
      {/* Gateways */}
      <group position={[5.2, 1, 0]}>
        <B p={[0, 0, 0]} s={[1.6, 2.6, 3]} m={red} />
        <B p={[0.82, 0, 0]} s={[0.06, 1.7, 1.1]} m={inset} shadow={false} />
        <Chhatri p={[0, 2.6, -0.9]} size={0.5} />
        <Chhatri p={[0, 2.6, 0.9]} size={0.5} />
      </group>
      {[-1, 1].map((s) => (
        <group key={s} position={[0.5, 1, s * 5.2]}>
          <B p={[0, 0, 0]} s={[3, 2.2, 1.4]} m={red} />
          <B p={[0, 0, s * 0.72]} s={[1.0, 1.4, 0.06]} m={inset} shadow={false} />
          <Chhatri p={[0, 2.2, 0]} size={0.55} />
        </group>
      ))}
      {/* Ablution tank */}
      <B p={[0.8, 1, 0]} s={[2, 0.05, 2]} m={mat("#7fb0bb", { roughness: 0.3 })} shadow={false} />
      {/* Prayer hall */}
      <B p={[-4, 1, 0]} s={[2.8, 2.3, 8.4]} m={red} />
      <B p={[-2.58, 1, 0]} s={[0.1, 2.1, 7.6]} m={marble} />
      {[-2.4, 0, 2.4].map((z) => (
        <B key={z} p={[-2.52, 1, z]} s={[0.06, z === 0 ? 1.6 : 1.2, z === 0 ? 1.4 : 1.0]} m={inset} shadow={false} />
      ))}
      <Cyl p={[-4, 3.3, 0]} r={1.15} h={0.45} m={marble} seg={18} />
      <Dome p={[-4, 3.75, 0]} r={1.2} m={marble} stretch={1.3} />
      {[-2.7, 2.7].map((z) => (
        <group key={z}>
          <Cyl p={[-4, 3.3, z]} r={0.85} h={0.35} m={marble} seg={16} />
          <Dome p={[-4, 3.65, z]} r={0.88} m={marble} stretch={1.3} />
        </group>
      ))}
      <Minaret p={[-2.7, 1, -4.6]} />
      <Minaret p={[-2.7, 1, 4.6]} />
      {[
        [5.2, 5.2],
        [5.2, -5.2],
        [-5.2, 5.2],
        [-5.2, -5.2],
      ].map(([x, z], i) => (
        <Chhatri key={i} p={[x, 1, z]} size={0.6} />
      ))}
    </group>
  );
}

function flutedCylinder(rb: number, rt: number, h: number, flutes = 16) {
  const seg = flutes * 2;
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, false);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const a = Math.atan2(z, x);
    const j = Math.round(a / ((Math.PI * 2) / seg));
    const f = j % 2 === 0 ? 1.09 : 0.97;
    pos.setX(i, x * f);
    pos.setZ(i, z * f);
  }
  g.computeVertexNormals();
  g.translate(0, h / 2, 0);
  return g;
}

export function QutubMinar() {
  const red = mat("#b45a3c", { floodlit: true });
  const buff = mat("#e0cba8", { floodlit: true });
  const band = mat("#c8785a", { floodlit: true });
  const storeys = useMemo(() => {
    const spec: [number, number, number][] = [
      [1.55, 1.25, 5.4],
      [1.18, 0.98, 3.9],
      [0.93, 0.8, 2.9],
      [0.76, 0.66, 2.1],
      [0.62, 0.55, 1.7],
    ];
    let y = 0.35;
    return spec.map(([rb, rt, h], i) => {
      const item = { geo: flutedCylinder(rb, rt, h), y, rt, h, i };
      y += h + 0.2;
      return item;
    });
  }, []);
  const top = storeys[storeys.length - 1];
  const stone = mat(PALETTE.greySandstone);
  return (
    <group>
      <group position={[-12.5, 0, 86]}>
        <Cyl p={[0, 0, 0]} r={2.1} h={0.35} m={stone} seg={20} />
        {storeys.map((s) => (
          <group key={s.i}>
            <mesh geometry={s.geo} position={[0, s.y, 0]} material={s.i < 3 ? red : buff} castShadow receiveShadow />
            {s.i < 3 && <Cyl p={[0, s.y + s.h * 0.45, 0]} r={s.rt * 1.16 + 0.05} h={0.12} m={band} seg={24} shadow={false} />}
            <Cyl p={[0, s.y + s.h, 0]} r={s.rt + 0.32} h={0.18} m={s.i < 3 ? band : buff} seg={24} />
            <Cyl p={[0, s.y + s.h - 0.12, 0]} r={s.rt + 0.2} rTop={s.rt + 0.32} h={0.12} m={mat("#8f4a34")} seg={24} shadow={false} />
          </group>
        ))}
        <Cyl p={[0, top.y + top.h + 0.18, 0]} r={0.36} h={0.5} m={buff} seg={12} />
        <Dome p={[0, top.y + top.h + 0.68, 0]} r={0.38} m={buff} stretch={1.1} />
      </group>
      {/* Quwwat-ul-Islam arched screen, Alai Darwaza and the iron pillar */}
      <group position={[-14.2, 0, 81.2]}>
        <ArchWall width={5.4} height={3.3} depth={0.6} archWidth={1.0} archHeight={2.6} m={mat("#a9846a")} arches={3} />
      </group>
      <group position={[-16.6, 0, 90.6]}>
        <B p={[0, 0, 0]} s={[2.5, 2.3, 2.5]} m={red} />
        <B p={[1.26, 0.2, 0]} s={[0.04, 1.5, 0.9]} m={mat(PALETTE.shadowInset)} shadow={false} />
        <Dome p={[0, 2.3, 0]} r={1.05} m={mat(PALETTE.marble, { floodlit: true })} stretch={0.85} />
      </group>
      <Cyl p={[-10.3, 0, 83.6]} r={0.09} h={1.7} m={mat("#3a3f44", { metalness: 0.5, roughness: 0.4 })} seg={8} />
      <B p={[-12.5, 0, 79.3]} s={[12, 0.8, 0.5]} m={stone} />
      <B p={[-18.5, 0, 86]} s={[0.5, 0.8, 13]} m={stone} />
    </group>
  );
}

export function LotusTemple() {
  const white = mat("#f5f4f0", { roughness: 0.55, floodlit: true });
  const petalGeo = useMemo(() => {
    const pts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.5, 0.25),
      new THREE.Vector2(0.78, 0.9),
      new THREE.Vector2(0.72, 1.7),
      new THREE.Vector2(0.4, 2.45),
      new THREE.Vector2(0, 2.9),
    ];
    const g = new THREE.LatheGeometry(pts, 14);
    g.scale(0.42, 1, 1);
    return g;
  }, []);
  const rings = [
    { n: 9, r: 2.4, tilt: -0.5, scale: 0.85, off: 0 },
    { n: 9, r: 1.55, tilt: -0.16, scale: 1.1, off: Math.PI / 9 },
    { n: 9, r: 0.75, tilt: 0.22, scale: 1.25, off: 0 },
  ];
  return (
    <group position={[46, 0, 86]}>
      <Cyl p={[0, 0, 0]} r={4.7} h={0.35} m={white} seg={36} />
      <Cyl p={[0, 0.35, 0]} r={3.2} h={0.3} m={white} seg={36} />
      {rings.map((ring, k) =>
        Array.from({ length: ring.n }, (_, i) => {
          const a = (i / ring.n) * Math.PI * 2 + ring.off;
          return (
            <group key={`${k}-${i}`} position={[0, 0.65, 0]} rotation={[0, -a, 0]}>
              <mesh geometry={petalGeo} material={white} position={[ring.r, 0, 0]} rotation={[0, 0, ring.tilt]} scale={ring.scale} castShadow />
            </group>
          );
        }),
      )}
    </group>
  );
}

export function LodhiTombs() {
  const stone = mat(PALETTE.greySandstone, { floodlit: true });
  const dome = mat("#a99a80", { floodlit: true });
  const glazed = mat("#8aa6a2", { floodlit: true });
  return (
    <group>
      <group position={[10.8, 0, 24.2]}>
        <Cyl p={[0, 0, 0]} r={2.3} h={0.3} m={stone} seg={8} />
        <Cyl p={[0, 0.3, 0]} r={1.7} h={1.35} m={stone} seg={8} />
        <Cyl p={[0, 1.65, 0]} r={1.1} h={0.5} m={stone} seg={16} />
        <Dome p={[0, 2.15, 0]} r={1.15} m={dome} stretch={1.05} />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
          return <Chhatri key={i} p={[Math.cos(a) * 1.4, 1.65, Math.sin(a) * 1.4]} size={0.34} base={PALETTE.greySandstone} dome="#a99a80" />;
        })}
      </group>
      <group position={[24.5, 0, 21]}>
        <B p={[0, 0, 0]} s={[2.7, 2.5, 2.7]} m={stone} />
        <Cyl p={[0, 2.5, 0]} r={1.0} h={0.35} m={stone} seg={16} />
        <Dome p={[0, 2.85, 0]} r={1.1} m={dome} />
      </group>
      <group position={[25.5, 0, 29]}>
        <B p={[0, 0, 0]} s={[2.4, 2.2, 2.4]} m={stone} />
        <Cyl p={[0, 2.2, 0]} r={0.95} h={0.3} m={stone} seg={16} />
        <Dome p={[0, 2.5, 0]} r={1.0} m={glazed} />
      </group>
    </group>
  );
}

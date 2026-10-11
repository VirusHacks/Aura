"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { MotionValue } from "motion/react";
import { getCityModel, roadSegments } from "@/lib/city-generator";
import { riverX, RIVER_HALF_WIDTH, WORLD } from "@/lib/city-layout";
import { createRadialTexture } from "@/lib/ground-texture";
import { getAqiColor } from "@/lib/aqi";
import { JOURNEY } from "@/lib/landing-data";
import type { ZoneReading } from "@/types/air-quality";
import type { Vec2 } from "@/types/scene";

export type DioramaMode = "hero" | "journey";

export interface DioramaProps {
  mode: DioramaMode;
  readings: ZoneReading[];
  reducedMotion: boolean;
  mobile: boolean;
  /** Journey only: 0–1 scroll progress of the story. */
  progress?: MotionValue<number>;
}

interface Theme {
  fog: string;
  ground: string;
  river: string;
  road: string;
  street: string;
  building: [string, string];
  particle: string;
  particleOpacity: number;
  additive: boolean;
}

const THEMES: Record<DioramaMode, Theme> = {
  hero: {
    fog: "#ece9e2",
    ground: "#e2ddd2",
    river: "#b9c6cd",
    road: "#c6c0b4",
    street: "#d6d0c5",
    building: ["#f8f6f1", "#d8d2c6"],
    particle: "#6b625a",
    particleOpacity: 0.32,
    additive: false,
  },
  journey: {
    fog: "#1b1f23",
    ground: "#1f2428",
    river: "#17262f",
    road: "#2d343b",
    street: "#252b31",
    building: ["#3a4148", "#2a3036"],
    particle: "#c9c2b6",
    particleOpacity: 0.22,
    additive: true,
  },
};

const tmp = new THREE.Object3D();
const tmpColor = new THREE.Color();

// ─── Ground, river, roads, buildings ────────────────────────────────────────

function Ground({ theme }: { theme: Theme }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-0.02} receiveShadow>
      <planeGeometry args={[900, 900]} />
      <meshStandardMaterial color={theme.ground} roughness={1} />
    </mesh>
  );
}

function River({ theme }: { theme: Theme }) {
  const geometry = useMemo(() => {
    const pts: number[] = [];
    const idx: number[] = [];
    const steps = 80;
    for (let i = 0; i <= steps; i++) {
      const z = WORLD.minZ - 40 + ((WORLD.maxZ - WORLD.minZ + 80) * i) / steps;
      const x = riverX(z);
      pts.push(x - RIVER_HALF_WIDTH, 0.01, z, x + RIVER_HALF_WIDTH, 0.01, z);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color={theme.river} roughness={0.35} metalness={0.1} />
    </mesh>
  );
}

function Roads({ theme }: { theme: Theme }) {
  const city = getCityModel();
  const groups = useMemo(() => {
    const major: [Vec2, Vec2, number][] = [];
    const minor: [Vec2, Vec2, number][] = [];
    for (const road of [...city.roads, ...city.streets]) {
      const bucket = road.kind === "street" || road.kind === "market" ? minor : major;
      for (const [a, b] of roadSegments(road)) bucket.push([a, b, road.width]);
    }
    return { major, minor };
  }, [city]);

  return (
    <>
      <SegmentMesh segments={groups.major} color={theme.road} y={0.03} />
      <SegmentMesh segments={groups.minor} color={theme.street} y={0.02} />
    </>
  );
}

function SegmentMesh({ segments, color, y }: { segments: [Vec2, Vec2, number][]; color: string; y: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    segments.forEach(([a, b, w], i) => {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      tmp.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
      tmp.rotation.set(0, -Math.atan2(dz, dx), 0);
      tmp.scale.set(Math.hypot(dx, dz) + w * 0.5, 0.04, w);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [segments, y]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, segments.length]} receiveShadow>
      <boxGeometry />
      <meshStandardMaterial color={color} roughness={1} />
    </instancedMesh>
  );
}

function Buildings({ theme, mobile }: { theme: Theme; mobile: boolean }) {
  const { buildings: b } = getCityModel();
  const ref = useRef<THREE.InstancedMesh>(null);
  // Phones get every other building: the silhouette survives, the cost halves.
  const indices = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < b.count; i += mobile ? 2 : 1) out.push(i);
    return out;
  }, [b.count, mobile]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const light = new THREE.Color(theme.building[0]);
    const dark = new THREE.Color(theme.building[1]);
    indices.forEach((k, i) => {
      tmp.position.set(b.x[k], b.h[k] / 2, b.z[k]);
      tmp.rotation.set(0, b.rot[k], 0);
      tmp.scale.set(b.w[k], b.h[k], b.d[k]);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
      // Deterministic per-building tone so the city reads as many blocks.
      const t = (Math.sin(k * 12.9898) * 43758.5453) % 1;
      tmpColor.copy(dark).lerp(light, Math.abs(t));
      mesh.setColorAt(i, tmpColor);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [b, indices, theme]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, indices.length]} castShadow={!mobile} receiveShadow>
      <boxGeometry />
      <meshStandardMaterial roughness={0.9} />
    </instancedMesh>
  );
}

// ─── Pollution: zone haze, hotspots, drifting particles ─────────────────────

function ZoneHaze({ readings, theme }: { readings: ZoneReading[]; theme: Theme }) {
  const texture = useMemo(() => createRadialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)", 128), []);
  useLayoutEffect(() => () => texture.dispose(), [texture]);
  return (
    <group>
      {readings.map((r) => {
        const strength = THREE.MathUtils.clamp((r.aqi - 100) / 300, 0.08, 1);
        return (
          <mesh key={r.id} rotation-x={-Math.PI / 2} position={[r.position[0], 0.12, r.position[1]]} renderOrder={2}>
            <planeGeometry args={[r.radius * 3.4, r.radius * 3.4]} />
            <meshBasicMaterial
              map={texture}
              color={getAqiColor(r.aqi)}
              transparent
              opacity={(theme.additive ? 0.5 : 0.62) * strength}
              depthWrite={false}
              blending={theme.additive ? THREE.AdditiveBlending : THREE.NormalBlending}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function Hotspots({ readings, theme, reducedMotion }: { readings: ZoneReading[]; theme: Theme; reducedMotion: boolean }) {
  const hot = useMemo(() => [...readings].sort((a, b) => b.aqi - a.aqi).slice(0, 5), [readings]);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    if (reducedMotion) return;
    rings.current.forEach((ring, i) => {
      if (!ring) return;
      const t = (clock.elapsedTime * 0.45 + i * 0.37) % 1;
      ring.scale.setScalar(1 + t * 2.4);
      (ring.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.7;
    });
  });
  return (
    <group>
      {hot.map((r, i) => {
        const color = getAqiColor(r.aqi);
        const height = 16 + (r.aqi - 200) * 0.12;
        return (
          <group key={r.id} position={[r.position[0], 0, r.position[1]]}>
            <mesh position-y={height / 2} renderOrder={3}>
              <cylinderGeometry args={[0.55, 0.55, height, 12, 1, true]} />
              <meshBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} />
            </mesh>
            <mesh position-y={height} renderOrder={3}>
              <sphereGeometry args={[1.7, 20, 14]} />
              <meshBasicMaterial color={color} />
            </mesh>
            <mesh
              ref={(m) => {
                rings.current[i] = m;
              }}
              rotation-x={-Math.PI / 2}
              position-y={0.2}
              renderOrder={3}
            >
              <ringGeometry args={[2.4, 2.9, 40]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={0.5}
                depthWrite={false}
                blending={theme.additive ? THREE.AdditiveBlending : THREE.NormalBlending}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

const particleVertex = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  attribute float aSeed;
  varying float vFade;
  void main() {
    vec3 p = position;
    p.z = mod(p.z + uTime * (0.6 + aSeed * 0.8) + 140.0, 280.0) - 140.0;
    p.x += sin(uTime * 0.17 + aSeed * 6.283) * 3.0;
    p.y += sin(uTime * 0.31 + aSeed * 11.0) * 1.2;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.6 + aSeed) * (320.0 / -mv.z);
    vFade = 1.0 - smoothstep(110.0, 140.0, abs(p.z));
  }
`;
const particleFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, a * uOpacity * vFade);
  }
`;

function Particles({ readings, theme, count, reducedMotion }: { readings: ZoneReading[]; theme: Theme; count: number; reducedMotion: boolean }) {
  const { geometry, material } = useMemo(() => {
    // Particles cluster where the air is worse: zones are sampled by AQI weight.
    const weights = readings.map((r) => Math.max(0, r.aqi - 120) ** 1.4);
    const total = weights.reduce((a, b) => a + b, 0);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let pick = rand() * total;
      let zone = readings[0];
      for (let k = 0; k < readings.length; k++) {
        pick -= weights[k];
        if (pick <= 0) {
          zone = readings[k];
          break;
        }
      }
      const spread = i % 4 === 0 ? 140 : zone.radius * 2.2;
      const cx = i % 4 === 0 ? 0 : zone.position[0];
      const cz = i % 4 === 0 ? 0 : zone.position[1];
      pos[i * 3] = cx + (rand() - 0.5) * spread * 2;
      pos[i * 3 + 1] = 1.5 + rand() ** 1.6 * 26;
      pos[i * 3 + 2] = cz + (rand() - 0.5) * spread * 2;
      seeds[i] = rand();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      blending: theme.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 2.4 },
        uColor: { value: new THREE.Color(theme.particle) },
        uOpacity: { value: theme.particleOpacity },
      },
    });
    return { geometry: g, material: m };
  }, [readings, theme, count]);

  useLayoutEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const ref = useRef<THREE.Points>(null);
  useFrame((_, delta) => {
    const m = ref.current?.material as THREE.ShaderMaterial | undefined;
    if (m && !reducedMotion) m.uniforms.uTime.value += Math.min(delta, 0.05);
  });

  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} renderOrder={4} />;
}

// ─── Cameras ────────────────────────────────────────────────────────────────

function HeroCamera({ reducedMotion, mobile }: { reducedMotion: boolean; mobile: boolean }) {
  const { camera, pointer } = useThree();
  // The canvas itself sits right of the headline; frame the city inside it.
  const target = useMemo(() => new THREE.Vector3(mobile ? 22 : -24, 0, mobile ? -6 : -2), [mobile]);
  const smooth = useRef(new THREE.Vector2());
  useFrame(({ clock }, delta) => {
    const t = reducedMotion ? 0 : clock.elapsedTime;
    if (!reducedMotion) smooth.current.lerp(pointer, 1 - Math.exp(-delta * 2));
    const angle = 0.62 + Math.sin(t * 0.045) * 0.16 + smooth.current.x * 0.06;
    const radius = mobile ? 360 : 300;
    const height = (mobile ? 250 : 170) + smooth.current.y * 10;
    camera.position.set(target.x + Math.sin(angle) * radius, height, target.z + Math.cos(angle) * radius);
    camera.lookAt(target);
  });
  return null;
}

/** Point a fraction `f` (0–1) of the way along a polyline. */
function along(points: Vec2[], f: number): Vec2 {
  const lens = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  let d = THREE.MathUtils.clamp(f, 0, 1) * lens.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const k = lens[i] ? Math.min(1, d / lens[i]) : 0;
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * k, points[i][1] + (points[i + 1][1] - points[i][1]) * k];
    }
    d -= lens[i];
  }
  return points[points.length - 1];
}

/**
 * Story beats, in scroll progress:
 *   0.00–0.30  walk Lodhi Garden → India Gate
 *   0.30–0.45  keep heading north toward Connaught Place; the hotspot swells
 *   0.45–0.70  alert, then the cleaner route draws in
 *   0.70–1.00  turn east along the cleaner route via Yamuna Riverfront
 */
export const BEATS = { arrive: 0.3, alert: 0.45, reroute: 0.7 } as const;

function Journey({ readings, progress, reducedMotion, mobile }: { readings: ZoneReading[]; progress: MotionValue<number>; reducedMotion: boolean; mobile: boolean }) {
  const byId = useMemo(() => new Map(readings.map((r) => [r.id, r])), [readings]);
  const pos = (id: string) => byId.get(id)!.position;
  const lodhi = pos("z-lg");
  const gate = pos(JOURNEY.alertAt);
  const cp = pos(JOURNEY.hotspot);
  // Where the walker stops when the alert lands: a fifth of the way to the hotspot.
  const turn: Vec2 = [gate[0] + (cp[0] - gate[0]) * 0.22, gate[1] + (cp[1] - gate[1]) * 0.22];
  const fastestAhead = JOURNEY.fastest.slice(JOURNEY.fastest.indexOf(JOURNEY.alertAt)).map(pos);
  const cleanerAhead: Vec2[] = [turn, ...JOURNEY.cleaner.slice(JOURNEY.cleaner.indexOf(JOURNEY.alertAt) + 1).map(pos)];

  const avatar = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const hotspot = useRef<THREE.Mesh>(null);
  const fastestLine = useRef<THREE.Group>(null);
  const cleanerLine = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const look = useMemo(() => new THREE.Vector3(), []);
  const glow = useMemo(() => createRadialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)", 128), []);
  useLayoutEffect(() => () => glow.dispose(), [glow]);

  const lineOpacity = (group: THREE.Group | null, value: number) => {
    group?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material & { opacity: number } | undefined;
      if (m && "opacity" in m) m.opacity = value;
    });
  };

  useFrame(({ clock }) => {
    const p = progress.get();
    let at: Vec2;
    if (p < BEATS.arrive) at = along([lodhi, gate], p / BEATS.arrive);
    else if (p < BEATS.alert) at = along([gate, turn], (p - BEATS.arrive) / (BEATS.alert - BEATS.arrive));
    else if (p < BEATS.reroute) at = turn;
    else at = along(cleanerAhead, ((p - BEATS.reroute) / (1 - BEATS.reroute)) * 0.62);
    avatar.current?.position.set(at[0], 0, at[1]);

    const t = reducedMotion ? 0 : clock.elapsedTime;
    if (halo.current) {
      const k = reducedMotion ? 0.5 : (t * 0.8) % 1;
      halo.current.scale.setScalar(1 + k * 1.8);
      (halo.current.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
    }
    // The hotspot swells as the walker closes in, then settles once rerouted.
    const threat = THREE.MathUtils.smoothstep(p, 0.15, BEATS.alert) * (1 - 0.6 * THREE.MathUtils.smoothstep(p, BEATS.reroute, 0.9));
    if (hotspot.current) {
      hotspot.current.scale.setScalar(1 + threat * 0.9 + (reducedMotion ? 0 : Math.sin(t * 3) * 0.05 * threat));
      (hotspot.current.material as THREE.MeshBasicMaterial).opacity = 0.25 + threat * 0.55;
    }
    lineOpacity(fastestLine.current, 0.95 - 0.7 * THREE.MathUtils.smoothstep(p, BEATS.alert + 0.1, BEATS.reroute));
    lineOpacity(cleanerLine.current, THREE.MathUtils.smoothstep(p, BEATS.alert + 0.08, BEATS.reroute - 0.04));

    // Camera eases from a wide establishing shot to follow the walker, who is
    // kept right of centre, between the caption and the watch.
    const zoom = THREE.MathUtils.smoothstep(p, 0, 0.5);
    const radius = THREE.MathUtils.lerp(240, 165, zoom);
    const shift = mobile ? 0 : radius * 0.13;
    look.set(
      THREE.MathUtils.lerp(10, at[0] - 0.82 * shift, zoom),
      0,
      THREE.MathUtils.lerp(-6, at[1] + 0.58 * shift - (mobile ? 18 : 0), zoom),
    );
    camera.position.set(look.x + radius * 0.55, radius * 0.62, look.z + radius * 0.78);
    camera.lookAt(look);
  });

  const cyan = "#2ccbf2";
  return (
    <group>
      <mesh ref={hotspot} rotation-x={-Math.PI / 2} position={[cp[0], 0.3, cp[1]]} renderOrder={5}>
        <planeGeometry args={[34, 34]} />
        <meshBasicMaterial map={glow} color={getAqiColor(byId.get(JOURNEY.hotspot)!.aqi)} transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      <Line points={[lodhi, gate].map(([x, z]) => [x, 0.5, z] as const)} color={cyan} lineWidth={2.5} transparent opacity={0.9} depthTest={false} renderOrder={7} />
      <group ref={fastestLine}>
        <Line points={fastestAhead.map(([x, z]) => [x, 0.5, z] as const)} color="#f08c00" lineWidth={2.5} dashed dashSize={2.4} gapSize={1.6} transparent opacity={0.95} depthTest={false} renderOrder={7} />
      </group>
      <group ref={cleanerLine}>
        <Line points={cleanerAhead.map(([x, z]) => [x, 0.6, z] as const)} color={cyan} lineWidth={3.5} transparent opacity={0} depthTest={false} renderOrder={8} />
      </group>

      <group ref={avatar}>
        <mesh position-y={2.2} renderOrder={6}>
          <sphereGeometry args={[1.6, 24, 16]} />
          <meshBasicMaterial color={cyan} />
        </mesh>
        <mesh position-y={9} renderOrder={6}>
          <cylinderGeometry args={[0.18, 0.18, 14, 8, 1, true]} />
          <meshBasicMaterial color={cyan} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh ref={halo} rotation-x={-Math.PI / 2} position-y={0.4} renderOrder={6}>
          <ringGeometry args={[2.4, 3.1, 40]} />
          <meshBasicMaterial color={cyan} transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      </group>
    </group>
  );
}

// ─── Scene ──────────────────────────────────────────────────────────────────

export default function DelhiDiorama({ mode, readings, reducedMotion, mobile, progress }: DioramaProps) {
  const theme = THEMES[mode];
  return (
    <>
      <fog attach="fog" args={[theme.fog, mode === "hero" ? 300 : 170, mode === "hero" ? 720 : 420]} />
      <hemisphereLight args={[mode === "hero" ? "#fffdf8" : "#9fb6c8", mode === "hero" ? "#cfc6b6" : "#151a1e", mode === "hero" ? 1.05 : 0.9]} />
      <directionalLight
        position={[-130, 120, 70]}
        intensity={mode === "hero" ? 2.6 : 0.8}
        color={mode === "hero" ? "#fff6ea" : "#cfe2f2"}
        castShadow={!mobile}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-160}
        shadow-camera-right={160}
        shadow-camera-top={160}
        shadow-camera-bottom={-160}
        shadow-camera-far={500}
        shadow-bias={-0.0005}
      />
      <Ground theme={theme} />
      <River theme={theme} />
      <Roads theme={theme} />
      <Buildings theme={theme} mobile={mobile} />
      <ZoneHaze readings={readings} theme={theme} />
      {mode === "hero" && <Hotspots readings={readings} theme={theme} reducedMotion={reducedMotion} />}
      <Particles readings={readings} theme={theme} count={mobile ? 700 : 1600} reducedMotion={reducedMotion} />
      {mode === "hero" && <HeroCamera reducedMotion={reducedMotion} mobile={mobile} />}
      {mode === "journey" && progress && <Journey readings={readings} progress={progress} reducedMotion={reducedMotion} mobile={mobile} />}
    </>
  );
}

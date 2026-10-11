"use client";

import { useEffect, useMemo, useRef } from "react";
import type { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { WORLD } from "@/lib/city-layout";
import { LIGHTING_PRESETS, resolveLighting } from "@/lib/lighting";
import { updateFloodlights } from "@/lib/materials";
import { createRng } from "@/lib/rng";
import { scenarioConditions } from "@/lib/simulation-engine";
import { MAX_ZONES, worldUniforms } from "@/lib/world-uniforms";
import { useSimStore } from "@/store/simulation-store";

/** Advances shared uniforms: clock, eased zone AQI values, wind, haze and heat tint. */
export function WorldClock() {
  const readings = useSimStore((s) => s.readings);
  const timeIndex = useSimStore((s) => s.timeIndex);
  const preset = useSimStore((s) => s.preset);
  const heat = useSimStore((s) => s.layers.heatmap);
  const reducedMotion = useSimStore((s) => s.reducedMotion);
  const cond = useMemo(() => scenarioConditions(timeIndex, preset), [timeIndex, preset]);
  const targets = useMemo(() => readings.slice(0, MAX_ZONES), [readings]);
  const windTarget = useMemo(() => {
    const to = THREE.MathUtils.degToRad(cond.windFrom + 180);
    return new THREE.Vector2(Math.sin(to), -Math.cos(to));
  }, [cond]);
  const primed = useRef(false);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const u = worldUniforms;
    u.uMotion.value += ((reducedMotion ? 0.2 : 1) - u.uMotion.value) * Math.min(1, dt * 3);
    u.uTime.value += dt * (reducedMotion ? 0.35 : 1);
    const k = primed.current ? Math.min(1, dt * 2.5) : 1;
    targets.forEach((r, i) => {
      const v = u.uZones.value[i];
      v.x = r.position[0];
      v.y = r.position[1];
      v.z = r.radius;
      v.w += (r.aqi - v.w) * k;
    });
    u.uZoneCount.value = targets.length;
    u.uWindDir.value.lerp(windTarget, k).normalize();
    u.uWindSpeed.value += (cond.windSpeed - u.uWindSpeed.value) * k;
    u.uHaze.value += (cond.haze - u.uHaze.value) * k;
    u.uHeat.value += ((heat ? 1 : 0) - u.uHeat.value) * Math.min(1, dt * 4);
    primed.current = true;
  });
  return null;
}

export function Lighting({ shadowMapSize }: { shadowMapSize: number }) {
  const mode = useSimStore((s) => s.lighting);
  const timeIndex = useSimStore((s) => s.timeIndex);
  const resolved = resolveLighting(mode, timeIndex);
  const preset = LIGHTING_PRESETS[resolved];
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const scene = useThree((s) => s.scene);
  const controls = useThree((s) => s.controls) as unknown as CameraControls | null;

  const state = useMemo(
    () => ({
      sunDir: new THREE.Vector3(...LIGHTING_PRESETS.day.sun).normalize(),
      sunColor: new THREE.Color(LIGHTING_PRESETS.day.sunColor),
      sky: new THREE.Color(LIGHTING_PRESETS.day.skyColor),
      ground: new THREE.Color(LIGHTING_PRESETS.day.groundColor),
      fog: new THREE.Color(LIGHTING_PRESETS.day.fog),
      target: new THREE.Vector3(),
      half: 0,
      tmpDir: new THREE.Vector3(),
      tmpColor: new THREE.Color(),
    }),
    [],
  );

  const fog = useMemo(() => new THREE.Fog(LIGHTING_PRESETS.day.fog, 300, 900), []);
  useEffect(() => {
    scene.fog = fog;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const k = 1 - Math.exp(-dt * 2.2);
    const s = sun.current;
    if (!s || !hemi.current || !ambient.current) return;
    state.sunDir.lerp(state.tmpDir.set(...preset.sun).normalize(), k).normalize();
    state.sunColor.lerp(state.tmpColor.set(preset.sunColor), k);
    state.sky.lerp(state.tmpColor.set(preset.skyColor), k);
    state.ground.lerp(state.tmpColor.set(preset.groundColor), k);
    state.fog.lerp(state.tmpColor.set(preset.fog), k);
    s.color.copy(state.sunColor);
    s.intensity += (preset.sunIntensity - s.intensity) * k;
    hemi.current.color.copy(state.sky);
    hemi.current.groundColor.copy(state.ground);
    hemi.current.intensity += (preset.hemiIntensity - hemi.current.intensity) * k;
    ambient.current.intensity += (preset.ambient - ambient.current.intensity) * k;
    const u = worldUniforms;
    u.uNight.value += (preset.night - u.uNight.value) * k;
    updateFloodlights(u.uNight.value);

    // Haze: neutral atmospheric depth that thickens with the scenario's haze level.
    const haze = u.uHaze.value;
    fog.color.copy(state.fog).lerp(state.tmpColor.set(resolved === "night" ? "#1d2333" : "#d6cdbd"), haze * 0.45);
    fog.near = 300 - haze * 190;
    fog.far = 980 - haze * 420;

    // Shadow frustum follows the camera target so close-ups get crisp shadows.
    const distance = controls?.distance ?? 300;
    if (controls) controls.getTarget(state.target);
    const half = Math.round(THREE.MathUtils.clamp(distance * 0.75, 45, 165) / 15) * 15;
    const texel = (half * 2) / shadowMapSize;
    const tx = Math.round(state.target.x / texel) * texel;
    const tz = Math.round(state.target.z / texel) * texel;
    s.target.position.set(tx, 0, tz);
    s.target.updateMatrixWorld();
    s.position.set(tx + state.sunDir.x * 260, state.sunDir.y * 260, tz + state.sunDir.z * 260);
    if (half !== state.half) {
      state.half = half;
      const cam = s.shadow.camera;
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.updateProjectionMatrix();
    }
  });

  return (
    <>
      <directionalLight
        ref={sun}
        castShadow
        intensity={LIGHTING_PRESETS.day.sunIntensity}
        shadow-mapSize={[shadowMapSize, shadowMapSize]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-near={10}
        shadow-camera-far={620}
      />
      <hemisphereLight ref={hemi} intensity={LIGHTING_PRESETS.day.hemiIntensity} />
      <ambientLight ref={ambient} intensity={LIGHTING_PRESETS.day.ambient} />
    </>
  );
}

/** A few soft low-poly clouds drifting with the wind. */
export function Clouds() {
  const clouds = useMemo(() => {
    const rng = createRng(77);
    return Array.from({ length: 6 }, () => ({
      x: rng.range(WORLD.minX, WORLD.maxX),
      z: rng.range(WORLD.minZ, WORLD.maxZ),
      y: rng.range(52, 62),
      s: rng.range(1.3, 2.2),
      puffs: Array.from({ length: 5 }, (_, i) => [i * 1.5 - 3 + rng.range(-0.4, 0.4), rng.range(0, 0.8), rng.range(-1, 1), rng.range(1.2, 2)] as const),
    }));
  }, []);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, transparent: true, opacity: 0.88, flatShading: true }), []);
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  useEffect(
    () => () => {
      material.dispose();
      geo.dispose();
    },
    [material, geo],
  );
  useFrame(() => {
    const u = worldUniforms;
    const t = u.uTime.value * u.uMotion.value;
    const w = u.uWindDir.value;
    const spanX = WORLD.maxX - WORLD.minX + 80;
    const spanZ = WORLD.maxZ - WORLD.minZ + 80;
    clouds.forEach((c, i) => {
      const g = refs.current[i];
      if (!g) return;
      const x = ((((c.x + w.x * t * 0.8 - WORLD.minX + 40) % spanX) + spanX) % spanX) + WORLD.minX - 40;
      const z = ((((c.z + w.y * t * 0.8 - WORLD.minZ + 40) % spanZ) + spanZ) % spanZ) + WORLD.minZ - 40;
      g.position.set(x, c.y, z);
    });
    const n = u.uNight.value;
    material.opacity = 0.42 - n * 0.27;
    material.color.setRGB(1 - n * 0.55, 1 - n * 0.5, 1 - n * 0.4);
  });
  return (
    <group>
      {clouds.map((c, i) => (
        <group
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          scale={c.s}
        >
          {c.puffs.map(([x, y, z, r], j) => (
            <mesh key={j} geometry={geo} material={material} position={[x, y, z]} scale={[r, r * 0.62, r]} raycast={() => null} />
          ))}
        </group>
      ))}
    </group>
  );
}

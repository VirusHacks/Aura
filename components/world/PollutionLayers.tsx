"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { getAqiColor } from "@/lib/aqi";
import { WORLD, WORLD_DEPTH, WORLD_WIDTH } from "@/lib/city-layout";
import { createRng } from "@/lib/rng";
import { sourceEmitHeight } from "@/lib/scene-anchors";
import { AQI_GLSL, MAX_ZONES, worldUniforms } from "@/lib/world-uniforms";
import type { SourceCategory, SourceReading, ZoneReading } from "@/types/air-quality";

/** Ground heatmap: continuous AQI field with band isolines and a fine survey grid. */
export function AqiHeatmap({ visible }: { visible: boolean }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        uniforms: {
          uZones: worldUniforms.uZones,
          uZoneCount: worldUniforms.uZoneCount,
          uAlpha: worldUniforms.uHeatAlpha,
          uHeat: worldUniforms.uHeat,
          uNight: worldUniforms.uNight,
        },
        vertexShader: /* glsl */ `
          varying vec2 vXZ;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vXZ = wp.xz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uAlpha;
          uniform float uHeat;
          uniform float uNight;
          varying vec2 vXZ;
          ${AQI_GLSL}
          void main() {
            float a = aqiField(vXZ);
            vec3 col = aqiColor(a);
            // Isolines at every AQI band boundary (100, 200, 300, 400).
            float t = a / 100.0;
            float iso = abs(fract(t - 0.5) - 0.5) / max(fwidth(t), 1e-4);
            float line = 1.0 - min(iso / 1.2, 1.0);
            // Survey grid every 6 units.
            vec2 g = abs(fract(vXZ / 6.0 - 0.5) - 0.5) / fwidth(vXZ / 6.0);
            float grid = 1.0 - min(min(g.x, g.y), 1.0);
            vec2 edge = min(vXZ - vec2(${WORLD.minX.toFixed(1)}, ${WORLD.minZ.toFixed(1)}), vec2(${WORLD.maxX.toFixed(1)}, ${WORLD.maxZ.toFixed(1)}) - vXZ);
            float fade = smoothstep(0.0, 6.0, min(edge.x, edge.y));
            float alpha = uAlpha * (0.85 + 0.15 * smoothstep(100.0, 400.0, a));
            alpha += line * 0.32 + grid * 0.05;
            col = mix(col, col * 0.55, line * 0.6);
            gl_FragColor = vec4(col * mix(1.0, 1.25, uNight), alpha * fade * uHeat);
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh
      position={[(WORLD.minX + WORLD.maxX) / 2, 0.07, (WORLD.minZ + WORLD.maxZ) / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={material}
      visible={visible}
      renderOrder={2}
      raycast={() => null}
    >
      <planeGeometry args={[WORLD_WIDTH, WORLD_DEPTH]} />
    </mesh>
  );
}

/** Dashed rings marking each zone's nominal boundary. */
export function ZoneBoundaries({
  readings,
  visible,
  selectedId,
}: {
  readings: ZoneReading[];
  visible: boolean;
  selectedId: string | null;
}) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uColor: { value: new THREE.Color() }, uRadius: { value: 10 }, uTime: worldUniforms.uTime, uSel: { value: 0 } },
        vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uRadius; uniform float uTime; uniform float uSel;
          varying vec2 vP;
          void main(){
            float ang = atan(vP.y, vP.x);
            float dash = step(0.45, fract(ang * uRadius / 2.2 - uTime * 0.15 * uSel));
            gl_FragColor = vec4(uColor, (0.55 + 0.4 * uSel) * dash);
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );
  const mats = useMemo(() => readings.map(() => material.clone()), [readings, material]);
  useEffect(() => {
    readings.forEach((r, i) => {
      const m = mats[i];
      m.uniforms.uColor.value.set(getAqiColor(r.aqi));
      m.uniforms.uRadius.value = r.radius;
      m.uniforms.uSel.value = r.id === selectedId ? 1 : 0;
      m.uniforms.uTime = worldUniforms.uTime;
    });
  }, [readings, mats, selectedId]);
  useEffect(
    () => () => {
      material.dispose();
      mats.forEach((m) => m.dispose());
    },
    [material, mats],
  );
  return (
    <group visible={visible}>
      {readings.map((r, i) => (
        <mesh
          key={r.id}
          position={[r.position[0], 0.09, r.position[1]]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={mats[i]}
          renderOrder={3}
          raycast={() => null}
        >
          <ringGeometry args={[r.radius - (r.id === selectedId ? 0.45 : 0.25), r.radius + (r.id === selectedId ? 0.45 : 0.25), 96]} />
        </mesh>
      ))}
    </group>
  );
}

const SOURCE_TINT: Record<SourceCategory, string> = {
  traffic: "#8e959e",
  construction: "#cdb38a",
  industrial: "#7f786c",
  commercial: "#a39b8e",
  "waste-burning": "#6e655b",
};

/** Wind-driven particle plumes from each source, computed on the GPU. */
export function SourcePlumes({ sources, visible, perSource }: { sources: SourceReading[]; visible: boolean; perSource: number }) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const activity = useMemo(() => ({ value: new Float32Array(32) }), []);
  const scale = useMemo(() => ({ value: 400 }), []);

  const geometry = useMemo(() => {
    const rng = createRng(99);
    const n = sources.length * perSource;
    const origin = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const src = new Float32Array(n);
    const color = new Float32Array(n * 3);
    sources.forEach((s, si) => {
      const c = new THREE.Color(SOURCE_TINT[s.category]);
      const h = sourceEmitHeight(s);
      for (let k = 0; k < perSource; k++) {
        const i = si * perSource + k;
        origin.set([s.position[0], h, s.position[1]], i * 3);
        seed[i] = rng.next();
        src[i] = si;
        color.set([c.r, c.g, c.b], i * 3);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(origin, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    g.setAttribute("aSource", new THREE.BufferAttribute(src, 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 400);
    return g;
    // Only the list of sources (ids/positions) changes the buffers; activity is a uniform.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources.length, perSource]);

  useEffect(() => {
    sources.forEach((s, i) => {
      activity.value[i] = s.activity;
    });
  }, [sources, activity]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: worldUniforms.uTime,
          uWindDir: worldUniforms.uWindDir,
          uWindSpeed: worldUniforms.uWindSpeed,
          uNight: worldUniforms.uNight,
          uActivity: activity,
          uScale: scale,
        },
        vertexShader: /* glsl */ `
          attribute float aSeed;
          attribute float aSource;
          attribute vec3 aColor;
          uniform float uTime;
          uniform vec2 uWindDir;
          uniform float uWindSpeed;
          uniform float uActivity[32];
          uniform float uScale;
          varying float vAlpha;
          varying vec3 vColor;
          void main() {
            float act = uActivity[int(aSource + 0.5)];
            float speed = 0.06 + uWindSpeed * 0.012;
            float life = fract(uTime * speed * (0.8 + aSeed * 0.4) + aSeed * 17.0);
            vec3 rnd = vec3(fract(aSeed * 91.7) - 0.5, fract(aSeed * 47.3), fract(aSeed * 13.9) - 0.5);
            float travel = life * (5.0 + uWindSpeed * 3.4);
            vec3 p = position + vec3(uWindDir.x, 0.0, uWindDir.y) * travel;
            float buoyancy = 1.6 - min(uWindSpeed, 6.0) / 6.0;
            p.y += life * (1.5 + rnd.y * 2.2) * (0.6 + buoyancy);
            p.xz += rnd.xz * (0.5 + life * 4.5);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float sz = (0.9 + life * 4.2) * (0.55 + act * 0.75);
            gl_PointSize = min(sz * uScale / -mv.z, 180.0);
            gl_Position = projectionMatrix * mv;
            vAlpha = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.5, 1.0, life)) * act * 0.4;
            vColor = aColor;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uNight;
          varying float vAlpha;
          varying vec3 vColor;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.05, d) * vAlpha;
            if (a < 0.003) discard;
            gl_FragColor = vec4(vColor * mix(1.0, 0.55, uNight), a);
            #include <colorspace_fragment>
          }
        `,
      }),
    [activity, scale],
  );

  useFrame(() => {
    scale.value = size.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  });

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return <points geometry={geometry} material={material} visible={visible} renderOrder={5} frustumCulled={false} raycast={() => null} />;
}

/** Ambient particulate drifting inside each zone; density follows that zone's AQI. */
export function AmbientHaze({ zoneCount, visible, perZone }: { zoneCount: number; visible: boolean; perZone: number }) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const scale = useMemo(() => ({ value: 400 }), []);
  const geometry = useMemo(() => {
    const rng = createRng(5);
    const n = Math.min(zoneCount, MAX_ZONES) * perZone;
    const pos = new Float32Array(n * 3);
    const zone = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos.set([rng.next() * 2 - 1, rng.range(0.6, 7), rng.next() * 2 - 1], i * 3);
      zone[i] = Math.floor(i / perZone);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aZone", new THREE.BufferAttribute(zone, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 400);
    return g;
  }, [zoneCount, perZone]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uZones: worldUniforms.uZones,
          uZoneCount: worldUniforms.uZoneCount,
          uTime: worldUniforms.uTime,
          uWindDir: worldUniforms.uWindDir,
          uWindSpeed: worldUniforms.uWindSpeed,
          uHaze: worldUniforms.uHaze,
          uNight: worldUniforms.uNight,
          uScale: scale,
        },
        vertexShader: /* glsl */ `
          attribute float aZone;
          uniform float uTime;
          uniform vec2 uWindDir;
          uniform float uWindSpeed;
          uniform float uHaze;
          uniform float uScale;
          varying float vAlpha;
          varying vec3 vColor;
          ${AQI_GLSL}
          void main() {
            vec4 z = uZones[int(aZone + 0.5)];
            float R = z.z * 1.1;
            vec2 drift = uWindDir * uTime * (0.4 + uWindSpeed * 0.35);
            vec2 local = mod(position.xz * R + drift + R, 2.0 * R) - R;
            float radial = 1.0 - smoothstep(0.55, 1.0, length(local) / R);
            vec3 p = vec3(z.x + local.x, position.y + sin(uTime * 0.3 + position.x * 9.0) * 0.4, z.y + local.y);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = min(2.6 * uScale / -mv.z, 90.0);
            gl_Position = projectionMatrix * mv;
            float level = smoothstep(110.0, 460.0, z.w);
            vAlpha = radial * level * (0.12 + uHaze * 0.22);
            vColor = mix(vec3(0.62, 0.58, 0.52), aqiColor(z.w), 0.25);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uNight;
          varying float vAlpha;
          varying vec3 vColor;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d) * vAlpha;
            if (a < 0.003) discard;
            gl_FragColor = vec4(vColor * mix(1.0, 0.6, uNight), a);
            #include <colorspace_fragment>
          }
        `,
      }),
    [scale],
  );
  useFrame(() => {
    scale.value = size.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  });
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <points geometry={geometry} material={material} visible={visible} renderOrder={4} frustumCulled={false} raycast={() => null} />;
}

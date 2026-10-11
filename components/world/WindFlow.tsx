"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { WORLD, WORLD_DEPTH, WORLD_WIDTH } from "@/lib/city-layout";
import { createRng } from "@/lib/rng";
import { worldUniforms } from "@/lib/world-uniforms";

/**
 * Illustrative wind streams: chevrons advected across the city along the
 * scenario wind vector. Movement is a visual cue, not a flow simulation.
 */
export function WindFlow({ visible, count }: { visible: boolean; count: number }) {
  const geometry = useMemo(() => {
    // Chevron pointing +X built from two slim quads.
    const base = new THREE.BufferGeometry();
    const w = 0.16;
    const L = 1.2;
    const verts: number[] = [];
    const arm = (sx: number, sz: number, ex: number, ez: number) => {
      const dx = ex - sx;
      const dz = ez - sz;
      const len = Math.hypot(dx, dz);
      const nx = (-dz / len) * w;
      const nz = (dx / len) * w;
      verts.push(sx + nx, 0, sz + nz, ex + nx, 0, ez + nz, ex - nx, 0, ez - nz);
      verts.push(sx + nx, 0, sz + nz, ex - nx, 0, ez - nz, sx - nx, 0, sz - nz);
    };
    arm(-L / 2, -0.55, L / 2, 0);
    arm(-L / 2, 0.55, L / 2, 0);
    // Short tail streak.
    arm(-L * 2.4, 0, -L * 0.7, 0);
    base.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute("position", base.getAttribute("position"));
    const rng = createRng(31);
    const offsets = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) offsets.set([rng.next(), rng.range(9, 14), rng.next()], i * 3);
    g.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offsets, 3));
    g.instanceCount = count;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 400);
    return g;
  }, [count]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: worldUniforms.uTime,
          uWindDir: worldUniforms.uWindDir,
          uWindSpeed: worldUniforms.uWindSpeed,
          uNight: worldUniforms.uNight,
        },
        vertexShader: /* glsl */ `
          attribute vec3 aOffset;
          uniform float uTime;
          uniform vec2 uWindDir;
          uniform float uWindSpeed;
          varying float vAlpha;
          const vec2 SIZE = vec2(${WORLD_WIDTH.toFixed(1)}, ${WORLD_DEPTH.toFixed(1)});
          const vec2 MINP = vec2(${WORLD.minX.toFixed(1)}, ${WORLD.minZ.toFixed(1)});
          void main() {
            vec2 dir = normalize(uWindDir);
            float speed = 2.5 + uWindSpeed * 2.2;
            vec2 uv = fract(aOffset.xz + dir * uTime * speed / SIZE);
            vec2 base = MINP + uv * SIZE;
            // Gentle meander so streams don't look like a conveyor belt.
            vec2 nrm = vec2(-dir.y, dir.x);
            base += nrm * sin(uTime * 0.25 + aOffset.x * 40.0 + base.x * 0.03) * 2.0;
            float scale = 1.0 + uWindSpeed * 0.12;
            vec3 p = position * scale;
            vec2 rot = vec2(dir.x * p.x - dir.y * p.z, dir.y * p.x + dir.x * p.z);
            vec3 world = vec3(base.x + rot.x, aOffset.y, base.y + rot.y);
            gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
            vec2 edge = min(uv, 1.0 - uv);
            vAlpha = smoothstep(0.0, 0.06, min(edge.x, edge.y));
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uNight;
          varying float vAlpha;
          void main() {
            vec3 day = vec3(0.16, 0.36, 0.52);
            vec3 night = vec3(0.62, 0.86, 1.0);
            gl_FragColor = vec4(mix(day, night, uNight), vAlpha * mix(0.42, 0.55, uNight));
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return <mesh geometry={geometry} material={material} visible={visible} renderOrder={6} frustumCulled={false} raycast={() => null} />;
}

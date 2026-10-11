"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { RIVER_HALF_WIDTH, WORLD, WORLD_DEPTH, WORLD_WIDTH, riverX } from "@/lib/city-layout";
import { createGroundTexture, createRadialTexture } from "@/lib/ground-texture";
import { worldUniforms } from "@/lib/world-uniforms";

const SLAB_DEPTH = 5;

function createRiverGeometry() {
  const shape = new THREE.Shape();
  const step = 2;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let z = WORLD.minZ; z <= WORLD.maxZ + 0.01; z += step) {
    const cx = riverX(z);
    left.push([cx - RIVER_HALF_WIDTH, z]);
    right.push([cx + RIVER_HALF_WIDTH, z]);
  }
  // Shape lives in (x, −z) so that rotating −90° about X lands it on the ground facing up.
  shape.moveTo(left[0][0], -left[0][1]);
  for (const [x, z] of left.slice(1)) shape.lineTo(x, -z);
  for (const [x, z] of right.reverse()) shape.lineTo(x, -z);
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

export function CityGround({ textureSize }: { textureSize: number }) {
  const groundTex = useMemo(() => createGroundTexture(textureSize), [textureSize]);
  const shadowTex = useMemo(() => createRadialTexture("rgba(40,32,20,0.35)", "rgba(40,32,20,0)"), []);
  const riverGeo = useMemo(() => createRiverGeometry(), []);

  const waterMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: "#6f9ea8", roughness: 0.22, metalness: 0.05 });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = worldUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
        .replace(
          "#include <project_vertex>",
          "#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying vec3 vWPos;")
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
float flow = sin(vWPos.z * 0.9 - uTime * 0.8 + sin(vWPos.x * 1.7) * 1.4) * sin(vWPos.z * 0.37 + vWPos.x * 0.6 - uTime * 0.35);
diffuseColor.rgb += vec3(0.05, 0.07, 0.07) * smoothstep(0.55, 0.95, flow);`,
        );
    };
    m.customProgramCacheKey = () => "aeroscope-water";
    return m;
  }, []);

  useEffect(
    () => () => {
      groundTex.dispose();
      shadowTex.dispose();
      riverGeo.dispose();
      waterMat.dispose();
    },
    [groundTex, shadowTex, riverGeo, waterMat],
  );

  const cx = (WORLD.minX + WORLD.maxX) / 2;
  const cz = (WORLD.minZ + WORLD.maxZ) / 2;

  return (
    <group>
      {/* Diorama slab */}
      <mesh position={[cx, -SLAB_DEPTH / 2 - 0.001, cz]} receiveShadow>
        <boxGeometry args={[WORLD_WIDTH, SLAB_DEPTH, WORLD_DEPTH]} />
        <meshStandardMaterial color="#cdc3b1" roughness={0.95} />
      </mesh>
      <mesh position={[cx, -SLAB_DEPTH - 0.05, cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[WORLD_WIDTH * 1.5, WORLD_DEPTH * 1.6]} />
        <meshBasicMaterial map={shadowTex} transparent depthWrite={false} />
      </mesh>
      {/* Painted ground */}
      <mesh position={[cx, 0, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[WORLD_WIDTH, WORLD_DEPTH]} />
        <meshStandardMaterial map={groundTex} roughness={0.96} metalness={0} />
      </mesh>
      {/* Yamuna */}
      <mesh geometry={riverGeo} material={waterMat} position={[0, 0.03, 0]} receiveShadow />
    </group>
  );
}

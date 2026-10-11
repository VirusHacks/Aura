"use client";

import { useEffect, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { CityModel, PropSet } from "@/lib/city-generator";
import { unitBox, unitCylinder, unitPrism, writeMatrix } from "@/lib/geometry";
import { patchBuildingMaterial } from "@/lib/world-uniforms";

/** Generic instanced prop renderer for generator PropSets. */
export function PropInstances({
  set,
  geometry,
  material,
  castShadow = false,
  receiveShadow = true,
  yOffset = 0,
}: {
  set: PropSet;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow?: boolean;
  receiveShadow?: boolean;
  yOffset?: number;
}) {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, Math.max(1, set.count));
    const arr = m.instanceMatrix.array as Float32Array;
    const d = set.data;
    for (let i = 0; i < set.count; i++) {
      const o = i * 7;
      writeMatrix(arr, i, d[o], d[o + 1] + yOffset, d[o + 2], d[o + 3], d[o + 4], d[o + 5], d[o + 6]);
    }
    if (set.color) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(set.color), 3);
    }
    m.count = set.count;
    m.castShadow = castShadow;
    m.receiveShadow = receiveShadow;
    m.computeBoundingSphere();
    return m;
  }, [set, geometry, material, castShadow, receiveShadow, yOffset]);
  useEffect(() => () => mesh.dispose(), [mesh]);
  return <primitive object={mesh} />;
}

export function Buildings({
  city,
  onSelect,
}: {
  city: CityModel;
  onSelect: (index: number, point: THREE.Vector3) => void;
}) {
  const b = city.buildings;

  const { geometry, material } = useMemo(() => {
    const g = unitBox();
    const style = new THREE.InstancedBufferAttribute(new Float32Array(b.style), 1);
    g.setAttribute("aStyle", style);
    const m = patchBuildingMaterial(new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.02 }));
    return { geometry: g, material: m };
  }, [b]);

  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, b.count);
    const arr = m.instanceMatrix.array as Float32Array;
    for (let i = 0; i < b.count; i++) writeMatrix(arr, i, b.x[i], 0, b.z[i], b.rot[i], b.w[i], b.h[i], b.d[i]);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(b.color), 3);
    m.castShadow = true;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    return m;
  }, [geometry, material, b]);

  const props = useMemo(() => {
    const prop = (opts: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...opts });
    return {
      box: unitBox(),
      cyl: unitCylinder(10),
      prism: unitPrism(),
      tankMat: prop({ roughness: 0.6 }),
      roomMat: prop({}),
      capMat: prop({ roughness: 0.7, metalness: 0.15 }),
      roofMat: prop({ roughness: 0.9 }),
    };
  }, []);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
      Object.values(props).forEach((p) => p.dispose());
    },
    [geometry, material, mesh, props],
  );

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6 || e.instanceId === undefined) return;
    e.stopPropagation();
    onSelect(e.instanceId, e.point);
  };

  return (
    <group>
      <primitive object={mesh} onClick={handleClick} />
      <PropInstances set={city.tanks} geometry={props.cyl} material={props.tankMat} castShadow />
      <PropInstances set={city.stairRooms} geometry={props.box} material={props.roomMat} castShadow />
      <PropInstances set={city.roofCaps} geometry={props.box} material={props.capMat} />
      <PropInstances set={city.pitchedRoofs} geometry={props.prism} material={props.roofMat} castShadow />
    </group>
  );
}

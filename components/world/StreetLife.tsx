"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CityModel } from "@/lib/city-generator";
import { createLampGeometry, createStallGeometry, createTreeGeometries, createVehicleGeometries, writeMatrix } from "@/lib/geometry";
import { createRadialTexture } from "@/lib/ground-texture";
import { signalPhase } from "@/lib/scene-paths";
import { patchTreeMaterial, worldUniforms } from "@/lib/world-uniforms";
import { PropInstances } from "./Buildings";

export function Vegetation({ city }: { city: CityModel }) {
  const res = useMemo(() => {
    const geos = createTreeGeometries();
    const mat = patchTreeMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
    return { ...geos, mat };
  }, []);
  useEffect(
    () => () => {
      res.round.dispose();
      res.tall.dispose();
      res.mat.dispose();
    },
    [res],
  );
  return (
    <group>
      <PropInstances set={city.treesRound} geometry={res.round} material={res.mat} castShadow />
      <PropInstances set={city.treesTall} geometry={res.tall} material={res.mat} castShadow />
    </group>
  );
}

export function StreetFurniture({ city }: { city: CityModel }) {
  const res = useMemo(() => {
    const lamp = createLampGeometry();
    const vehicles = createVehicleGeometries();
    const glowTex = createRadialTexture("rgba(255,214,150,0.9)", "rgba(255,214,150,0)");
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    glowGeo.rotateX(-Math.PI / 2);
    return {
      lamp,
      vehicles,
      stall: createStallGeometry(),
      poleMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }),
      headMat: new THREE.MeshStandardMaterial({ color: "#d9d6cf", emissive: "#ffd28a", emissiveIntensity: 0 }),
      glowGeo,
      glowMat: new THREE.MeshBasicMaterial({
        map: glowTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      glowTex,
      carMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 }),
      stallMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
    };
  }, []);

  // Glow pools sit under each lamp head.
  const glowSet = useMemo(() => {
    const d = city.lamps.data;
    const out = new Float32Array(city.lamps.count * 7);
    for (let i = 0; i < city.lamps.count; i++) {
      const o = i * 7;
      const rot = d[o + 3];
      out[o] = d[o] + Math.cos(rot) * 0.6;
      out[o + 1] = 0.06;
      out[o + 2] = d[o + 2] - Math.sin(rot) * 0.6;
      out[o + 3] = 0;
      out[o + 4] = 3.4;
      out[o + 5] = 1;
      out[o + 6] = 3.4;
    }
    return { count: city.lamps.count, data: out };
  }, [city]);

  useFrame(() => {
    const n = worldUniforms.uNight.value;
    res.headMat.emissiveIntensity = n * 2.2;
    res.glowMat.opacity = n * 0.55;
    res.glowMat.visible = n > 0.02;
  });

  useEffect(
    () => () => {
      res.lamp.pole.dispose();
      res.lamp.head.dispose();
      Object.values(res.vehicles).forEach((v) => {
        v.body.dispose();
        v.lights.dispose();
      });
      res.stall.dispose();
      res.poleMat.dispose();
      res.headMat.dispose();
      res.glowGeo.dispose();
      res.glowMat.dispose();
      res.glowTex.dispose();
      res.carMat.dispose();
      res.stallMat.dispose();
    },
    [res],
  );

  return (
    <group>
      <PropInstances set={city.lamps} geometry={res.lamp.pole} material={res.poleMat} />
      <PropInstances set={city.lamps} geometry={res.lamp.head} material={res.headMat} />
      <PropInstances set={glowSet} geometry={res.glowGeo} material={res.glowMat} receiveShadow={false} />
      <PropInstances set={city.parkedCars} geometry={res.vehicles.car.body} material={res.carMat} />
      <PropInstances set={city.parkedBuses} geometry={res.vehicles.bus.body} material={res.carMat} />
      <PropInstances set={city.parkedTrucks} geometry={res.vehicles.truck.body} material={res.carMat} />
      <PropInstances set={city.stalls} geometry={res.stall} material={res.stallMat} castShadow />
      <TrafficSignals city={city} />
    </group>
  );
}

const SIGNAL_COLORS = {
  green: new THREE.Color("#22c55e"),
  amber: new THREE.Color("#f59e0b"),
  red: new THREE.Color("#ef4444"),
};

/** Signal poles at every arterial junction; heads change with the shared signal clock. */
function TrafficSignals({ city }: { city: CityModel }) {
  const { poles, poleGeo, poleMat, lightGeo, lightMat, heads } = useMemo(() => {
    // Two poles per junction: one facing E–W traffic, one facing N–S.
    const heads: { x: number; z: number; ew: boolean; signal: number }[] = [];
    const data: number[] = [];
    city.signals.forEach((s, i) => {
      const corners: [number, number, boolean][] = [
        [s.x + 2.7, s.z + 2.7, true],
        [s.x - 2.7, s.z - 2.7, false],
      ];
      for (const [x, z, ew] of corners) {
        data.push(x, 0, z, 0, 1, 1, 1);
        heads.push({ x, z, ew, signal: i });
      }
    });
    const pg = new THREE.CylinderGeometry(0.05, 0.06, 1.5, 5);
    pg.translate(0, 0.75, 0);
    const lg = new THREE.SphereGeometry(0.11, 8, 6);
    lg.translate(0, 1.72, 0);
    return {
      poles: { count: heads.length, data: new Float32Array(data) },
      poleGeo: pg,
      poleMat: new THREE.MeshStandardMaterial({ color: "#3d4349", roughness: 0.6 }),
      lightGeo: lg,
      lightMat: new THREE.MeshBasicMaterial({ toneMapped: false }),
      heads,
    };
  }, [city]);

  const lightMesh = useMemo(() => {
    const m = new THREE.InstancedMesh(lightGeo, lightMat, Math.max(1, heads.length));
    const arr = m.instanceMatrix.array as Float32Array;
    heads.forEach((h, i) => writeMatrix(arr, i, h.x, 0, h.z, 0, 1, 1, 1));
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(heads.length * 3), 3);
    m.computeBoundingSphere();
    return m;
  }, [lightGeo, lightMat, heads]);

  const last = useRef(-1);
  useFrame(() => {
    const t = worldUniforms.uTime.value;
    const tick = Math.floor(t * 4);
    if (tick === last.current) return;
    last.current = tick;
    heads.forEach((h, i) => {
      const s = city.signals[h.signal];
      const phase = signalPhase(h.signal, s.x, s.z, t);
      lightMesh.setColorAt(i, SIGNAL_COLORS[h.ew ? phase.ew : phase.ns]);
    });
    if (lightMesh.instanceColor) lightMesh.instanceColor.needsUpdate = true;
  });

  useEffect(
    () => () => {
      poleGeo.dispose();
      poleMat.dispose();
      lightGeo.dispose();
      lightMat.dispose();
      lightMesh.dispose();
    },
    [poleGeo, poleMat, lightGeo, lightMat, lightMesh],
  );

  return (
    <group>
      <PropInstances set={poles} geometry={poleGeo} material={poleMat} />
      <primitive object={lightMesh} />
    </group>
  );
}

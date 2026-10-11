"use client";

import { useEffect, useMemo, useRef } from "react";
import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getAqiBand } from "@/lib/aqi";
import { cameraBridge } from "@/lib/camera-bridge";
import { motion, step } from "@/lib/live/motion";
import { worldUniforms } from "@/lib/world-uniforms";
import { useLiveStore } from "@/store/live-store";
import { useSimStore } from "@/store/simulation-store";

const TRAIL = 80;

/** The signed-in user's character, walked from the keyboard or by clicking the city. */
export function LiveAvatar() {
  const tripActive = useLiveStore((s) => s.trip !== null && s.trip.phase !== "ended");
  const phase = useLiveStore((s) => s.trip?.phase ?? null);
  const here = useLiveStore((s) => s.here);
  const isDemo = useLiveStore((s) => s.trip?.isDemo ?? true);
  const watchLive = useLiveStore((s) => s.watchActive);
  const reducedMotion = useSimStore((s) => s.reducedMotion);

  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const trail = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    geo.setDrawRange(0, 0);
    return geo;
  }, []);
  const trailPoints = useRef<number[]>([]);
  useEffect(() => () => trail.dispose(), [trail]);

  const band = getAqiBand(here?.aqi ?? 0);
  const color = here ? band.color : "#22c3e6";

  useFrame((_, delta) => {
    if (!tripActive || !motion.placed) return;
    // Generous cap so slow frames (busy laptops, software GL) still walk at the right speed.
    const dt = Math.min(delta, 0.25);
    step(dt, cameraBridge.azimuth(), phase === "active");
    const g = group.current;
    if (!g) return;
    g.position.set(motion.x, 0, motion.z);
    if (body.current) {
      body.current.rotation.y = motion.heading;
      const t = worldUniforms.uTime.value;
      body.current.position.y = motion.moving && !reducedMotion ? Math.abs(Math.sin(t * 10)) * 0.25 : 0;
    }
    if (pulse.current) {
      const p = reducedMotion ? 0.5 : (worldUniforms.uTime.value * 0.8) % 1;
      pulse.current.scale.setScalar(1 + p * 2.2);
      (pulse.current.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.55;
    }
    // Breadcrumb trail of where we've walked.
    const pts = trailPoints.current;
    const lx = pts[pts.length - 3];
    const lz = pts[pts.length - 1];
    if (pts.length === 0 || Math.hypot(motion.x - lx, motion.z - lz) > 1.2) {
      pts.push(motion.x, 0.25, motion.z);
      if (pts.length > TRAIL * 3) pts.splice(0, 3);
      const attr = trail.getAttribute("position") as THREE.BufferAttribute;
      (attr.array as Float32Array).set(pts);
      attr.needsUpdate = true;
      trail.setDrawRange(0, pts.length / 3);
    }
  });

  if (!tripActive) return null;
  return (
    <>
      <line>
        <primitive object={trail} attach="geometry" />
        <lineBasicMaterial color="#22c3e6" transparent opacity={0.65} depthWrite={false} />
      </line>
      <group ref={group}>
        {/* Ground disc in the AQI colour of the zone the user is in. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.16, 0]} renderOrder={9} raycast={() => null}>
          <ringGeometry args={[1.5, 2.1, 48]} />
          <meshBasicMaterial color={color} transparent opacity={0.95} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh ref={pulse} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.15, 0]} renderOrder={9} raycast={() => null}>
          <ringGeometry args={[1.9, 2.1, 48]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} toneMapped={false} />
        </mesh>
        {/* The walker. */}
        <group ref={body}>
          <mesh position={[0, 1.15, 0]} castShadow raycast={() => null}>
            <capsuleGeometry args={[0.42, 1.0, 6, 14]} />
            <meshStandardMaterial color="#f4f7fb" roughness={0.45} />
          </mesh>
          <mesh position={[0, 2.35, 0]} castShadow raycast={() => null}>
            <sphereGeometry args={[0.34, 18, 14]} />
            <meshStandardMaterial color="#f1c9a5" roughness={0.6} />
          </mesh>
          {/* Mask/visor: faces the walking direction. */}
          <mesh position={[0, 2.33, 0.26]} raycast={() => null}>
            <boxGeometry args={[0.42, 0.16, 0.12]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
          </mesh>
        </group>
        {/* Beacon so the character is findable from a city-wide view. */}
        <mesh position={[0, 7.2, 0]} raycast={() => null}>
          <coneGeometry args={[0.9, 2.2, 20]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        <mesh position={[0, 4.7, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.07, 0.07, 3.2, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.7} toneMapped={false} />
        </mesh>
        <Html position={[0, 12.5, 0]} center zIndexRange={[18, 0]} style={{ pointerEvents: "none" }}>
          <div className="aq-live-tag" style={{ borderColor: color }}>
            <span className="aq-live-tag__dot" style={{ background: watchLive ? "#2f9e44" : "#9aa5b1" }} title={watchLive ? "Watch active" : "Waiting for watch"} />
            <span className="font-semibold">You</span>
            {here && (
              <>
                <span className="opacity-60">·</span>
                <span>{here.zoneName}</span>
                <span className="aq-num rounded px-1 font-bold" style={{ background: band.color, color: band.ink }}>
                  {here.aqi}
                </span>
              </>
            )}
            {isDemo && <span className="aq-live-tag__sim">SIMULATED</span>}
          </div>
        </Html>
      </group>
    </>
  );
}

/** Planned route, chosen route and compared alternatives drawn on the city. */
export function LiveRoutes() {
  const trip = useLiveStore((s) => s.trip);
  const comparison = useLiveStore((s) => s.comparison);
  const readings = useSimStore((s) => s.readings);
  const byId = useMemo(() => new Map(readings.map((r) => [r.id, r])), [readings]);
  if (!trip || trip.phase === "ended") return null;

  const zonePath = (ids: string[]) =>
    ids.flatMap((id) => {
      const r = byId.get(id);
      return r ? [new THREE.Vector3(r.position[0], 0.5, r.position[1])] : [];
    });
  const worldPath = (pts: { x: number; z: number }[], y: number) => pts.map((p) => new THREE.Vector3(p.x, y, p.z));

  const planned = trip.selectedRoute?.world?.length ? null : zonePath(trip.plannedZoneIds);
  const selected = trip.selectedRoute?.world?.length ? worldPath(trip.selectedRoute.world, 0.6) : null;
  const current = comparison?.alternatives.find((a) => a.kind === "planned" || a.kind === "fastest");
  const cleaner = comparison?.alternatives.find((a) => a.kind === "cleaner");

  return (
    <group renderOrder={7}>
      {planned && planned.length > 1 && <Line points={planned} color="#22c3e6" lineWidth={3} dashed dashSize={2.2} gapSize={1.4} transparent opacity={0.85} />}
      {selected && selected.length > 1 && <Line points={selected} color="#2f9e44" lineWidth={5} transparent opacity={0.95} />}
      {current && current.world.length > 1 && <Line points={worldPath(current.world, 0.7)} color="#e03131" lineWidth={3} dashed dashSize={1.6} gapSize={1.2} transparent opacity={0.8} />}
      {cleaner && cleaner.world.length > 1 && <Line points={worldPath(cleaner.world, 0.8)} color="#2f9e44" lineWidth={5} transparent opacity={0.9} />}
    </group>
  );
}

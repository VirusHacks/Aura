"use client";

import { Component, Suspense, useEffect, useState, type ReactNode } from "react";
import { PerformanceMonitor } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import CityScene, { type SceneQuality } from "./CityScene";

function detectQuality(): SceneQuality {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 720;
  const mobile = coarse || small;
  return mobile
    ? { mobile, shadowMapSize: 1024, groundTexture: 1400, trafficDensity: 0.5, plumePerSource: 36, hazePerZone: 28, windCount: 90 }
    : { mobile, shadowMapSize: 2048, groundTexture: 2160, trafficDensity: 1, plumePerSource: 64, hazePerZone: 56, windCount: 170 };
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

class SceneErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  render() {
    if (this.state.error) return <SceneUnavailable detail={this.state.error} />;
    return this.props.children;
  }
}

function SceneUnavailable({ detail }: { detail: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <div className="aq-panel max-w-sm p-5 text-sm">
        <p className="aq-eyebrow mb-2">3D view unavailable</p>
        <p className="text-[var(--ink)]">
          The city could not be rendered in this browser. The dashboard and data panels still work.
        </p>
        <p className="mt-2 text-[11px] text-[var(--muted)]">{detail}</p>
      </div>
    </div>
  );
}

export default function CityCanvas() {
  const [quality] = useState(detectQuality);
  const [supported] = useState(webglAvailable);
  const [frameloop, setFrameloop] = useState<"always" | "never">("always");
  const [dpr, setDpr] = useState(() => Math.min(window.devicePixelRatio || 1, quality.mobile ? 1.5 : 2));

  // Pause rendering entirely while the tab is hidden.
  useEffect(() => {
    const onVis = () => setFrameloop(document.hidden ? "never" : "always");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  if (!supported) return <SceneUnavailable detail="WebGL is not available." />;

  return (
    <SceneErrorBoundary>
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={dpr}
        frameloop={frameloop}
        gl={{ antialias: true, powerPreference: "high-performance", alpha: true }}
        camera={{ fov: 30, near: 1, far: 2400, position: [180, 260, 300] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NeutralToneMapping;
          gl.toneMappingExposure = 1.02;
          gl.setClearColor(0x000000, 0);
        }}
        style={{ touchAction: "none" }}
      >
        <PerformanceMonitor
          onDecline={() => setDpr((d) => Math.max(1, d - 0.5))}
          onIncline={() => setDpr((d) => Math.min(quality.mobile ? 1.5 : 2, d + 0.25, window.devicePixelRatio || 1))}
        />
        <Suspense fallback={null}>
          <CityScene quality={quality} />
        </Suspense>
      </Canvas>
    </SceneErrorBoundary>
  );
}

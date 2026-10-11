"use client";

import { Component, Suspense, useEffect, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import DelhiDiorama, { type DioramaProps } from "./DelhiDiorama";

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface DioramaCanvasProps extends Omit<DioramaProps, "mobile"> {
  /** Rendering stops while false (off screen or tab hidden). */
  active: boolean;
  fallback: ReactNode;
  onReady?: () => void;
}

/**
 * A lightweight, non-interactive rendering of the city for the landing page.
 * It ignores the pointer so the page scrolls normally over it on touch screens.
 */
export default function DioramaCanvas({ active, fallback, onReady, ...scene }: DioramaCanvasProps) {
  const [supported] = useState(webglAvailable);
  const [mobile] = useState(() => window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  if (!supported) return <>{fallback}</>;

  return (
    <Boundary fallback={fallback}>
      <Canvas
        aria-hidden
        className="!pointer-events-none"
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={[1, mobile ? 1.5 : 1.75]}
        frameloop={active && !hidden ? "always" : "never"}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ fov: 28, near: 1, far: 1200, position: [200, 140, 220] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NeutralToneMapping;
          gl.setClearColor(0x000000, 0);
          onReady?.();
        }}
      >
        <Suspense fallback={null}>
          <DelhiDiorama {...scene} mobile={mobile} />
        </Suspense>
      </Canvas>
    </Boundary>
  );
}

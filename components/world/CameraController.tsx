"use client";

import { useEffect, useRef } from "react";
import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { cameraBridge } from "@/lib/camera-bridge";
import { CAMERA_LIMITS, DEFAULT_VIEW, zoomLevelFor } from "@/lib/camera-presets";
import { useSimStore } from "@/store/simulation-store";
import type { CameraView } from "@/types/scene";

const { ACTION } = CameraControlsImpl;

function apply(controls: CameraControls, view: CameraView, transition: boolean) {
  const polar = view.polar ?? controls.polarAngle;
  const azimuth = view.azimuth ?? controls.azimuthAngle;
  const [tx, ty, tz] = view.target;
  const d = view.distance;
  const x = tx + d * Math.sin(polar) * Math.sin(azimuth);
  const y = ty + d * Math.cos(polar);
  const z = tz + d * Math.sin(polar) * Math.cos(azimuth);
  return controls.setLookAt(x, y, z, tx, ty, tz, transition);
}

export function CameraController() {
  const ref = useRef<CameraControls>(null);
  const request = useSimStore((s) => s.cameraRequest);
  const reducedMotion = useSimStore((s) => s.reducedMotion);
  const setZoomLevel = useSimStore((s) => s.setZoomLevel);
  const zoomRef = useRef<string>("");

  // Initial framing with a gentle fly-in.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    cameraBridge.attach(c);
    c.mouseButtons.left = ACTION.SCREEN_PAN;
    c.mouseButtons.right = ACTION.ROTATE;
    c.mouseButtons.middle = ACTION.DOLLY;
    c.mouseButtons.wheel = ACTION.DOLLY;
    c.touches.one = ACTION.TOUCH_SCREEN_PAN;
    c.touches.two = ACTION.TOUCH_DOLLY_ROTATE;
    c.touches.three = ACTION.TOUCH_DOLLY_ROTATE;
    c.minDistance = CAMERA_LIMITS.minDistance;
    c.maxDistance = CAMERA_LIMITS.maxDistance;
    c.minPolarAngle = CAMERA_LIMITS.minPolar;
    c.maxPolarAngle = CAMERA_LIMITS.maxPolar;
    c.dollyToCursor = true;
    c.dollySpeed = 0.6;
    c.truckSpeed = 1.6;
    c.azimuthRotateSpeed = 0.6;
    c.polarRotateSpeed = 0.6;
    c.setBoundary(new THREE.Box3(new THREE.Vector3(...CAMERA_LIMITS.boundsMin), new THREE.Vector3(...CAMERA_LIMITS.boundsMax)));
    c.boundaryFriction = 0.15;
    const reduce = useSimStore.getState().reducedMotion;
    if (reduce) {
      apply(c, DEFAULT_VIEW, false);
    } else {
      apply(c, { ...DEFAULT_VIEW, distance: 420, polar: 0.55, azimuth: 0.1 }, false);
      requestAnimationFrame(() => void apply(c, DEFAULT_VIEW, true));
    }
    return () => cameraBridge.attach(null);
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.smoothTime = reducedMotion ? 0.08 : 0.55;
    c.draggingSmoothTime = reducedMotion ? 0.02 : 0.12;
  }, [reducedMotion]);

  useEffect(() => {
    if (request && ref.current) void apply(ref.current, request.view, true);
  }, [request]);

  // Keyboard navigation: WASD/arrows pan, Q/E rotate, +/- zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = ref.current;
      const el = e.target as HTMLElement | null;
      if (!c || (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))) return;
      const step = c.distance * 0.06;
      switch (e.key) {
        case "ArrowUp":
        case "w":
          void c.forward(step, true);
          break;
        case "ArrowDown":
        case "s":
          void c.forward(-step, true);
          break;
        case "ArrowLeft":
        case "a":
          void c.truck(-step, 0, true);
          break;
        case "ArrowRight":
        case "d":
          void c.truck(step, 0, true);
          break;
        case "q":
          void c.rotate(0.15, 0, true);
          break;
        case "e":
          void c.rotate(-0.15, 0, true);
          break;
        case "+":
        case "=":
          void c.dolly(c.distance * 0.2, true);
          break;
        case "-":
          void c.dolly(-c.distance * 0.25, true);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useFrame(() => {
    const c = ref.current;
    if (!c) return;
    const level = zoomLevelFor(c.distance);
    if (level !== zoomRef.current) {
      zoomRef.current = level;
      setZoomLevel(level);
    }
  });

  return <CameraControls ref={ref} makeDefault />;
}

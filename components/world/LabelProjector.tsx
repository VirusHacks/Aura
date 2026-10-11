"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sceneAnchors } from "@/lib/scene-anchors";

/** Projects every registered DOM label to screen space once per frame. */
export function LabelProjector() {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const a of sceneAnchors.values()) {
      v.set(a.x, a.y, a.z).project(camera);
      const style = a.el.style;
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.25 || Math.abs(v.y) > 1.25) {
        if (style.visibility !== "hidden") style.visibility = "hidden";
        continue;
      }
      const px = ((v.x + 1) / 2) * size.width;
      const py = ((1 - v.y) / 2) * size.height;
      style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%)`;
      // Nearer labels stack above farther ones.
      style.zIndex = String(Math.round((1 - v.z) * 100000));
      if (style.visibility !== "visible") style.visibility = "visible";
    }
  });
  return null;
}

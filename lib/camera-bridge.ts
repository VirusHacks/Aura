import type { CameraControls } from "@react-three/drei";

/**
 * The HUD lives outside the R3F tree; this bridge lets its buttons drive the
 * camera without passing refs through React context.
 */
let controls: CameraControls | null = null;

export const cameraBridge = {
  attach(c: CameraControls | null) {
    controls = c;
  },
  zoom(factor: number) {
    if (!controls) return;
    controls.dolly(controls.distance * (1 - factor), true);
  },
  rotate(radians: number) {
    controls?.rotate(radians, 0, true);
  },
  /** Current azimuth in radians, for the compass. */
  azimuth(): number {
    return controls?.azimuthAngle ?? 0;
  },
  resetNorth() {
    if (!controls) return;
    controls.rotateAzimuthTo(0, true);
  },
};

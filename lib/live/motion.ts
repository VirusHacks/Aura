/**
 * The walking character's motion, updated every frame outside React state
 * (like the scene's other per-frame animation). Keyboard steers relative to
 * the camera; a clicked point is walked to in a straight line.
 */
import { WORLD } from "@/lib/city-layout";

/** World units per second (the city is ~200 units across). */
export const WALK_SPEED = 14;

export interface Motion {
  x: number;
  z: number;
  heading: number;
  moving: boolean;
  target: { x: number; z: number } | null;
  /** Server position to glide to when another device moves the character. */
  remote: { x: number; z: number } | null;
  keys: Set<string>;
  placed: boolean;
}

export const motion: Motion = { x: 0, z: 0, heading: 0, moving: false, target: null, remote: null, keys: new Set(), placed: false };

const KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export const isMovementKey = (code: string) => code in KEYS;

export function place(x: number, z: number) {
  motion.x = x;
  motion.z = z;
  motion.target = null;
  motion.remote = null;
  motion.placed = true;
}

/** Advances the character; `azimuth` makes "up" mean "away from the camera". */
export function step(dt: number, azimuth: number, canDrive: boolean): boolean {
  let dx = 0;
  let dz = 0;
  if (canDrive) {
    for (const k of motion.keys) {
      const v = KEYS[k];
      if (v) {
        dx += v[0];
        dz += v[1];
      }
    }
  }
  const before = { x: motion.x, z: motion.z };
  if (dx !== 0 || dz !== 0) {
    motion.target = null;
    motion.remote = null;
    const len = Math.hypot(dx, dz);
    const sin = Math.sin(azimuth);
    const cos = Math.cos(azimuth);
    // Rotate the screen-space input by the camera azimuth.
    const wx = (dx * cos + dz * sin) / len;
    const wz = (-dx * sin + dz * cos) / len;
    motion.x += wx * WALK_SPEED * dt;
    motion.z += wz * WALK_SPEED * dt;
  } else if (canDrive && motion.target) {
    const tx = motion.target.x - motion.x;
    const tz = motion.target.z - motion.z;
    const d = Math.hypot(tx, tz);
    if (d < 0.3) motion.target = null;
    else {
      const s = Math.min(d, WALK_SPEED * dt);
      motion.x += (tx / d) * s;
      motion.z += (tz / d) * s;
    }
  } else if (motion.remote) {
    // Glide (faster than walking) to where another device put the character.
    const tx = motion.remote.x - motion.x;
    const tz = motion.remote.z - motion.z;
    const d = Math.hypot(tx, tz);
    if (d < 0.2 || d > 120) {
      motion.x = motion.remote.x;
      motion.z = motion.remote.z;
      motion.remote = null;
    } else {
      const s = Math.min(d, Math.max(WALK_SPEED * 2, d * 3) * dt);
      motion.x += (tx / d) * s;
      motion.z += (tz / d) * s;
    }
  }
  motion.x = Math.min(WORLD.maxX - 2, Math.max(WORLD.minX + 2, motion.x));
  motion.z = Math.min(WORLD.maxZ - 2, Math.max(WORLD.minZ + 2, motion.z));
  const mx = motion.x - before.x;
  const mz = motion.z - before.z;
  motion.moving = Math.hypot(mx, mz) > 1e-4;
  if (motion.moving) motion.heading = Math.atan2(mx, mz);
  return motion.moving;
}

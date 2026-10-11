import * as THREE from "three";

interface MatOptions {
  roughness?: number;
  metalness?: number;
  /** Warm architectural floodlighting at night. */
  floodlit?: boolean;
  emissive?: string;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  vertexColors?: boolean;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();
const floodlit = new Set<THREE.MeshStandardMaterial>();

/** Shared, cached standard material. Landmark meshes reuse these so draw state stays small. */
export function mat(color: string, opts: MatOptions = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${JSON.stringify(opts)}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.82,
      metalness: opts.metalness ?? 0,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
      vertexColors: opts.vertexColors ?? false,
    });
    if (opts.emissive) {
      m.emissive = new THREE.Color(opts.emissive);
      m.emissiveIntensity = 1;
    }
    if (opts.floodlit) {
      m.emissive = new THREE.Color(color).lerp(new THREE.Color("#ffb45e"), 0.55);
      m.emissiveIntensity = 0;
      floodlit.add(m);
    }
    cache.set(key, m);
  }
  return m;
}

export function updateFloodlights(night: number) {
  for (const m of floodlit) m.emissiveIntensity = night * 0.32;
}

export const PALETTE = {
  redSandstone: "#b4573f",
  buffSandstone: "#d8b88f",
  sandstone: "#cfa77c",
  marble: "#f3efe6",
  cream: "#efe6d2",
  white: "#f6f4ef",
  concrete: "#c9c5bd",
  darkConcrete: "#8f8b85",
  steel: "#6c7780",
  glass: "#9fb4c3",
  dome: "#c39a70",
  greySandstone: "#b9a88c",
  craneYellow: "#f0b31c",
  barrierBlue: "#3b6fb6",
  dirt: "#b89b72",
  shadowInset: "#3b2f2a",
} as const;

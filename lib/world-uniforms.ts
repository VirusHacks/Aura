import * as THREE from "three";
import { AQI_GRADIENT_STOPS } from "./aqi";

export const MAX_ZONES = 24;

/**
 * Uniform objects shared by every custom material. Updating `.value` once per
 * frame updates all materials that reference them.
 */
export const worldUniforms = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uHeat: { value: 1 },
  uHeatAlpha: { value: 0.34 },
  uZones: { value: Array.from({ length: MAX_ZONES }, () => new THREE.Vector4(0, 0, 1, 0)) },
  uZoneCount: { value: 0 },
  uWindDir: { value: new THREE.Vector2(1, 0) },
  uWindSpeed: { value: 2 },
  uHaze: { value: 0.3 },
  uMotion: { value: 1 },
};

function linearHex(hex: string): string {
  const c = new THREE.Color(hex); // three converts sRGB hex → linear working space
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

/** GLSL: continuous AQI field (inverse-distance weighting of zone values) and colour ramp. */
export const AQI_GLSL = /* glsl */ `
uniform vec4 uZones[${MAX_ZONES}];
uniform int uZoneCount;

float aqiField(vec2 p) {
  float wsum = 0.0;
  float asum = 0.0;
  for (int i = 0; i < ${MAX_ZONES}; i++) {
    if (i >= uZoneCount) break;
    vec4 z = uZones[i];
    vec2 d = p - z.xy;
    float q = dot(d, d) / (z.z * z.z) + 0.3;
    float w = 1.0 / (q * q);
    wsum += w;
    asum += w * z.w;
  }
  return asum / max(wsum, 1e-5);
}

vec3 aqiColor(float a) {
${AQI_GRADIENT_STOPS.map(([v, hex], i) => {
  if (i === 0) return `  vec3 c = ${linearHex(hex)};`;
  const [pv] = AQI_GRADIENT_STOPS[i - 1];
  return `  c = mix(c, ${linearHex(hex)}, smoothstep(${pv.toFixed(1)}, ${v.toFixed(1)}, a));`;
}).join("\n")}
  return c;
}
`;

export const HASH_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/**
 * Building facade shader patch: world-space windows (consistent scale on every
 * instance), contact darkening near the ground, AQI tint on roofs, lit windows
 * at night and a slow light sweep over glass towers.
 */
export function patchBuildingMaterial(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.uniforms.uNight = worldUniforms.uNight;
    shader.uniforms.uHeat = worldUniforms.uHeat;
    shader.uniforms.uZones = worldUniforms.uZones;
    shader.uniforms.uZoneCount = worldUniforms.uZoneCount;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aStyle;
varying vec3 vWPos;
varying vec3 vWNormal;
varying float vStyle;`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vec4 wp4 = vec4(transformed, 1.0);
vec3 wn = objectNormal;
#ifdef USE_INSTANCING
wp4 = instanceMatrix * wp4;
wn = mat3(instanceMatrix) * wn;
#endif
wp4 = modelMatrix * wp4;
vWPos = wp4.xyz;
vWNormal = normalize(mat3(modelMatrix) * wn);
vStyle = aStyle;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uTime;
uniform float uNight;
uniform float uHeat;
varying vec3 vWPos;
varying vec3 vWNormal;
varying float vStyle;
${HASH_GLSL}
${AQI_GLSL}
float gWindow;
float gLit;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float side = 1.0 - step(0.6, abs(vWNormal.y));
float roof = step(0.6, vWNormal.y);
float u = abs(vWNormal.x) > 0.5 ? vWPos.z : vWPos.x;
float floorH = 0.62;
float fy = vWPos.y / floorH;
gWindow = 0.0;
gLit = 0.0;
if (vStyle > 0.5 && vStyle < 1.5) {
  float fu = u / 0.55;
  vec2 cell = fract(vec2(fu, fy));
  gWindow = step(0.22, cell.x) * step(cell.x, 0.78) * step(0.32, cell.y) * step(cell.y, 0.78);
  gWindow *= side * step(0.5, vWPos.y);
  gLit = step(0.66, hash12(floor(vec2(fu, fy)) + floor(vWPos.xz * 0.2)));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.42 + vec3(0.03, 0.045, 0.06), gWindow * 0.75);
} else if (vStyle > 1.5) {
  vec2 cell = fract(vec2(u / 1.4, fy));
  float band = step(0.18, cell.y) * step(cell.y, 0.86);
  float mullion = step(0.06, cell.x);
  gWindow = band * mullion * side;
  gLit = step(0.5, hash12(floor(vec2(u / 1.4, fy)) + 7.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62 + vec3(0.02, 0.05, 0.08), gWindow * 0.8);
} else {
  // Sheds: horizontal cladding seams.
  float seam = smoothstep(0.0, 0.04, abs(fract(vWPos.y * 2.4) - 0.5) - 0.44);
  diffuseColor.rgb *= mix(1.0, 0.93, seam * side);
}
// Contact darkening near the ground plane (cheap ambient occlusion).
diffuseColor.rgb *= mix(0.68, 1.0, smoothstep(0.0, 1.6, vWPos.y));
// AQI tint, strongest on roofs, so the field reads through dense blocks.
vec3 heat = aqiColor(aqiField(vWPos.xz));
diffuseColor.rgb = mix(diffuseColor.rgb, heat, uHeat * roof * 0.26);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.74, 0.42) * gWindow * gLit * uNight * 0.85;
if (vStyle > 1.5) {
  float sweep = smoothstep(0.94, 1.0, sin(vWPos.y * 0.22 + (vWPos.x + vWPos.z) * 0.06 - uTime * 0.5));
  totalEmissiveRadiance += vec3(0.55, 0.75, 0.95) * sweep * side * 0.22 * (1.0 - uNight);
}`,
      );
  };
  material.customProgramCacheKey = () => "aeroscope-building";
  return material;
}

/** Gentle canopy sway for instanced trees. */
export function patchTreeMaterial(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.uniforms.uMotion = worldUniforms.uMotion;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\nuniform float uMotion;`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
#ifdef USE_INSTANCING
float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
float sway = sin(uTime * 1.3 + phase) * 0.05 * uMotion * max(0.0, position.y);
transformed.x += sway;
transformed.z += sway * 0.6;
#endif`,
      );
  };
  material.customProgramCacheKey = () => "aeroscope-tree";
  return material;
}

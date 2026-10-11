/**
 * Small runtime validators for request bodies. Each returns the typed value or
 * throws a 400 with a message naming the field, so handlers never trust input.
 */
import { badRequest } from "./errors";
import type { GeoPoint, LocationPayload, TravelMode, WorldPoint } from "../../../types/api";
import type { AqiCategory } from "../../../types/air-quality";

export const ID = /^[A-Za-z0-9._:-]{1,128}$/;
export const MAX_BODY_BYTES = 16 * 1024;
export const TRAVEL_MODES: readonly TravelMode[] = ["walk", "cycle", "motor"];
export const CATEGORIES: readonly AqiCategory[] = ["Good", "Satisfactory", "Moderate", "Poor", "Very Poor", "Severe"];

export type Json = Record<string, unknown>;

export const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
export const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

export function object(v: unknown, what = "Body"): Json {
  return isObject(v) ? v : badRequest(`${what} must be a JSON object`);
}

export function id(v: unknown, field: string): string {
  return isId(v) ? v : badRequest(`${field} must be an id (letters, digits, . _ : -; up to 128)`);
}

export function optionalId(v: unknown, field: string): string | null {
  return v === undefined || v === null ? null : id(v, field);
}

export function isoDate(v: unknown, field: string): string {
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) badRequest(`${field} must be an ISO 8601 date`);
  return new Date(v as string).toISOString();
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  return allowed.includes(v as T) ? (v as T) : badRequest(`${field} must be one of ${allowed.join(", ")}`);
}

export function optionalOneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

export function zoneIds(v: unknown, field: string, max = 64): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max || !v.every(isId)) badRequest(`${field} must be a list of up to ${max} zone ids`);
  return v as string[];
}

export function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function intInRange(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function geoPoint(v: unknown): GeoPoint | null {
  if (!isObject(v)) return null;
  const { lat, lon } = v;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) badRequest("geo must be { lat, lon }");
  return { lat: lat as number, lon: lon as number };
}

function worldPoint(v: unknown): WorldPoint | null {
  if (!isObject(v)) return null;
  const { x, z } = v;
  if (!isFiniteNumber(x) || !isFiniteNumber(z) || Math.abs(x) > 10_000 || Math.abs(z) > 10_000) badRequest("world must be { x, z }");
  return { x: x as number, z: z as number };
}

/** A reported position: GPS (`geo`), a point on the 3D city (`world`, simulated only) or a zone id (simulated only). */
export function locationPayload(v: unknown): LocationPayload {
  const o = object(v, "location");
  const simulated = o.simulated === true;
  const geo = o.geo === undefined || o.geo === null ? null : geoPoint(o.geo);
  const world = o.world === undefined || o.world === null ? null : worldPoint(o.world);
  const zoneId = o.zoneId === undefined || o.zoneId === null ? null : id(o.zoneId, "location.zoneId");
  if (!geo && !world && !zoneId) badRequest("location needs geo, world or zoneId");
  const accuracy = isFiniteNumber(o.accuracyMeters) ? Math.max(0, o.accuracyMeters) : null;
  return { geo, world, zoneId, accuracyMeters: accuracy, simulated };
}

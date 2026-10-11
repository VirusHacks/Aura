"use client";

import { useEffect, useRef } from "react";
import type { SourceReading } from "../types/air-quality";

/**
 * DOM labels that follow 3D points. Labels render in the normal React DOM
 * tree (no per-label React roots); a projector inside the R3F frame loop
 * writes each registered element's screen transform.
 */
export interface SceneAnchor {
  el: HTMLElement;
  x: number;
  y: number;
  z: number;
}

/** Height of the floating zone labels (and their 3D stems). */
export const ZONE_LABEL_Y = 10;

export const sceneAnchors = new Map<string, SceneAnchor>();

export function useSceneAnchor<T extends HTMLElement = HTMLDivElement>(id: string, x: number, y: number, z: number) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    sceneAnchors.set(id, { el, x, y, z });
    return () => {
      sceneAnchors.delete(id);
    };
  }, [id, x, y, z]);
  return ref;
}

/** Height (world units) at which a source emits — chimney tops, rooftops or street level. */
export function sourceEmitHeight(s: Pick<SourceReading, "id" | "category">): number {
  if (s.category === "industrial") return s.id === "src-an-ind" ? 8 : s.id === "src-mp-furnace" ? 8.5 : 10;
  if (s.id === "src-mv-landfill") return 5;
  if (s.category === "commercial") return 2.4;
  if (s.category === "construction") return 0.8;
  return 0.5;
}

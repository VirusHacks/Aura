"use client";

import { useMemo } from "react";
import { JOURNEY, rerouteSaving } from "@/lib/landing-data";
import { useAirData } from "./AirData";

/** The watch demo journey resolved against the current readings. */
export function useJourney() {
  const { readings } = useAirData();
  return useMemo(() => {
    const byId = new Map(readings.map((r) => [r.id, r]));
    const zone = (id: string) => {
      const z = byId.get(id);
      if (!z) throw new Error(`Unknown zone ${id}`);
      return z;
    };
    const { fastest, cleaner, percent } = rerouteSaving(readings);
    return {
      readings,
      start: zone(JOURNEY.fastest[0]),
      alertAt: zone(JOURNEY.alertAt),
      hotspot: zone(JOURNEY.hotspot),
      via: zone(JOURNEY.cleaner[2]),
      destination: zone(JOURNEY.fastest[JOURNEY.fastest.length - 1]),
      fastest,
      cleaner,
      saving: percent,
      /** Extra distance of the cleaner route, as a percentage. */
      extraDistance: Math.round((cleaner.length / fastest.length - 1) * 100),
    };
  }, [readings]);
}

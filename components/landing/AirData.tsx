"use client";

import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEMO_DATASET } from "@/data/demo-zones";
import { demoReadings } from "@/lib/landing-data";
import { parseZoneDataset } from "@/lib/zone-schema";
import type { ZoneDataset, ZoneReading } from "@/types/air-quality";

interface AirData {
  dataset: ZoneDataset;
  /** Readings for the demo scenario (Urban Traffic Haze, 15:00). */
  readings: ZoneReading[];
  /** True only when the API served a verified baseline. Readings stay modelled either way. */
  verified: boolean;
}

const AirDataContext = createContext<AirData | null>(null);

/**
 * Starts from the bundled demo dataset (so the page renders fully on the
 * server) and swaps in whatever the zones API serves, which is the same demo
 * dataset unless a verified provider has been connected.
 */
export function AirDataProvider({ children }: { children: ReactNode }) {
  const [dataset, setDataset] = useState<ZoneDataset>(DEMO_DATASET);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/air-quality/zones", { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: unknown) => setDataset(parseZoneDataset(body)))
      .catch(() => {
        // Keep the bundled demo dataset; the page already labels it as demo.
      });
    return () => ctrl.abort();
  }, []);

  const value = useMemo(
    () => ({ dataset, readings: demoReadings(dataset), verified: dataset.provenance === "verified" }),
    [dataset],
  );
  return <AirDataContext value={value}>{children}</AirDataContext>;
}

export function useAirData(): AirData {
  const ctx = use(AirDataContext);
  if (!ctx) throw new Error("useAirData must be used inside <AirDataProvider>");
  return ctx;
}

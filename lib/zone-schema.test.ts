import { describe, expect, it } from "vitest";
import { DEMO_DATASET } from "../data/demo-zones";
import { parseZoneDataset } from "./zone-schema";

describe("parseZoneDataset", () => {
  it("round-trips the demo dataset", () => {
    const parsed = parseZoneDataset(JSON.parse(JSON.stringify(DEMO_DATASET)));
    expect(parsed.zones).toHaveLength(DEMO_DATASET.zones.length);
    expect(parsed.provenance).toBe("demo");
  });

  it("never upgrades unknown provenance to verified", () => {
    const parsed = parseZoneDataset({ ...DEMO_DATASET, provenance: "live!!" });
    expect(parsed.provenance).toBe("demo");
  });

  it("rejects malformed payloads", () => {
    expect(() => parseZoneDataset(null)).toThrow();
    expect(() => parseZoneDataset({ zones: [] })).toThrow(/no zones/);
    expect(() => parseZoneDataset({ zones: [{ id: "x", name: "X", region: "mars", position: [0, 0], baseAqi: 100 }] })).toThrow(/region/);
    expect(() => parseZoneDataset({ zones: [{ id: "x", name: "X", region: "old", position: [0, 0], baseAqi: 900 }] })).toThrow(/AQI/);
  });

  it("drops unknown source categories", () => {
    const parsed = parseZoneDataset({
      zones: [{ id: "x", name: "X", region: "old", position: [1, 2], baseAqi: 120, sources: ["traffic", "<script>"] }],
    });
    expect(parsed.zones[0].sources).toEqual(["traffic"]);
  });
});

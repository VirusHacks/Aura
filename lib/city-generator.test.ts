import { describe, expect, it } from "vitest";
import { getCityModel } from "./city-generator";
import { ARTERIALS, distToPolyline, isRiver } from "./city-layout";

describe("city generator", () => {
  const t0 = performance.now();
  const city = getCityModel();
  const elapsed = performance.now() - t0;

  it("builds a dense, deterministic city quickly", () => {
    console.info(
      `generated in ${elapsed.toFixed(0)}ms: ${city.buildings.count} buildings, ${city.streets.length} streets, ` +
        `${city.treesRound.count + city.treesTall.count} trees, ${city.lamps.count} lamps, ${city.signals.length} signals, ` +
        `${city.parkedCars.count} parked cars`,
    );
    expect(city.buildings.count).toBeGreaterThan(2000);
    expect(city.streets.length).toBeGreaterThan(60);
    expect(city.signals.length).toBeGreaterThan(15);
    expect(getCityModel()).toBe(city);
  });

  it("never places buildings on arterials or in the river", () => {
    const b = city.buildings;
    for (let i = 0; i < b.count; i++) {
      const x = b.x[i];
      const z = b.z[i];
      expect(isRiver(x, z)).toBe(false);
      for (const r of ARTERIALS) {
        expect(distToPolyline(x, z, r.points, r.closed)).toBeGreaterThan(r.width / 2);
      }
    }
  });
});

import type { RegionId } from "../types/air-quality";
import type { RegionDef } from "../types/scene";

export const CITY_REGIONS: RegionDef[] = [
  {
    id: "central",
    name: "Central Delhi",
    short: "Central",
    description:
      "India Gate, Kartavya Path and the Connaught Place commercial rings. Wide avenues, government precincts and dense office traffic along Janpath and Minto Road.",
    view: { target: [-2, 0, -12], distance: 125, polar: 0.92, azimuth: 0.62 },
  },
  {
    id: "old",
    name: "Old Delhi",
    short: "Old Delhi",
    description:
      "Red Fort, Jama Masjid and the Chandni Chowk bazaar. Tight lanes, mixed-use havelis, wholesale markets and bus terminals with very high vehicle and generator load.",
    view: { target: [10, 0, -70], distance: 105, polar: 0.9, azimuth: 0.55 },
  },
  {
    id: "east",
    name: "East Delhi",
    short: "East",
    description:
      "The Yamuna corridor and its bridges, the Laxmi Nagar and Anand Vihar transport hubs, Mayur Vihar housing and the Ghazipur landfill edge.",
    view: { target: [96, 0, 6], distance: 150, polar: 0.92, azimuth: 0.4 },
  },
  {
    id: "south",
    name: "South Delhi",
    short: "South",
    description:
      "Residential colonies, Lodhi Garden, Hauz Khas, the Nehru Place business district, AIIMS and the Qutub Minar heritage zone.",
    view: { target: [6, 0, 60], distance: 130, polar: 0.92, azimuth: 0.5 },
  },
  {
    id: "industrial",
    name: "Industrial & Outer Corridor",
    short: "Industrial",
    description:
      "Mayapuri and Naraina industrial estates, freight depots, the NH-48 expressway corridor and large infrastructure works along the outer ring.",
    view: { target: [-90, 0, -4], distance: 150, polar: 0.92, azimuth: 0.72 },
  },
];

export const REGION_BY_ID: Record<RegionId, RegionDef> = Object.fromEntries(
  CITY_REGIONS.map((r) => [r.id, r]),
) as Record<RegionId, RegionDef>;

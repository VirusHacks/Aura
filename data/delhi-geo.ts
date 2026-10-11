/**
 * Real-world anchors for the schematic 3D city: one WGS84 point per zone and the
 * road links between neighbouring zones. Shared by the backend (locating a GPS fix,
 * Amazon Location routing) and the dashboard (drawing routes). Must stay in sync
 * with watch/AeroscopeKit/Sources/AeroscopeKit/Resources/delhi-zones.json.
 */
import type { GeoPoint } from "../types/api";

export const ZONE_GEO: Readonly<Record<string, GeoPoint>> = {
  "z-cp": { lat: 28.6315, lon: 77.2167 }, // Connaught Place
  "z-ig": { lat: 28.6129, lon: 77.2295 }, // India Gate & Kartavya Path
  "z-ndls": { lat: 28.643, lon: 77.2194 }, // New Delhi Railway Station
  "z-cc": { lat: 28.6506, lon: 77.2303 }, // Chandni Chowk
  "z-rf": { lat: 28.6562, lon: 77.241 }, // Red Fort Precinct
  "z-kg": { lat: 28.6675, lon: 77.2283 }, // Kashmere Gate
  "z-yb": { lat: 28.628, lon: 77.256 }, // Yamuna Riverfront
  "z-ln": { lat: 28.6304, lon: 77.2773 }, // Laxmi Nagar
  "z-an": { lat: 28.6469, lon: 77.316 }, // Anand Vihar
  "z-mv": { lat: 28.6046, lon: 77.294 }, // Mayur Vihar
  "z-lg": { lat: 28.5931, lon: 77.2197 }, // Lodhi Garden
  "z-hk": { lat: 28.5494, lon: 77.2001 }, // Hauz Khas & Green Park
  "z-qm": { lat: 28.5245, lon: 77.1855 }, // Qutub Minar & Mehrauli
  "z-np": { lat: 28.5491, lon: 77.2513 }, // Nehru Place
  "z-mp": { lat: 28.6377, lon: 77.1295 }, // Mayapuri Industrial Area
  "z-ow": { lat: 28.707, lon: 77.175 }, // Outer Ring Works
  "z-nh": { lat: 28.543, lon: 77.125 }, // NH-48 Corridor
};

/** Undirected road links between adjacent zones (the demo routing graph). */
export const ZONE_LINKS: readonly (readonly [string, string])[] = [
  ["z-lg", "z-ig"],
  ["z-lg", "z-hk"],
  ["z-lg", "z-np"],
  ["z-ig", "z-cp"],
  ["z-ig", "z-yb"],
  ["z-cp", "z-ndls"],
  ["z-cp", "z-mp"],
  ["z-ndls", "z-cc"],
  ["z-ndls", "z-kg"],
  ["z-cc", "z-rf"],
  ["z-cc", "z-kg"],
  ["z-rf", "z-yb"],
  ["z-rf", "z-kg"],
  ["z-yb", "z-ln"],
  ["z-yb", "z-mv"],
  ["z-ln", "z-an"],
  ["z-an", "z-mv"],
  ["z-mv", "z-np"],
  ["z-hk", "z-np"],
  ["z-hk", "z-qm"],
  ["z-hk", "z-nh"],
  ["z-qm", "z-nh"],
  ["z-mp", "z-nh"],
  ["z-mp", "z-ow"],
  ["z-ow", "z-kg"],
];

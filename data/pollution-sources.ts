import type { PollutionSource } from "../types/air-quality";

/**
 * Representative source markers. `baseActivity` is an illustrative relative
 * index used to drive the visualisation — it is DEMO data, not an emissions
 * inventory, and source locations are schematic.
 */
export const POLLUTION_SOURCES: PollutionSource[] = [
  { id: "src-cp-circle", name: "Outer Circle traffic", category: "traffic", zoneId: "z-cp", position: [17.5, -22], baseActivity: 0.8, note: "Signal queues around the CP outer circle." },
  { id: "src-cp-gensets", name: "Commercial gensets", category: "commercial", zoneId: "z-cp", position: [-6, -6], baseActivity: 0.55, note: "Back-up diesel generators in office blocks." },
  { id: "src-ndls-stand", name: "Station bus & taxi stand", category: "traffic", zoneId: "z-ndls", position: [-12, -38.5], baseActivity: 0.75, note: "Idling taxis, autos and buses at the forecourt." },
  { id: "src-cc-market", name: "Bazaar kitchens & gensets", category: "commercial", zoneId: "z-cc", position: [8, -73.5], baseActivity: 0.85, note: "Street food, tandoors and wholesale-market generators." },
  { id: "src-cc-burn", name: "Open waste burning", category: "waste-burning", zoneId: "z-cc", position: [-12, -64], baseActivity: 0.6, note: "Illustrative refuse burning along back lanes." },
  { id: "src-rf-ring", name: "Ring Road at Red Fort", category: "traffic", zoneId: "z-rf", position: [56, -66], baseActivity: 0.7, note: "Through traffic between the fort and the river." },
  { id: "src-kg-isbt", name: "Interstate bus terminal", category: "traffic", zoneId: "z-kg", position: [-35, -81], baseActivity: 0.85, note: "Bus bays and interchange queues." },
  { id: "src-ig-ito", name: "ITO junction", category: "traffic", zoneId: "z-ig", position: [34, 8], baseActivity: 0.9, note: "One of the busiest signalised junctions in the model." },
  { id: "src-yb-dust", name: "Floodplain dust & burning", category: "waste-burning", zoneId: "z-yb", position: [80, -18], baseActivity: 0.4, note: "Dry riverbed dust and refuse fires on the banks." },
  { id: "src-ln-junction", name: "Vikas Marg junction", category: "traffic", zoneId: "z-ln", position: [96, -36], baseActivity: 0.85, note: "Arterial congestion at the metro interchange." },
  { id: "src-ln-works", name: "Metro extension works", category: "construction", zoneId: "z-ln", position: [106.5, -48.5], baseActivity: 0.7, note: "Excavation and material handling." },
  { id: "src-an-isbt", name: "Bus terminal & rail yard", category: "traffic", zoneId: "z-an", position: [106, 15], baseActivity: 0.95, note: "Interstate buses, freight trucks and idling." },
  { id: "src-an-ind", name: "Border industrial cluster", category: "industrial", zoneId: "z-an", position: [127, 29], baseActivity: 0.8, note: "Small furnaces and boilers across the border edge." },
  { id: "src-mv-landfill", name: "Landfill smouldering", category: "waste-burning", zoneId: "z-mv", position: [127, 89], baseActivity: 0.75, note: "Surface fires on the landfill mound (illustrative)." },
  { id: "src-np-ring", name: "Outer Ring Road at Nehru Place", category: "traffic", zoneId: "z-np", position: [56, 50], baseActivity: 0.8, note: "Peak-hour queues at the flyover approach." },
  { id: "src-np-offices", name: "Office district gensets", category: "commercial", zoneId: "z-np", position: [46, 58], baseActivity: 0.5, note: "Generator and HVAC exhaust from towers." },
  { id: "src-hk-site", name: "Residential redevelopment", category: "construction", zoneId: "z-hk", position: [-11, 59.5], baseActivity: 0.6, note: "Demolition and excavation dust." },
  { id: "src-qm-road", name: "Mehrauli road widening", category: "construction", zoneId: "z-qm", position: [-22, 96], baseActivity: 0.55, note: "Roadworks with exposed earth." },
  { id: "src-mp-smelter", name: "Smelter stack", category: "industrial", zoneId: "z-mp", position: [-95, -26], baseActivity: 0.95, note: "Metal recovery furnace stack." },
  { id: "src-mp-furnace", name: "Furnace cluster", category: "industrial", zoneId: "z-mp", position: [-86, -17], baseActivity: 0.8, note: "Small-scale furnaces and boilers." },
  { id: "src-ow-site", name: "Flyover construction", category: "construction", zoneId: "z-ow", position: [-66, -80], baseActivity: 0.85, note: "Piling, batching plant and material stockpiles." },
  { id: "src-ow-haul", name: "Unpaved haul road", category: "construction", zoneId: "z-ow", position: [-58, -70], baseActivity: 0.6, note: "Truck movements on unpaved access roads." },
  { id: "src-nh-toll", name: "Expressway toll plaza", category: "traffic", zoneId: "z-nh", position: [-98, 74], baseActivity: 0.9, note: "Freight queues and stop-start traffic." },
];

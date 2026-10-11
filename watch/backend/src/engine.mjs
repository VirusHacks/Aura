// AEROSCOPE watch engine: AQI classification, the scenario model, zone
// location, route comparison and alert rules. A line-for-line counterpart of
// AeroscopeKit (Swift); both are tested against the same fixtures so the
// watch, the backend and the web dashboard agree on every number.

// ---------------------------------------------------------------- AQI

export const AQI_MAX = 500;

export const AQI_BANDS = [
  { category: "Good", min: 0, max: 50, advice: "Minimal impact." },
  { category: "Satisfactory", min: 51, max: 100, advice: "Minor discomfort for sensitive people." },
  { category: "Moderate", min: 101, max: 200, advice: "Breathing discomfort for people with lung or heart disease." },
  { category: "Poor", min: 201, max: 300, advice: "Breathing discomfort for most people on prolonged exposure." },
  { category: "Very Poor", min: 301, max: 400, advice: "Respiratory illness on prolonged exposure." },
  { category: "Severe", min: 401, max: 500, advice: "Affects healthy people; serious impact on those with existing disease." },
];

export const CATEGORIES = AQI_BANDS.map((b) => b.category);
export const categoryRank = (category) => CATEGORIES.indexOf(category);

export function clampAqi(aqi) {
  if (!Number.isFinite(aqi)) return 0;
  return Math.min(AQI_MAX, Math.max(0, Math.round(aqi)));
}

export function aqiBand(aqi) {
  const v = clampAqi(aqi);
  return AQI_BANDS.find((b) => v <= b.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

export const aqiCategory = (aqi) => aqiBand(aqi).category;

const PM25 = [[0, 30, 0, 50], [31, 60, 51, 100], [61, 90, 101, 200], [91, 120, 201, 300], [121, 250, 301, 400], [251, 380, 401, 500]];
const PM10 = [[0, 50, 0, 50], [51, 100, 51, 100], [101, 250, 101, 200], [251, 350, 201, 300], [351, 430, 301, 400], [431, 510, 401, 500]];
const breakpoints = (p) => (p === "PM2.5" ? PM25 : PM10);

export function subIndex(pollutant, concentration) {
  const c = Math.max(0, Math.round(concentration));
  for (const [cLo, cHi, iLo, iHi] of breakpoints(pollutant)) {
    if (c <= cHi) return Math.round(iLo + ((iHi - iLo) * (c - cLo)) / (cHi - cLo));
  }
  return AQI_MAX;
}

export function concentrationForIndex(pollutant, index) {
  const bps = breakpoints(pollutant);
  const i = clampAqi(index);
  for (const [cLo, cHi, iLo, iHi] of bps) {
    if (i <= iHi) {
      let c = Math.round(cLo + ((cHi - cLo) * (i - iLo)) / (iHi - iLo));
      while (subIndex(pollutant, c) < i && c < cHi) c += 1;
      return c;
    }
  }
  return bps[bps.length - 1][1];
}

// ---------------------------------------------------------------- Scenario

export const TIME_STEPS = [
  { index: 0, hour: 6, label: "06:00", traffic: 0.7, mixing: 1.2, temperatureOffset: -4, windFactor: 0.7 },
  { index: 1, hour: 9, label: "09:00", traffic: 1.25, mixing: 1.08, temperatureOffset: -1, windFactor: 0.9 },
  { index: 2, hour: 12, label: "12:00", traffic: 0.85, mixing: 0.82, temperatureOffset: 3, windFactor: 1.15 },
  { index: 3, hour: 15, label: "15:00", traffic: 0.9, mixing: 0.8, temperatureOffset: 4, windFactor: 1.2 },
  { index: 4, hour: 18, label: "18:00", traffic: 1.35, mixing: 1.0, temperatureOffset: 1, windFactor: 0.9 },
  { index: 5, hour: 21, label: "21:00", traffic: 1.0, mixing: 1.18, temperatureOffset: -2, windFactor: 0.7 },
  { index: 6, hour: 0, label: "00:00", traffic: 0.45, mixing: 1.28, temperatureOffset: -5, windFactor: 0.6 },
  { index: 7, hour: 3, label: "03:00", traffic: 0.3, mixing: 1.32, temperatureOffset: -6, windFactor: 0.55 },
];

export const PRESETS = {
  "clear-morning": { label: "Clear Morning", load: 0.42, trafficBoost: 0.9, windSpeed: 3.6, temperatureOffset: 2 },
  "traffic-haze": { label: "Urban Traffic Haze", load: 1, trafficBoost: 1.35, windSpeed: 2.2, temperatureOffset: 0 },
  "winter-stagnation": { label: "Winter Stagnation", load: 1.38, trafficBoost: 1.1, windSpeed: 0.9, temperatureOffset: -6 },
  "breezy-dispersal": { label: "Breezy Dispersal", load: 0.6, trafficBoost: 1, windSpeed: 6.5, temperatureOffset: 1 },
};

export const DEFAULT_PRESET = "traffic-haze";
const REFERENCE_WIND = 2.5;
const SCENARIO_DATE = "2026-11-14";

export function normalizeScenario(s) {
  const preset = PRESETS[s?.preset] ? s.preset : DEFAULT_PRESET;
  const timeIndex = Number.isInteger(s?.timeIndex) ? Math.min(7, Math.max(0, s.timeIndex)) : 3;
  return { preset, timeIndex };
}

export const scenarioLabel = (s) => `${PRESETS[s.preset].label} · ${TIME_STEPS[s.timeIndex].label}`;

/** The 3-hourly step nearest to the wall-clock time in Delhi (IST). */
export function scenarioForClock(preset, date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(date));
  const dist = (a) => Math.min(Math.abs(a - hour) % 24, 24 - (Math.abs(a - hour) % 24));
  let best = TIME_STEPS[0];
  for (const step of TIME_STEPS) if (dist(step.hour) < dist(best.hour)) best = step;
  return { preset, timeIndex: best.index };
}

function windSpeed(s) {
  return Math.round(PRESETS[s.preset].windSpeed * TIME_STEPS[s.timeIndex].windFactor * 10) / 10;
}

export function scenarioMultiplier(trafficShare, s) {
  const step = TIME_STEPS[s.timeIndex];
  const preset = PRESETS[s.preset];
  const traffic = 1 - trafficShare + trafficShare * step.traffic * preset.trafficBoost;
  const dilution = Math.pow(REFERENCE_WIND / Math.max(0.3, windSpeed(s)), 0.35);
  return preset.load * step.mixing * traffic * dilution;
}

export function zoneReading(zone, scenario, provenance) {
  const s = normalizeScenario(scenario);
  const step = TIME_STEPS[s.timeIndex];
  const aqi = Math.max(12, clampAqi(zone.baseAqi * scenarioMultiplier(zone.trafficShare, s)));
  const secondary = Math.round(aqi * 0.82);
  const dominant = zone.dominant === "PM10" ? "PM10" : "PM2.5";
  return {
    zoneId: zone.id,
    zoneName: zone.name,
    region: zone.region,
    aqi,
    category: aqiCategory(aqi),
    pm25: concentrationForIndex("PM2.5", dominant === "PM2.5" ? aqi : secondary),
    pm10: concentrationForIndex("PM10", dominant === "PM10" ? aqi : secondary),
    dominant,
    temperature: Math.round(zone.baseTemperature + step.temperatureOffset + PRESETS[s.preset].temperatureOffset),
    windSpeed: windSpeed(s),
    scenarioTime: `${SCENARIO_DATE}T${String(step.hour).padStart(2, "0")}:00:00+05:30`,
    provenance,
    simulated: true,
  };
}

export function readingsByZone(dataset, scenario) {
  return Object.fromEntries(dataset.zones.map((z) => [z.id, zoneReading(z, scenario, dataset.provenance)]));
}

// ---------------------------------------------------------------- Geo

export const COVERAGE_RADIUS_KM = 5;

export function distanceKm(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function solve3(m, v) {
  const a = m.map((row) => [...row]);
  const b = [...v];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let r = col + 1; r < 3; r++) {
      const f = a[r][col] / a[col][col];
      for (let c = col; c < 3; c++) a[r][c] -= f * a[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < 3; c++) s -= a[r][c] * x[c];
    x[r] = s / a[r][r];
  }
  return x;
}

/** Least-squares affine map from coordinates to the schematic 3D city. */
export function makeProjection(dataset) {
  const anchors = dataset.zones.filter((z) => z.geo);
  if (anchors.length < 3) return null;
  const latMean = anchors.reduce((s, z) => s + z.geo.lat, 0) / anchors.length;
  const lonMean = anchors.reduce((s, z) => s + z.geo.lon, 0) / anchors.length;
  const rows = anchors.map((z) => [1, z.geo.lat - latMean, z.geo.lon - lonMean]);
  const fit = (targets) => {
    const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const atb = [0, 0, 0];
    rows.forEach((row, k) => {
      for (let i = 0; i < 3; i++) {
        atb[i] += row[i] * targets[k];
        for (let j = 0; j < 3; j++) ata[i][j] += row[i] * row[j];
      }
    });
    return solve3(ata, atb);
  };
  const xc = fit(anchors.map((z) => z.position[0]));
  const zc = fit(anchors.map((z) => z.position[1]));
  if (!xc || !zc) return null;
  return (p) => {
    const row = [1, p.lat - latMean, p.lon - lonMean];
    const dot = (c) => row.reduce((s, v, i) => s + v * c[i], 0);
    return { x: Math.round(dot(xc) * 10) / 10, z: Math.round(dot(zc) * 10) / 10 };
  };
}

/** Nearest zone anchor, or an outside-coverage result. */
export function locate(dataset, point, projection = makeProjection(dataset)) {
  let nearest = null;
  for (const zone of dataset.zones) {
    if (!zone.geo) continue;
    const km = distanceKm(point, zone.geo);
    if (!nearest || km < nearest.km) nearest = { zone, km };
  }
  if (!nearest) return { inside: false, nearestZoneName: null, distanceKm: null };
  if (nearest.km > COVERAGE_RADIUS_KM) return { inside: false, nearestZoneName: nearest.zone.name, distanceKm: nearest.km };
  return {
    inside: true,
    match: { zoneId: nearest.zone.id, zoneName: nearest.zone.name, distanceKm: nearest.km, world: projection ? projection(point) : null },
  };
}

// ---------------------------------------------------------------- Routes

export const ROAD_FACTOR = 1.3;
export const MIN_REDUCTION_PERCENT = 10;
export const MODE_SPEED_KMH = { walk: 4.8, cycle: 14, motor: 20 };

export function adjacency(dataset) {
  const ids = new Set(dataset.zones.map((z) => z.id));
  const adj = {};
  for (const link of dataset.links ?? []) {
    const [a, b] = link;
    if (link.length !== 2 || a === b || !ids.has(a) || !ids.has(b)) continue;
    (adj[a] ??= []).push(b);
    (adj[b] ??= []).push(a);
  }
  return adj;
}

export function makePlanner(dataset, aqiByZone) {
  const byId = Object.fromEntries(dataset.zones.map((z) => [z.id, z]));
  const adj = adjacency(dataset);
  const segmentKm = (a, b) => (byId[a]?.geo && byId[b]?.geo ? distanceKm(byId[a].geo, byId[b].geo) * ROAD_FACTOR : null);
  const segmentExposure = (a, b) => {
    const km = segmentKm(a, b);
    return km === null || aqiByZone[a] === undefined || aqiByZone[b] === undefined ? null : (km * (aqiByZone[a] + aqiByZone[b])) / 2;
  };

  function path(start, goal, kind) {
    if (!byId[start] || !byId[goal]) return null;
    if (start === goal) return [start];
    const dist = new Map([[start, 0]]);
    const prev = new Map();
    const visited = new Set();
    for (;;) {
      let current = null;
      for (const [id, d] of dist) {
        if (visited.has(id)) continue;
        if (!current || d < current[1] || (d === current[1] && id < current[0])) current = [id, d];
      }
      if (!current) return null;
      if (current[0] === goal) break;
      visited.add(current[0]);
      for (const next of [...(adj[current[0]] ?? [])].sort()) {
        if (visited.has(next)) continue;
        const w = kind === "cleaner" ? segmentExposure(current[0], next) : segmentKm(current[0], next);
        if (w === null) continue;
        const candidate = current[1] + w;
        if (candidate < (dist.get(next) ?? Infinity)) {
          dist.set(next, candidate);
          prev.set(next, current[0]);
        }
      }
    }
    const result = [goal];
    while (prev.has(result[0])) result.unshift(prev.get(result[0]));
    return result[0] === start ? result : null;
  }

  function option(zoneIds, kind, mode) {
    const first = zoneIds[0];
    if (!byId[first] || aqiByZone[first] === undefined) return null;
    let km = 0;
    let exposure = 0;
    let peak = { aqi: aqiByZone[first], name: byId[first].name };
    for (let i = 1; i < zoneIds.length; i++) {
      const [a, b] = [zoneIds[i - 1], zoneIds[i]];
      if (!(adj[a] ?? []).includes(b)) return null;
      const s = segmentKm(a, b);
      const e = segmentExposure(a, b);
      if (s === null || e === null) return null;
      km += s;
      exposure += e;
      if (aqiByZone[b] > peak.aqi) peak = { aqi: aqiByZone[b], name: byId[b].name };
    }
    return {
      id: `${kind}:${zoneIds.join(">")}`,
      kind,
      zoneIds,
      zoneNames: zoneIds.map((id) => byId[id].name),
      distanceKm: Math.round(km * 10) / 10,
      durationMinutes: Math.max(1, Math.round((km / (MODE_SPEED_KMH[mode] ?? MODE_SPEED_KMH.walk)) * 60)),
      averageAqi: km > 0 ? Math.round(exposure / km) : aqiByZone[first],
      peakAqi: peak.aqi,
      peakZoneName: peak.name,
      exposureIndex: Math.round(exposure),
    };
  }

  const route = (start, goal, kind, mode) => {
    const p = path(start, goal, kind === "cleaner" ? "cleaner" : "fastest");
    return p ? option(p, kind, mode) : null;
  };

  function compare(start, goal, mode, plannedZoneIds = [], label = null, now = new Date()) {
    const i = plannedZoneIds.indexOf(start);
    const remainder = i >= 0 ? plannedZoneIds.slice(i) : null;
    const current = (remainder && remainder[remainder.length - 1] === goal ? option(remainder, "planned", mode) : null)
      ?? route(start, goal, "fastest", mode);
    if (!current) return null;
    const cleaner = route(start, goal, "cleaner", mode);
    let alternative = null;
    let reduction = null;
    let note;
    if (cleaner && cleaner.zoneIds.join() !== current.zoneIds.join() && current.exposureIndex > 0) {
      const percent = Math.round(((current.exposureIndex - cleaner.exposureIndex) / current.exposureIndex) * 100);
      if (percent >= MIN_REDUCTION_PERCENT) {
        alternative = cleaner;
        reduction = percent;
        const via = cleaner.zoneNames.slice(1, -1);
        note = `Cleaner route${via.length ? ` via ${via.join(", ")}` : ""} cuts exposure by ${percent}%.`;
      } else {
        note = `Alternatives are less than ${MIN_REDUCTION_PERCENT}% cleaner. Stay on your route.`;
      }
    } else {
      note = start === goal ? "You have arrived." : "Your route is already the cleanest available.";
    }
    return {
      id: `cmp:${start}>${goal}:${Math.floor(now.getTime() / 1000)}`,
      fromZoneId: start,
      toZoneId: goal,
      mode,
      current,
      alternative,
      exposureReductionPercent: reduction,
      extraMinutes: alternative ? alternative.durationMinutes - current.durationMinutes : null,
      note,
      generatedAt: now.toISOString(),
      scenarioLabel: label,
    };
  }

  return { path, option, route, compare, segmentKm };
}

// ---------------------------------------------------------------- Alerts

export const DEFAULT_PREFERENCES = {
  alertsEnabled: true,
  threshold: "Poor",
  cooldownMinutes: 15,
  onlyDuringTrips: true,
  sensitiveGroup: false,
  lookAhead: true,
  travelMode: "walk",
  staleAfterMinutes: 30,
  updatedAt: new Date(0).toISOString(),
};

export function effectiveThresholdAqi(prefs) {
  let rank = Math.max(0, categoryRank(prefs.threshold));
  if (prefs.sensitiveGroup && rank > 1) rank -= 1;
  return AQI_BANDS[rank].min;
}

/**
 * Same rules as AlertEvaluator.swift. `history` entries: { zoneId, category, kind, createdAt }.
 * Returns { raise: { kind, reading } } or { suppress: reason }.
 */
export function evaluateAlert({ reading, dataAsOf, upcoming, tripPhase, history, now }, prefs) {
  if (!prefs.alertsEnabled) return { suppress: "disabled" };
  if (prefs.onlyDuringTrips && tripPhase !== "active") return { suppress: "no-active-trip" };
  if (now - dataAsOf > prefs.staleAfterMinutes * 60_000) return { suppress: "stale-data" };
  const threshold = effectiveThresholdAqi(prefs);

  const check = (r, kind) => {
    const rank = categoryRank(aqiCategory(r.aqi));
    if (history.some((h) => h.zoneId === r.zoneId && categoryRank(h.category) >= rank)) return { suppress: "already-warned" };
    const latest = history.reduce((a, h) => (!a || new Date(h.createdAt) > new Date(a.createdAt) ? h : a), null);
    const escalation = latest ? rank > categoryRank(latest.category) : false;
    if (!escalation && latest && now - new Date(latest.createdAt) < prefs.cooldownMinutes * 60_000) return { suppress: "cooling-down" };
    return { raise: { kind: kind === "entered-zone" && escalation ? "escalation" : kind, reading: r } };
  };

  let reason = "below-threshold";
  if (reading.aqi >= threshold) {
    const d = check(reading, "entered-zone");
    if (d.raise) return d;
    reason = d.suppress;
  }
  if (prefs.lookAhead && upcoming && upcoming.zoneId !== reading.zoneId && upcoming.aqi >= threshold) {
    const d = check(upcoming, "upcoming-zone");
    if (d.raise) return d;
    if (reason === "below-threshold") reason = d.suppress;
  }
  return { suppress: reason };
}

export const historyEntry = (alert) => ({
  zoneId: alert.zoneId,
  category: aqiCategory(alert.aqi),
  kind: alert.kind,
  createdAt: alert.createdAt,
});

/** Resolves a reported location (geo wins; a zone id is accepted for simulated points). */
export function resolveLocation(dataset, location, projection = makeProjection(dataset)) {
  if (location?.geo && Number.isFinite(location.geo.lat) && Number.isFinite(location.geo.lon)) {
    const result = locate(dataset, location.geo, projection);
    if (result.inside) return { match: result.match };
    if (!location.simulated || !location.zoneId) return { outside: result };
  }
  if (!location?.zoneId) return { error: "No position supplied" };
  const zone = dataset.zones.find((z) => z.id === location.zoneId);
  if (!zone) return { error: `Unknown zone ${location.zoneId}` };
  return { match: { zoneId: zone.id, zoneName: zone.name, distanceKm: 0, world: location.world ?? { x: zone.position[0], z: zone.position[1] } } };
}

/** Full evaluation of one position for a trip — mirrors TripEvaluator.swift. */
export function evaluatePosition({ dataset, scenario, location, prefs, trip, history, now, newId, origin = "backend" }) {
  const resolved = resolveLocation(dataset, location);
  if (!resolved.match) return resolved;
  const { match } = resolved;
  const zone = dataset.zones.find((z) => z.id === match.zoneId);
  const reading = zoneReading(zone, scenario, dataset.provenance);
  const planned = trip?.plannedZoneIds ?? [];
  const i = planned.indexOf(zone.id);
  const nextId = i >= 0 && i + 1 < planned.length ? planned[i + 1] : null;
  const nextZone = nextId ? dataset.zones.find((z) => z.id === nextId) : null;
  const upcoming = nextZone ? zoneReading(nextZone, scenario, dataset.provenance) : null;
  const decision = evaluateAlert({ reading, dataAsOf: now, upcoming, tripPhase: trip?.phase ?? null, history, now }, prefs);
  let alert = null;
  if (decision.raise) {
    const target = decision.raise.reading;
    alert = {
      id: newId(),
      tripId: trip?.tripId ?? null,
      zoneId: target.zoneId,
      zoneName: target.zoneName,
      aqi: target.aqi,
      pm25: target.pm25,
      kind: decision.raise.kind,
      origin,
      status: "active",
      createdAt: now.toISOString(),
      scenarioLabel: scenarioLabel(scenario),
      simulated: target.simulated,
    };
  }
  return {
    evaluation: {
      reading,
      match,
      upcoming,
      alert,
      suppression: decision.suppress ?? null,
      scenario,
      dataAsOf: now.toISOString(),
    },
  };
}

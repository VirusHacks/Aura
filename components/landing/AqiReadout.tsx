"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";
import { getAqiBand } from "@/lib/aqi";
import { delhiHour, timeIndexForHour } from "@/lib/landing-data";
import { computeReadings, TIME_STEPS } from "@/lib/simulation-engine";
import { useAirData } from "./AirData";

const FEATURED = ["z-an", "z-cp", "z-lg", "z-cc", "z-yb", "z-mp"];
const CYCLE_MS = 4200;

const noopSubscribe = () => () => {};
const currentTimeIndex = () => timeIndexForHour(delhiHour());

/**
 * A small instrument-style readout that cycles through a few neighbourhoods.
 * Values come from the scenario model at the time step nearest to the current
 * hour in Delhi, and are labelled as demo data unless a verified baseline is
 * connected.
 */
export function AqiReadout() {
  const { dataset, verified } = useAirData();
  // The server renders the 15:00 step; the browser shows Delhi's current hour.
  const timeIndex = useSyncExternalStore(noopSubscribe, currentTimeIndex, () => 3);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);

  const readings = useMemo(() => {
    const all = computeReadings(dataset, timeIndex, "traffic-haze");
    return FEATURED.map((id) => all.find((r) => r.id === id)).filter((r) => r !== undefined);
  }, [dataset, timeIndex]);

  const cycling = !paused && !hovered;
  useEffect(() => {
    if (!cycling || readings.length < 2) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % readings.length), CYCLE_MS);
    return () => window.clearInterval(t);
  }, [cycling, readings.length]);

  const r = readings[i % readings.length];
  if (!r) return null;
  const band = getAqiBand(r.aqi);
  const step = TIME_STEPS[timeIndex];

  return (
    <aside
      className="lp-readout"
      aria-label="Air quality readout"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <div className="lp-readout__head">
        <span className="lp-readout__place">{r.name}</span>
        <button
            type="button"
            className="lp-readout__pause"
            aria-label={paused ? "Resume cycling through neighbourhoods" : "Pause cycling through neighbourhoods"}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
          </button>
      </div>
      <div className="lp-readout__value">
        <span className="lp-readout__aqi lp-num">{r.aqi}</span>
        <span className="lp-readout__band">
          <span className="lp-readout__swatch" style={{ background: band.color }} aria-hidden />
          {band.category}
          <span className="lp-note" style={{ marginLeft: 2 }}>AQI</span>
        </span>
      </div>
      <div className="lp-readout__bar" aria-hidden>
        <span className="lp-readout__tick" style={{ left: `${Math.min(100, (r.aqi / 500) * 100)}%` }} />
      </div>
      <div className="lp-readout__meta lp-note">
        <span>
          {r.dominant} {r.dominant === "PM2.5" ? r.pm25 : r.pm10} µg/m³
        </span>
        <span>{step.label} scenario</span>
      </div>
      <p className="lp-note lp-prov" data-verified={verified} style={{ marginTop: 10, color: "var(--ink-2)" }}>
        {verified ? "Modelled from a verified baseline" : "Illustrative demo data, not a live reading"}
      </p>
    </aside>
  );
}

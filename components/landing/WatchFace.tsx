"use client";

import { AnimatePresence, motion } from "motion/react";
import { getAqiBand } from "@/lib/aqi";
import type { ZoneReading } from "@/types/air-quality";

export type WatchScreen = "air" | "alert" | "routes" | "rerouted";

export interface WatchFaceProps {
  screen: WatchScreen;
  /** The zone the walker is in. */
  here: ZoneReading;
  /** The poor-air zone ahead. */
  ahead: ZoneReading;
  via: string;
  fastestAvg: number;
  cleanerAvg: number;
  saving: number;
}

function Ring({ aqi }: { aqi: number }) {
  const band = getAqiBand(aqi);
  const c = 2 * Math.PI * 42;
  return (
    <svg viewBox="0 0 100 100" style={{ width: "58%", margin: "4% auto 0", display: "block" }} aria-hidden>
      <circle cx="50" cy="50" r="42" fill="none" stroke="#25292d" strokeWidth="8" />
      <circle
        cx="50"
        cy="50"
        r="42"
        fill="none"
        stroke={band.color}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${(Math.min(aqi, 500) / 500) * c} ${c}`}
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="52" textAnchor="middle" fill="#fff" fontSize="26" fontWeight="600" style={{ fontVariantNumeric: "tabular-nums" }}>
        {aqi}
      </text>
      <text x="50" y="68" textAnchor="middle" fill="#9aa0a6" fontSize="9.5">
        {band.category}
      </text>
    </svg>
  );
}

/**
 * An illustration of the AEROSCOPE watch app's screens (Air, alert sheet and
 * Routes), drawn in HTML so it scales and stays crisp. Content mirrors the
 * watch demo; it is not a screenshot.
 */
export function WatchFace({ screen, here, ahead, via, fastestAvg, cleanerAvg, saving }: WatchFaceProps) {
  const aheadBand = getAqiBand(ahead.aqi);
  return (
    <div className="lp-watch" role="img" aria-label={describe(screen, here, ahead, via, saving)}>
      <div className="lp-watch__screen">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={screen === "air" ? `air-${here.id}` : screen}
            className="lp-watch__pane"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
          >
            {screen === "air" && (
              <>
                <div className="lp-watch__top">
                  <span>Air</span>
                  <span className="lp-watch__badge">DEMO</span>
                </div>
                <Ring aqi={here.aqi} />
                <div style={{ textAlign: "center", marginTop: "3%", fontWeight: 600 }}>{here.name}</div>
                <div className="lp-watch__muted" style={{ textAlign: "center", fontSize: "0.85em" }}>
                  PM2.5 {here.pm25} µg/m³
                </div>
              </>
            )}
            {screen === "alert" && (
              <>
                <div className="lp-watch__top">
                  <span style={{ color: aheadBand.color, fontWeight: 600 }}>Poor air ahead</span>
                  <span className="lp-watch__badge">DEMO</span>
                </div>
                <div style={{ marginTop: "6%", fontWeight: 600 }}>{ahead.name}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.35em" }}>
                  <span className="lp-watch__big">{ahead.aqi}</span>
                  <span style={{ color: aheadBand.color, fontWeight: 600 }}>{aheadBand.category}</span>
                </div>
                <div className="lp-watch__muted" style={{ fontSize: "0.82em", marginTop: "2%" }}>
                  {aheadBand.advice}
                </div>
                <div style={{ marginTop: "auto" }}>
                  <span className="lp-watch__btn lp-watch__btn--primary">Cleaner route</span>
                  <span className="lp-watch__btn">Got it</span>
                </div>
              </>
            )}
            {(screen === "routes" || screen === "rerouted") && (
              <>
                <div className="lp-watch__top">
                  <span>Routes</span>
                  <span className="lp-watch__badge">DEMO</span>
                </div>
                <div style={{ marginTop: "6%", paddingBottom: "4%", borderBottom: "1px solid #25292d" }}>
                  <div className="lp-watch__muted" style={{ fontSize: "0.85em" }}>Fastest, via {ahead.name}</div>
                  <div>
                    avg <b style={{ fontVariantNumeric: "tabular-nums" }}>{fastestAvg}</b>
                  </div>
                </div>
                <div style={{ marginTop: "4%" }}>
                  <div style={{ fontSize: "0.85em", color: "var(--cyan)" }}>Cleaner, via {via}</div>
                  <div>
                    avg <b style={{ fontVariantNumeric: "tabular-nums" }}>{cleanerAvg}</b>
                    <span className="lp-watch__muted"> · {saving}% less</span>
                  </div>
                </div>
                <div style={{ marginTop: "auto" }}>
                  <span className={`lp-watch__btn ${screen === "routes" ? "lp-watch__btn--primary" : ""}`}>
                    {screen === "routes" ? "Take cleaner route" : "✓ Cleaner route active"}
                  </span>
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function describe(screen: WatchScreen, here: ZoneReading, ahead: ZoneReading, via: string, saving: number): string {
  switch (screen) {
    case "air":
      return `Apple Watch, Air screen: ${here.name}, AQI ${here.aqi}, ${here.category}. Demo data.`;
    case "alert":
      return `Apple Watch alert: poor air ahead in ${ahead.name}, AQI ${ahead.aqi}. Options: cleaner route, got it.`;
    case "routes":
      return `Apple Watch routes: a cleaner route via ${via} with ${saving}% less modelled exposure.`;
    case "rerouted":
      return `Apple Watch: cleaner route via ${via} is active.`;
  }
}

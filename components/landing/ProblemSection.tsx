"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AQI_BANDS, getAqiBand, getAqiColor } from "@/lib/aqi";
import { ARTERIALS, RING, riverX, WORLD } from "@/lib/city-layout";
import { citySpread } from "@/lib/landing-data";
import type { ZoneReading } from "@/types/air-quality";
import { useAirData } from "./AirData";
import { Reveal } from "./Reveal";

type View = "average" | "zones";

const PAD = 6;
const VIEWBOX = `${WORLD.minX - PAD} ${WORLD.minZ - PAD} ${WORLD.maxX - WORLD.minX + PAD * 2} ${WORLD.maxZ - WORLD.minZ + PAD * 2}`;

function riverPath(): string {
  const pts: string[] = [];
  for (let z = WORLD.minZ - PAD; z <= WORLD.maxZ + PAD; z += 6) pts.push(`${riverX(z).toFixed(1)},${z}`);
  return `M${pts.join(" L")}`;
}
const RIVER_PATH = riverPath();

function NeighbourhoodMap({ readings, view, selected, onSelect }: { readings: ZoneReading[]; view: View; selected: string | null; onSelect: (id: string) => void }) {
  const reduce = useReducedMotion();
  const { average } = citySpread(readings);
  const avgColor = getAqiColor(average);
  const duration = reduce ? 0 : 0.7;

  return (
    <svg viewBox={VIEWBOX} role="group" aria-label="Map of Delhi neighbourhoods coloured by AQI">
      <path d={RIVER_PATH} fill="none" stroke="#c4cdd2" strokeWidth={12} strokeLinecap="round" />
      <rect
        x={RING.x0}
        y={RING.z0}
        width={RING.x1 - RING.x0}
        height={RING.z1 - RING.z0}
        rx={RING.r}
        fill="none"
        stroke="var(--paper-3)"
        strokeWidth={2.2}
      />
      {ARTERIALS.map((road) => (
        <polyline
          key={road.id}
          points={road.points.map(([x, z]) => `${x},${z}`).join(" ")}
          fill="none"
          stroke="var(--paper-3)"
          strokeWidth={Math.max(1.2, road.width * 0.4)}
          strokeLinecap="round"
        />
      ))}

      {readings.map((r, i) => {
        const shown = view === "zones" ? r.aqi : average;
        const color = view === "zones" ? getAqiColor(r.aqi) : avgColor;
        const [x, z] = r.position;
        const isSel = selected === r.id;
        return (
          <g
            key={r.id}
            className="lp-zone"
            tabIndex={0}
            role="button"
            aria-pressed={isSel}
            aria-label={`${r.name}: ${view === "zones" ? `AQI ${r.aqi}, ${r.category}` : `city average ${average}`}`}
            onClick={() => onSelect(r.id)}
            onMouseEnter={() => onSelect(r.id)}
            onFocus={() => onSelect(r.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(r.id);
              }
            }}
          >
            <motion.circle
              cx={x}
              cy={z}
              r={r.radius * 0.95}
              initial={false}
              animate={{ fill: color, fillOpacity: view === "zones" ? 0.2 + (r.aqi / 500) * 0.5 : 0.42 }}
              transition={{ duration, delay: reduce ? 0 : i * 0.02 }}
            />
            <circle
              className="lp-zone__ring"
              cx={x}
              cy={z}
              r={r.radius * 0.95}
              fill="none"
              stroke="var(--ink)"
              strokeOpacity={isSel ? 0.9 : 0}
              strokeWidth={0.9}
            />
            <text x={x} y={z + 2.4} textAnchor="middle" className="lp-map__label" fontSize={7} fill="var(--ink)">
              {shown}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ProblemSection() {
  const { readings, verified } = useAirData();
  const [view, setView] = useState<View>("zones");
  const [selected, setSelected] = useState<string | null>(null);
  const spread = citySpread(readings);
  const current = readings.find((r) => r.id === selected) ?? spread.max;
  const band = getAqiBand(view === "zones" ? current.aqi : spread.average);

  return (
    <section id="overview" data-section="overview" className="lp-section" aria-labelledby="problem-title">
      <div className="lp-container lp-problem">
        <div className="lp-problem__text">
          <Reveal>
            <h2 id="problem-title" className="lp-display lp-h2">
              One city. Thousands of different <span style={{ whiteSpace: "nowrap" }}>air-quality</span> experiences.
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <div style={{ marginTop: "2rem" }}>
              <p className="lp-body">
                Delhi&rsquo;s air is usually summed up in one number, a city-wide AQI. But pollution doesn&rsquo;t spread evenly.
                It pools along arterial roads, around bus depots and industrial estates, and thins out over parks and the
                river.
              </p>
              <p className="lp-body">
                Two people in the same city on the same afternoon can breathe very different air, and so can one person over a
                single commute. A city average can&rsquo;t tell you which streets to avoid.
              </p>
              <p className="lp-problem__punch">
                In the demo scenario, readings run from {spread.min.aqi} at {spread.min.name} to {spread.max.aqi} at{" "}
                {spread.max.name}. The city-wide average, {spread.average}, describes neither.
              </p>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.15}>
          <figure className="lp-map">
            <div className="lp-map__bar">
              <div className="lp-toggle" role="group" aria-label="Map view">
                <button type="button" aria-pressed={view === "average"} onClick={() => setView("average")}>
                  City average
                </button>
                <button type="button" aria-pressed={view === "zones"} onClick={() => setView("zones")}>
                  By neighbourhood
                </button>
              </div>
              <span className="lp-note lp-prov" data-verified={false}>
                Simulated, weekday traffic haze at 15:00
              </span>
            </div>

            <NeighbourhoodMap readings={readings} view={view} selected={selected} onSelect={setSelected} />

            <div className="lp-map__detail" aria-live="polite">
              <span className="lp-ui">
                {view === "zones" ? (
                  <>
                    <b style={{ fontWeight: 500 }}>{current.name}</b>: AQI <span className="lp-num">{current.aqi}</span>,{" "}
                    {band.category.toLowerCase()}
                  </>
                ) : (
                  <>
                    Every neighbourhood: AQI <span className="lp-num">{spread.average}</span>, {band.category.toLowerCase()}
                  </>
                )}
              </span>
              <span className="lp-legend lp-note" aria-label="AQI bands">
                {AQI_BANDS.map((b) => (
                  <span key={b.category}>
                    <i style={{ background: b.color }} aria-hidden />
                    {b.category}
                  </span>
                ))}
              </span>
            </div>
            <figcaption className="lp-note" style={{ marginTop: 10 }}>
              Stylised map of {readings.length} neighbourhoods. {verified ? "Modelled from a verified baseline." : "Illustrative demo values, not measurements."}{" "}
              Bands follow India&rsquo;s National AQI.
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}

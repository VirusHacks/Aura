"use client";

import { useRef, type ReactNode } from "react";
import Image from "next/image";
import { motion, useScroll, useTransform } from "motion/react";
import { getAqiColor } from "@/lib/aqi";
import { JOURNEY } from "@/lib/landing-data";
import type { Vec2 } from "@/types/scene";
import zonesShot from "@/public/landing/simulation-zones.jpg";
import { Reveal } from "./Reveal";
import { useJourney } from "./useJourney";
import { WatchFace } from "./WatchFace";

/** Media that drifts gently against the scroll. */
function Drift({ children, distance = 40 }: { children: ReactNode; distance?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  return (
    <div ref={ref} className="lp-frame">
      <motion.div style={{ y, position: "absolute", inset: `-${distance}px 0` }}>{children}</motion.div>
    </div>
  );
}

function Story({ title, summary, children, media, flip }: { title: string; summary: string; children: ReactNode; media: ReactNode; flip?: boolean }) {
  return (
    <article className="lp-story" data-flip={flip || undefined}>
      <Reveal className="lp-story__media">{media}</Reveal>
      <span className="lp-story__node" aria-hidden />
      <Reveal className="lp-story__text" delay={0.12}>
        <h3 className="lp-h3">{title}</h3>
        <p className="lp-story__summary">{summary}</p>
        {children}
      </Reveal>
    </article>
  );
}

/** Zones whose label sits left of the dot, so labels clear the route lines. */
const LABEL_LEFT = new Set(["z-cc", "z-ndls", "z-cp", "z-ig"]);

function RouteSketch() {
  const j = useJourney();
  const pts = (ids: readonly string[]) => ids.map((id) => j.readings.find((r) => r.id === id)!.position);
  const line = (p: Vec2[]) => p.map(([x, z]) => `${x},${z}`).join(" ");
  const fromGate = (ids: readonly string[]) => ids.slice(ids.indexOf(JOURNEY.alertAt));
  const zones = new Set<string>([...JOURNEY.fastest, ...JOURNEY.cleaner]);

  return (
    <div className="lp-routes">
      <svg viewBox="-66 -86 186 124" preserveAspectRatio="xMidYMid meet" aria-hidden>
        <polyline points={line(pts(JOURNEY.fastest.slice(0, 2)))} fill="none" stroke="var(--blue)" strokeWidth={1.6} />
        <polyline points={line(pts(fromGate(JOURNEY.fastest)))} fill="none" stroke="#f08c00" strokeWidth={1.4} strokeDasharray="3 2.2" />
        <motion.polyline
          points={line(pts(fromGate(JOURNEY.cleaner)))}
          fill="none"
          stroke="var(--blue)"
          strokeWidth={2.2}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, margin: "-20%" }}
          transition={{ duration: 1.6, ease: [0.2, 0.7, 0.2, 1], delay: 0.3 }}
        />
        {j.readings
          .filter((r) => zones.has(r.id))
          .map((r) => (
            <g key={r.id}>
              <circle cx={r.position[0]} cy={r.position[1]} r={r.id === JOURNEY.hotspot ? 5 : 3} fill={getAqiColor(r.aqi)} fillOpacity={0.9} />
              <text
                x={r.position[0] + (LABEL_LEFT.has(r.id) ? -6 : 6)}
                y={r.position[1] + 1.6}
                textAnchor={LABEL_LEFT.has(r.id) ? "end" : "start"}
                fontSize={4.4}
                className="lp-map__label"
                fill="var(--ink-2)"
              >
                {r.name.split(" &")[0]} {r.aqi}
              </text>
            </g>
          ))}
      </svg>
      <div className="lp-routes__table lp-ui">
        <div className="lp-routes__row">
          <span>
            <i className="lp-routes__key" style={{ borderColor: "#f08c00", borderTopStyle: "dashed" }} aria-hidden />
            Fastest, via {j.hotspot.name}
          </span>
          <span>
            avg <b className="lp-num">{j.fastest.averageAqi}</b>
          </span>
          <span>
            peak <b className="lp-num">{j.fastest.peakAqi}</b>
          </span>
        </div>
        <div className="lp-routes__row">
          <span>
            <i className="lp-routes__key" style={{ borderColor: "var(--blue)" }} aria-hidden />
            Cleaner, via {j.via.name}
          </span>
          <span>
            avg <b className="lp-num">{j.cleaner.averageAqi}</b>
          </span>
          <span>
            peak <b className="lp-num">{j.cleaner.peakAqi}</b>
          </span>
        </div>
      </div>
    </div>
  );
}

export function HowItWorks() {
  const j = useJourney();
  const listRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: listRef, offset: ["start 60%", "end 60%"] });

  return (
    <section id="how-it-works" data-section="how-it-works" className="lp-section" aria-labelledby="how-title" style={{ paddingTop: 0 }}>
      <div className="lp-container">
        <div className="lp-how__intro">
          <Reveal>
            <h2 id="how-title" className="lp-display lp-h2">
              How AEROSCOPE works
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="lp-lede">
              A model of the city&rsquo;s air you can look at, carry on your wrist and use to choose a better way through it.
            </p>
          </Reveal>
        </div>

        <div ref={listRef} className="lp-stories">
          <div className="lp-thread" aria-hidden>
            <motion.div className="lp-thread__fill" style={{ scaleY: scrollYProgress }} />
          </div>

          <Story
            title="See the invisible"
            summary="Explore pollution hotspots through an interactive 3D Delhi digital twin."
            media={
              <Drift>
                <Image
                  src={zonesShot}
                  alt="The AEROSCOPE simulation: a 3D model of Delhi with AQI labels floating over each neighbourhood"
                  fill
                  sizes="(min-width: 1024px) 45vw, 100vw"
                  style={{ objectFit: "cover" }}
                  placeholder="blur"
                />
              </Drift>
            }
          >
            <p className="lp-body">
              Move across {j.readings.length} neighbourhoods, from Chandni Chowk to Anand Vihar. Haze, emission plumes and wind
              are drawn into the city itself, and a timeline shows how the air changes from morning rush hour to night.
            </p>
          </Story>

          <Story
            flip
            title="Stay aware"
            summary="Receive location-aware air-quality alerts through the Apple Watch companion."
            media={
              <div className="lp-frame" style={{ display: "grid", placeItems: "center" }}>
                <svg viewBox="0 0 400 320" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden>
                  {[60, 100, 140, 180, 220].map((r) => (
                    <circle key={r} cx="200" cy="160" r={r} fill="none" stroke="var(--rule)" />
                  ))}
                </svg>
                <div style={{ position: "relative", ["--watch-w" as string]: "clamp(140px, 15vw, 210px)" }}>
                  <WatchFace
                    screen="alert"
                    here={j.alertAt}
                    ahead={j.hotspot}
                    via={j.via.name}
                    fastestAvg={j.fastest.averageAqi}
                    cleanerAvg={j.cleaner.averageAqi}
                    saving={j.saving}
                  />
                </div>
              </div>
            }
          >
            <p className="lp-body">
              The watch matches where you are to a neighbourhood of the city and looks ahead along your trip. Before you reach
              poor air, it taps your wrist with the AQI, the main pollutant and health advice from India&rsquo;s national AQI
              bands.
            </p>
          </Story>

          <Story
            title="Choose differently"
            summary="Compare alternative routes using available AQI information and modelled exposure indicators."
            media={
              <div className="lp-frame">
                <RouteSketch />
              </div>
            }
          >
            <p className="lp-body">
              Put the fastest route next to a cleaner one: average and peak AQI along the way, distance and time. In the demo,
              turning east at {j.alertAt.name.split(" &")[0]} cuts modelled exposure by {j.saving}% for about {j.extraDistance}%
              more distance.
            </p>
          </Story>
        </div>
      </div>
    </section>
  );
}

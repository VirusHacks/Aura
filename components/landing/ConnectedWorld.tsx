"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useInView, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { BEATS } from "./scene/DelhiDiorama";
import { Reveal } from "./Reveal";
import { useJourney } from "./useJourney";
import { WatchFace, type WatchScreen } from "./WatchFace";

const DioramaCanvas = dynamic(() => import("./scene/DioramaCanvas"), { ssr: false });

const STARTS = [0, BEATS.arrive, BEATS.alert, BEATS.reroute] as const;
const SCREENS: WatchScreen[] = ["air", "alert", "routes", "rerouted"];

function stepFor(p: number): number {
  let s = 0;
  STARTS.forEach((start, i) => {
    if (p >= start) s = i;
  });
  return s;
}

const ARCHITECTURE = [
  {
    name: "The 3D city",
    tech: "Next.js, React Three Fiber",
    body: "Draws Delhi's neighbourhoods, emission sources, wind and time of day, and lets you inspect any zone or building.",
  },
  {
    name: "The backend",
    tech: "AWS API Gateway, Lambda, DynamoDB",
    body: "Serves zone baselines and scenarios to the city and the watch, and records trips, alerts and reroutes.",
  },
  {
    name: "The watch",
    tech: "watchOS and iPhone, SwiftUI",
    body: "Matches your position to a zone, warns you before poor air and offers a cleaner route. It works offline from cached data.",
  },
];

export function ConnectedWorld() {
  const j = useJourney();
  const reduce = useReducedMotion() ?? false;
  const filmRef = useRef<HTMLDivElement>(null);
  const near = useInView(filmRef, { margin: "50% 0px 50% 0px" });
  const visible = useInView(filmRef);
  const { scrollYProgress } = useScroll({ target: filmRef, offset: ["start start", "end end"] });
  const [step, setStep] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (p) => setStep(stepFor(p)));

  const steps = [
    {
      title: "Start a trip",
      body: `Walking from ${j.start.name} to ${j.destination.name}. The watch places each step in a neighbourhood of the city model and checks the air ahead.`,
    },
    {
      title: "Poor air ahead",
      body: `Past ${j.alertAt.name.split(" &")[0]}, the fastest route runs straight into ${j.hotspot.name}, at AQI ${j.hotspot.aqi}. The watch taps your wrist before you get there.`,
    },
    {
      title: "Ask for a cleaner route",
      body: `One tap compares routes. Following the ${j.via.name} instead means ${j.saving}% less modelled exposure, for about ${j.extraDistance}% more distance.`,
    },
    {
      title: "The route changes",
      body: "The trip updates on the watch and the backend, and the walk turns east toward the river. Watch, phone and backend stay in step.",
    },
  ];

  const screen = SCREENS[step];

  const jump = (i: number) => {
    const el = filmRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const span = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + span * (STARTS[i] + 0.04), behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <section id="technology" data-section="technology" data-tone="dark" className="lp-dark" aria-labelledby="world-title">
      <div className="lp-container lp-how__intro" style={{ paddingTop: "var(--section)", marginBottom: "clamp(40px, 5vw, 72px)" }}>
        <Reveal>
          <h2 id="world-title" className="lp-display lp-h2">
            One connected world
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="lp-lede">
            The 3D city, your Apple Watch and a small AWS backend share one model of Delhi&rsquo;s air. Scroll to follow a single
            trip through all three.
          </p>
        </Reveal>
      </div>

      <div ref={filmRef} className="lp-film">
        <div className="lp-film__stage">
          <div className="lp-film__canvas">
            {near && (
              <DioramaCanvas
                mode="journey"
                readings={j.readings}
                reducedMotion={reduce}
                progress={scrollYProgress}
                active={visible}
                fallback={null}
              />
            )}
          </div>
          <div className="lp-film__shade" />

          <div className="lp-container lp-film__ui">
            <span className="lp-film__badge lp-note lp-prov" data-verified={false}>
              Replay of the demo journey. All readings simulated.
            </span>

            <div className="lp-film__body">
              <div className="lp-film__caption" aria-live="polite">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
                  >
                    <p className="lp-film__step">
                      {step + 1} of {steps.length}
                    </p>
                    <h3 className="lp-display lp-film__title">{steps[step].title}</h3>
                    <p className="lp-body">{steps[step].body}</p>
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="lp-film__watch">
                <WatchFace
                  screen={screen}
                  here={j.start}
                  ahead={j.hotspot}
                  via={j.via.name}
                  fastestAvg={j.fastest.averageAqi}
                  cleanerAvg={j.cleaner.averageAqi}
                  saving={j.saving}
                />
              </div>
            </div>

            <nav className="lp-film__steps" aria-label="Journey steps">
              {steps.map((s, i) => (
                <button
                  key={s.title}
                  type="button"
                  className="lp-film__dot"
                  aria-current={step === i ? "step" : undefined}
                  aria-label={`Step ${i + 1}: ${s.title}`}
                  onClick={() => jump(i)}
                >
                  <span />
                </button>
              ))}
            </nav>
          </div>
        </div>
      </div>

      <div className="lp-container" style={{ paddingBottom: "var(--section)" }}>
        <Reveal>
          <h3 className="lp-h3" style={{ marginTop: "clamp(64px, 9vw, 128px)", maxWidth: "18ch" }}>
            Three parts, one model of the air
          </h3>
        </Reveal>
        <div className="lp-arch">
          {ARCHITECTURE.map((a, i) => (
            <Reveal key={a.name} delay={i * 0.08} className="lp-arch__node">
              <p className="lp-ui" style={{ fontSize: "1.25rem", fontWeight: 500 }}>
                {a.name}
              </p>
              <p className="lp-ui lp-arch__tech">{a.tech}</p>
              <p className="lp-body">{a.body}</p>
            </Reveal>
          ))}
        </div>
        <div className="lp-provenance">
          <p className="lp-ui" style={{ fontWeight: 500 }}>
            Reading the data
          </p>
          <p className="lp-note lp-prov" data-verified={false} style={{ alignItems: "baseline" }}>
            <span>
              <b style={{ color: "var(--night-ink)", fontWeight: 500 }}>Simulated.</b> Output of the scenario model, built on a
              demo dataset of neighbourhood baselines. Everything on this page is simulated.
            </span>
          </p>
          <p className="lp-note lp-prov" data-verified style={{ alignItems: "baseline" }}>
            <span>
              <b style={{ color: "var(--night-ink)", fontWeight: 500 }}>Verified live.</b> Readings from a verified monitoring
              source. They appear only once one is connected, and the watch marks them LIVE.
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

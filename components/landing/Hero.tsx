"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowDown, ArrowRight } from "lucide-react";
import { SimulationLink } from "./SimulationLink";
import { motion, useInView, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useAirData } from "./AirData";
import { AqiReadout } from "./AqiReadout";

const DioramaCanvas = dynamic(() => import("./scene/DioramaCanvas"), { ssr: false });

const EASE = [0.2, 0.7, 0.2, 1] as const;

export function Hero() {
  const { readings } = useAirData();
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref);
  const [ready, setReady] = useState(false);

  // Restrained parallax: the city sinks a little slower than the page scrolls.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const sceneY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 140]);
  const textY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -50]);

  return (
    <section ref={ref} id="top" className="lp-hero" aria-labelledby="hero-title">
      <motion.div className="lp-hero__scene" style={{ y: sceneY }}>
        <div className="lp-hero__canvas" data-ready={ready}>
          <DioramaCanvas
            mode="hero"
            readings={readings}
            reducedMotion={reduce}
            active={inView}
            fallback={null}
            onReady={() => setReady(true)}
          />
        </div>
        <div className="lp-hero__scrim" />
      </motion.div>

      <motion.div className="lp-container lp-hero__content" style={{ y: textY }}>
        <h1 id="hero-title" className="lp-display lp-hero__title">
          <motion.span
            className="lp-hero__line lp-hero__line--air"
            initial={{ opacity: 0, filter: "blur(16px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            transition={{ duration: 1.8, ease: EASE }}
          >
            The air is invisible.
          </motion.span>
          <span className="lp-hero__mask">
            <motion.span
              className="lp-hero__line lp-hero__line--impact"
              initial={{ y: "105%" }}
              animate={{ y: 0 }}
              transition={{ duration: 1.1, delay: 0.9, ease: EASE }}
            >
              Its impact isn&rsquo;t.
            </motion.span>
          </span>
        </h1>

        <motion.div
          className="lp-hero__foot"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 1.5, ease: EASE }}
        >
          <p className="lp-lede">
            Explore Delhi&rsquo;s air pollution through a living 3D city. Understand your exposure, discover pollution hotspots
            and make more informed decisions about the way you move.
          </p>
          <div className="lp-hero__ctas">
            <SimulationLink className="lp-btn lp-btn--primary">
              Explore the city <ArrowRight size={18} aria-hidden />
            </SimulationLink>
            <a href="#overview" className="lp-btn lp-btn--ghost">
              Discover AEROSCOPE <ArrowDown size={18} aria-hidden />
            </a>
          </div>
        </motion.div>
      </motion.div>

      <motion.div
        className="lp-container lp-hero__readout"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 2 }}
      >
        <AqiReadout />
      </motion.div>
    </section>
  );
}

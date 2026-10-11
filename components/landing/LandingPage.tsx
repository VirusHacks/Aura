"use client";

import { MotionConfig } from "motion/react";
import { AirDataProvider } from "./AirData";
import { Closing, Footer } from "./Closing";
import { ConnectedWorld } from "./ConnectedWorld";
import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import { ProblemSection } from "./ProblemSection";
import { SimulationTransition } from "./SimulationLink";
import { SiteNav } from "./SiteNav";
import "./landing.css";

export function LandingPage() {
  return (
    <MotionConfig reducedMotion="user">
      <AirDataProvider>
        <SimulationTransition>
          <div className="lp">
            <a href="#main" className="lp-skip">
              Skip to content
            </a>
            <SiteNav />
            <main id="main">
              <Hero />
              <ProblemSection />
              <HowItWorks />
              <ConnectedWorld />
              <Closing />
            </main>
            <Footer />
          </div>
        </SimulationTransition>
      </AirDataProvider>
    </MotionConfig>
  );
}

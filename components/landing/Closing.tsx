import Image from "next/image";
import { ArrowRight } from "lucide-react";
import cityShot from "@/public/landing/simulation-city.jpg";
import { Reveal } from "./Reveal";
import { NAV_LINKS, Wordmark } from "./SiteNav";
import { SimulationLink } from "./SimulationLink";

export function Closing() {
  return (
    <section id="impact" data-section="impact" className="lp-section" aria-labelledby="close-title">
      <div className="lp-container">
        <Reveal>
          <h2 id="close-title" className="lp-display lp-close__title">
            A better understanding of the air starts here.
          </h2>
        </Reveal>

        <Reveal delay={0.1}>
          <SimulationLink className="lp-preview" aria-label="Enter the simulation">
            <Image
              src={cityShot}
              alt="The full AEROSCOPE simulation of Delhi, from the Yamuna to the industrial west, with landmarks, metro and traffic"
              fill
              sizes="(min-width: 1360px) 1264px, 100vw"
              placeholder="blur"
            />
            <span className="lp-preview__cta lp-btn lp-btn--primary" aria-hidden>
              Enter the simulation <ArrowRight size={18} />
            </span>
          </SimulationLink>
        </Reveal>

        <div className="lp-close__grid">
          <Reveal>
            <p className="lp-lede" style={{ maxWidth: "44ch" }}>
              AEROSCOPE turns a single city-wide number into a map you can walk through. It shows where Delhi&rsquo;s air is
              worse and why, warns you on your wrist before you walk into it, and helps you find a cleaner way across the city.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="lp-body">
              Today it runs on a clearly labelled, deterministic demo dataset and a transparent scenario model, not a forecast.
              The same pipeline accepts verified monitoring data when it is connected, and labels it as such.
            </p>
            <SimulationLink className="lp-btn lp-btn--primary" style={{ marginTop: 28 }}>
              Enter the simulation <ArrowRight size={18} aria-hidden />
            </SimulationLink>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="lp-footer__grid">
          <div>
            <Wordmark />
            <p className="lp-note" style={{ marginTop: 12, maxWidth: "36ch" }}>
              Delhi Air Intelligence. An interactive 3D digital twin for understanding urban air pollution.
            </p>
          </div>
          <nav aria-label="Footer" className="lp-footer__nav">
            {NAV_LINKS.map((l) => (
              <a key={l.id} href={`#${l.id}`}>
                {l.label}
              </a>
            ))}
            <SimulationLink>Simulation</SimulationLink>
          </nav>
          <div className="lp-note" style={{ display: "grid", gap: 10 }}>
            <p>
              Built with Next.js, React Three Fiber, Three.js and Motion. Backend on AWS API Gateway, Lambda and DynamoDB.
              Watch and iPhone apps in SwiftUI.
            </p>
            <p>
              Demo data: deterministic, illustrative values for a simulated winter afternoon, not official readings. AQI bands
              follow India&rsquo;s National Air Quality Index (CPCB). Stylised geography, not to scale.
            </p>
          </div>
        </div>
        <div className="lp-footer__base lp-note">
          <span>AEROSCOPE</span>
          <a href="#top">Back to top</a>
        </div>
      </div>
    </footer>
  );
}

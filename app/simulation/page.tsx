import type { Metadata, Viewport } from "next";
import AeroscopeApp from "@/components/AeroscopeApp";

export const metadata: Metadata = {
  title: "Simulation — AEROSCOPE",
  description:
    "Explore a stylised 3D digital twin of Delhi visualising air quality across neighbourhoods. Runs on a clearly labelled deterministic demo dataset.",
};

// The city handles pinch and drag itself, so page zoom stays off here only.
export const viewport: Viewport = {
  maximumScale: 1,
  themeColor: "#e8e3d8",
};

export default function SimulationPage() {
  return (
    <>
      <h1 className="sr-only">AEROSCOPE — Delhi Air Intelligence: a stylised 3D digital twin of Delhi showing simulated air quality from demo data</h1>
      <AeroscopeApp />
    </>
  );
}

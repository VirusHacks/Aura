"use client";

import { useEffect, useState } from "react";
import { useSimStore } from "@/store/simulation-store";
import { Logo } from "./TopNavigation";

const STEPS = ["Laying out roads and the Yamuna", "Raising buildings and landmarks", "Loading demo air-quality zones", "Starting traffic and metro"];

export function LoadingScreen() {
  const ready = useSimStore((s) => s.sceneReady);
  const [gone, setGone] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (ready) {
      const t = setTimeout(() => setGone(true), 700);
      return () => clearTimeout(t);
    }
    const id = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 650);
    return () => clearInterval(id);
  }, [ready]);
  if (gone) return null;
  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[80] grid place-items-center transition-opacity duration-700"
      style={{ opacity: ready ? 0 : 1, background: "radial-gradient(120% 90% at 50% 0%, #f2f3f1 0%, #e9e5dc 55%, #ddd5c6 100%)" }}
      aria-busy={!ready}
      aria-live="polite"
    >
      <div className="flex w-[280px] flex-col items-center gap-6 text-center">
        <Logo />
        <div className="w-full">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-black/[0.06]">
            <div className="h-full rounded-full bg-[#0e7490] transition-[width] duration-500" style={{ width: `${ready ? 100 : 18 + step * 22}%` }} />
          </div>
          <p className="mt-3 text-[12px] text-[#5b6472]">{ready ? "City ready" : STEPS[step]}…</p>
          <p className="mt-1 text-[10.5px] text-[#8a919b]">Stylised simulation · demo data</p>
        </div>
      </div>
    </div>
  );
}

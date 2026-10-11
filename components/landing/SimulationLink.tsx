"use client";

import { createContext, use, useEffect, useRef, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/routes";

const VeilContext = createContext<((e: MouseEvent<HTMLAnchorElement>) => void) | null>(null);

/**
 * Page transition into the simulation: a veil in the simulation's loading
 * colour fades over the landing page, then the route changes underneath it.
 */
export function SimulationTransition({ children }: { children: ReactNode }) {
  const veil = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Next.js keeps this page mounted while hidden; clear the veil when it shows again.
  useEffect(() => {
    const el = veil.current;
    if (el) el.style.opacity = "0";
    router.prefetch(ROUTES.simulation);
  }, [router]);

  const enter = (e: MouseEvent<HTMLAnchorElement>) => {
    // Let the browser handle new-tab and download clicks.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const el = veil.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    e.preventDefault();
    const fade = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)", fill: "forwards" });
    fade.onfinish = () => {
      el.style.opacity = "1";
      fade.cancel();
      router.push(ROUTES.simulation);
    };
  };

  return (
    <VeilContext value={enter}>
      {children}
      <div ref={veil} className="lp-veil" aria-hidden />
    </VeilContext>
  );
}

/** A link to the full-screen simulation that plays the hand-off transition. */
export function SimulationLink({ onClick, ...props }: Omit<ComponentProps<typeof Link>, "href">) {
  const enter = use(VeilContext);
  return (
    <Link
      {...props}
      href={ROUTES.simulation}
      onClick={(e) => {
        onClick?.(e);
        enter?.(e);
      }}
    />
  );
}

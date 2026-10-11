"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SimulationLink } from "./SimulationLink";

export const NAV_LINKS = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How it works" },
  { id: "technology", label: "Technology" },
  { id: "impact", label: "Impact" },
] as const;

export function Wordmark() {
  return (
    <span className="lp-wordmark">
      <svg width="22" height="22" viewBox="0 0 26 26" aria-hidden>
        <circle cx="13" cy="13" r="11.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M5 15.5c2.4-2.6 4.6-2.6 7 0s4.6 2.6 7 0" fill="none" stroke="var(--cyan)" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M7 10.5c2-2 4-2 6 0s4 2 6 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
      </svg>
      AEROSCOPE
    </span>
  );
}

/** Which section is under the nav bar, and whether that section is dark. */
function useSectionState() {
  const [active, setActive] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => {
      setScrolled(window.scrollY > 24);
      // Probe just below the bar: whatever section sits there sets the state.
      const probe = 72;
      let current: string | null = null;
      let tone = false;
      document.querySelectorAll<HTMLElement>("[data-section]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top <= probe && r.bottom > probe) {
          current = el.dataset.section ?? null;
          tone = el.dataset.tone === "dark";
        }
      });
      setActive(current);
      setDark(tone);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return { active, dark, scrolled };
}

export function SiteNav() {
  const { active, dark, scrolled } = useSectionState();
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const toggle = toggleRef.current;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    firstLinkRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key !== "Tab" || !menuRef.current) return;
      // Keep focus inside the open menu.
      const items = menuRef.current.querySelectorAll<HTMLElement>("a[href], button");
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      toggle?.focus();
    };
  }, [open]);

  return (
    <>
      <header className="lp-nav" data-scrolled={scrolled || undefined} data-tone={dark ? "dark" : "light"}>
        <nav aria-label="Main" className="lp-container lp-nav__inner">
          <a href="#top" aria-label="AEROSCOPE, back to top">
            <Wordmark />
          </a>
          <div className="lp-nav__links">
            {NAV_LINKS.map((l) => (
              <a key={l.id} href={`#${l.id}`} className="lp-nav__link" aria-current={active === l.id ? "true" : undefined}>
                {l.label}
              </a>
            ))}
          </div>
          <SimulationLink className="lp-btn lp-btn--primary lp-btn--sm lp-nav__cta">
            Explore simulation
          </SimulationLink>
          <button
            ref={toggleRef}
            type="button"
            className="lp-nav__toggle"
            aria-expanded={open}
            aria-controls="lp-menu"
            onClick={() => setOpen(true)}
          >
            Menu <Menu size={20} aria-hidden />
          </button>
        </nav>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            id="lp-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="lp-menu"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <div className="lp-nav__inner">
              <Wordmark />
              <button type="button" className="lp-nav__toggle" onClick={() => setOpen(false)}>
                Close <X size={20} aria-hidden />
              </button>
            </div>
            <div className="lp-menu__links">
              {NAV_LINKS.map((l, i) => (
                <a key={l.id} ref={i === 0 ? firstLinkRef : undefined} href={`#${l.id}`} className="lp-menu__link" onClick={() => setOpen(false)}>
                  {l.label}
                </a>
              ))}
            </div>
            <SimulationLink className="lp-btn lp-btn--primary" style={{ marginTop: "auto" }} onClick={() => setOpen(false)}>
              Explore simulation <ArrowRight size={18} aria-hidden />
            </SimulationLink>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

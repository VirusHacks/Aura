"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Close only this layer; don't let the global handler also deselect.
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return ref;
}

export function Popover({
  trigger,
  children,
  align = "left",
  width = 280,
  label,
  className = "aq-btn",
  title,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right" | "center";
  width?: number;
  label: string;
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(open, close);
  const id = useId();
  const pos = align === "right" ? "right-0" : align === "center" ? "left-1/2 -translate-x-1/2" : "left-0";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={title ?? label}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={label}
          className={`aq-panel-strong aq-rise absolute top-[calc(100%+8px)] z-50 p-1.5 ${pos}`}
          style={{ width: `min(${width}px, calc(100vw - 24px))` }}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

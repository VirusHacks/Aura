"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Factory, Landmark, MapPin, Search, Wind, X } from "lucide-react";
import { CITY_REGIONS } from "@/data/city-regions";
import { LANDMARKS } from "@/data/landmarks";
import { REGION_LABEL, SOURCE_LABEL } from "@/lib/formatting";
import { useSimStore } from "@/store/simulation-store";
import { AqiValue } from "../ui/Aqi";
import { useDismiss } from "../ui/Popover";
import { flyToRegion, selectLandmark, selectSource, selectZone } from "./actions";

type Kind = "zone" | "landmark" | "region" | "source";
interface Item {
  kind: Kind;
  id: string;
  title: string;
  sub: string;
  aqi?: number;
  haystack: string;
}

const KIND_ICON = { zone: Wind, landmark: Landmark, region: MapPin, source: Factory } as const;
const KIND_ORDER: Record<Kind, number> = { zone: 0, landmark: 1, region: 2, source: 3 };
const KIND_LABEL: Record<Kind, string> = { zone: "Zones", landmark: "Landmarks", region: "Regions", source: "Sources" };

export function SearchBox({ autoFocus = false, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const readings = useSimStore((s) => s.readings);
  const sources = useSimStore((s) => s.sources);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const ref = useDismiss(open, () => setOpen(false));

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), 120);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // "/" focuses search from anywhere (except while typing elsewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "/" || (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA"))) return;
      if (!inputRef.current || inputRef.current.offsetParent === null) return;
      e.preventDefault();
      inputRef.current.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const index = useMemo<Item[]>(
    () => [
      ...readings.map((z) => ({
        kind: "zone" as const,
        id: z.id,
        title: z.name,
        sub: `${REGION_LABEL[z.region]} · ${z.category}`,
        aqi: z.aqi,
        haystack: `${z.name} ${REGION_LABEL[z.region]} zone`.toLowerCase(),
      })),
      ...LANDMARKS.map((l) => ({
        kind: "landmark" as const,
        id: l.id,
        title: l.name,
        sub: REGION_LABEL[l.region],
        aqi: readings.find((r) => r.id === l.zoneId)?.aqi,
        haystack: `${l.name} ${l.kind} ${REGION_LABEL[l.region]} ${l.description}`.toLowerCase(),
      })),
      ...CITY_REGIONS.map((r) => ({
        kind: "region" as const,
        id: r.id,
        title: r.name,
        sub: "Region",
        haystack: `${r.name} ${r.short} region`.toLowerCase(),
      })),
      ...sources.map((s) => ({
        kind: "source" as const,
        id: s.id,
        title: s.name,
        sub: SOURCE_LABEL[s.category],
        haystack: `${s.name} ${SOURCE_LABEL[s.category]} source`.toLowerCase(),
      })),
    ],
    [readings, sources],
  );

  const results = useMemo(() => {
    if (!debounced) return [];
    const terms = debounced.split(/\s+/);
    return index
      .map((item) => {
        if (!terms.every((t) => item.haystack.includes(t))) return null;
        const score = KIND_ORDER[item.kind] * 10 + (item.title.toLowerCase().startsWith(terms[0]) ? 0 : 1);
        return { item, score };
      })
      .filter((x): x is { item: Item; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 9)
      .map((x) => x.item);
  }, [debounced, index]);

  const choose = (item: Item) => {
    if (item.kind === "zone") selectZone(item.id);
    else if (item.kind === "landmark") selectLandmark(item.id);
    else if (item.kind === "region") flyToRegion(item.id as Parameters<typeof flyToRegion>[0]);
    else selectSource(item.id);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
    onDone?.();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && results[active]) {
      choose(results[active]);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={ref} className="relative w-full">
      <label className="flex h-8 items-center gap-2 rounded-[9px] border border-[var(--line)] bg-[var(--hover)] px-2.5 transition focus-within:border-[var(--accent-ring)] focus-within:bg-[var(--panel-strong)]">
        <Search size={14} className="shrink-0 text-[var(--muted)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="Search zones, landmarks, regions…"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--ink)] outline-none placeholder:text-[var(--faint)]"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="aq-search-results"
          aria-autocomplete="list"
          aria-label="Search the city"
        />
        {query ? (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-[var(--muted)] hover:text-[var(--ink)]">
            <X size={13} />
          </button>
        ) : (
          <kbd className="hidden rounded border border-[var(--line)] px-1 text-[10px] text-[var(--faint)] lg:inline">/</kbd>
        )}
      </label>
      {open && debounced && (
        <div id="aq-search-results" role="listbox" className="aq-panel-strong aq-rise absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[60vh] overflow-auto p-1.5 aq-scroll">
          {results.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-[var(--muted)]">No zones or landmarks match “{query}”.</div>}
          {results.map((item, i) => {
            const Icon = KIND_ICON[item.kind];
            const header = i === 0 || results[i - 1].kind !== item.kind ? KIND_LABEL[item.kind] : null;
            return (
              <div key={`${item.kind}-${item.id}`}>
                {header && <div className="aq-eyebrow px-2.5 pb-1 pt-2">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  className="aq-row"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(item)}
                >
                  <Icon size={14} className="shrink-0 text-[var(--muted)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.title}</span>
                    <span className="block truncate text-[11px] text-[var(--muted)]">{item.sub}</span>
                  </span>
                  {item.aqi !== undefined && <AqiValue aqi={item.aqi} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

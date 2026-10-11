import { AQI_BANDS, AQI_MAX, getAqiBand } from "@/lib/aqi";

/** Category badge: always value + text, never colour alone. */
export function AqiBadge({ aqi, compact = false }: { aqi: number; compact?: boolean }) {
  const band = getAqiBand(aqi);
  return (
    <span className="aq-badge" style={{ background: band.color, color: band.ink }}>
      {compact ? band.short : band.category}
    </span>
  );
}

export function AqiValue({ aqi }: { aqi: number }) {
  const band = getAqiBand(aqi);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-[3px]" style={{ background: band.color }} aria-hidden />
      <span className="aq-num font-semibold text-[var(--ink)]">{aqi}</span>
    </span>
  );
}

/** Circular gauge: arc length = AQI / 500, colour = band. */
export function AqiGauge({ aqi, size = 104 }: { aqi: number; size?: number }) {
  const band = getAqiBand(aqi);
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sweep = 0.75; // 270° arc
  const frac = Math.min(1, aqi / AQI_MAX);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rotate-[135deg]" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={stroke} strokeDasharray={`${c * sweep} ${c}`} strokeLinecap="round" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={band.color}
          strokeWidth={stroke}
          strokeDasharray={`${c * sweep * frac} ${c}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s cubic-bezier(0.2,0.7,0.2,1), stroke 0.4s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[34px] font-semibold leading-none tracking-tight text-[var(--ink)]">{aqi}</span>
        <span className="mt-1 text-[9.5px] font-semibold tracking-[0.12em] text-[var(--muted)]">AQI</span>
      </div>
    </div>
  );
}

/** Horizontal severity scale with a marker at the current value. */
export function AqiScale({ aqi }: { aqi: number }) {
  const pos = Math.min(1, aqi / AQI_MAX) * 100;
  return (
    <div className="w-full">
      <div className="relative flex h-1.5 gap-[2px]">
        {AQI_BANDS.map((b) => (
          <div key={b.category} className="h-full flex-1 first:rounded-l-full last:rounded-r-full" style={{ background: b.color, opacity: 0.85 }} />
        ))}
        <div
          className="absolute -top-[4px] h-3.5 w-[3px] -translate-x-1/2 rounded-full bg-[var(--ink)] ring-2 ring-[var(--panel-solid)]"
          style={{ left: `${pos}%`, transition: "left 0.6s cubic-bezier(0.2,0.7,0.2,1)" }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[9.5px] text-[var(--faint)] aq-num">
        {[0, 100, 200, 300, 400, 500].map((v) => (
          <span key={v}>{v}</span>
        ))}
      </div>
    </div>
  );
}

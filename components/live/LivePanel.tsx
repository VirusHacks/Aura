"use client";

import { useState } from "react";
import { Footprints, LogOut, MapPin, Navigation, Pause, Play, Radio, Square, Watch, Wind, X } from "lucide-react";
import { getAqiBand } from "@/lib/aqi";
import { motion } from "@/lib/live/motion";
import { useLiveStore } from "@/store/live-store";
import { useSelectedZoneId, useSimStore } from "@/store/simulation-store";
import type { RouteAlternative } from "@/types/api";

const DEFAULT_START = "z-cc"; // Chandni Chowk
const DEFAULT_DESTINATION = "z-ig"; // India Gate: the walk crosses NDLS and Connaught Place

function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min ${Math.round(s % 60)} s`;
}

export function LinkBadge() {
  const link = useLiveStore((s) => s.link);
  const detail = useLiveStore((s) => s.linkDetail);
  const mode = useLiveStore((s) => s.config?.mode);
  const label = link === "live" ? (mode === "dev" ? "LIVE · local" : "LIVE") : link === "connecting" ? "Connecting" : link === "reconnecting" ? "Reconnecting" : link === "polling" ? "Polling" : "Offline";
  const tone = link === "live" ? "#2f9e44" : link === "off" ? "#9aa5b1" : "#f08c00";
  return (
    <span className="aq-badge" title={detail ?? (link === "live" ? "Real-time updates via AWS AppSync Events" : "Updating over HTTP every few seconds")}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${link === "live" ? "aq-pulse" : ""}`} style={{ background: tone }} />
      {label}
    </span>
  );
}

/** Top-bar button: opens the live panel; the dot shows the real-time link. */
export function LiveButton() {
  const open = useLiveStore((s) => s.panelOpen);
  const setOpen = useLiveStore((s) => s.setPanelOpen);
  const status = useLiveStore((s) => s.authStatus);
  const link = useLiveStore((s) => s.link);
  const mode = useLiveStore((s) => s.config?.mode);
  if (mode === "off") return null;
  return (
    <button type="button" className={`aq-btn${open ? " is-active" : ""}`} aria-expanded={open} aria-label="Live watch link" onClick={() => setOpen(!open)}>
      <Watch size={14} />
      <span className="hidden lg:inline">{status === "signed-in" ? "Live" : "Sign in"}</span>
      {status === "signed-in" && <span className={`h-1.5 w-1.5 rounded-full ${link === "live" ? "aq-pulse" : ""}`} style={{ background: link === "live" ? "#2f9e44" : "#f08c00" }} />}
    </button>
  );
}

function SignInForm() {
  const signIn = useLiveStore((s) => s.signIn);
  const busy = useLiveStore((s) => s.busy);
  const error = useLiveStore((s) => s.error);
  const mode = useLiveStore((s) => s.config?.mode);
  const [view, setView] = useState<"sign-in" | "sign-up" | "confirm">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const call = async (action: string, body: object) => {
    setLocalError(null);
    const res = await fetch(`/api/auth/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "Something went wrong");
    return json;
  };

  return (
    <form
      className="space-y-2 p-2.5"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          if (view === "sign-in") await signIn(email, password);
          else if (view === "sign-up") {
            await call("sign-up", { email, password });
            setView("confirm");
            setNote(`We emailed a 6-digit code to ${email}.`);
          } else {
            await call("confirm", { email, code });
            setNote("Email confirmed — signing you in…");
            await signIn(email, password);
          }
        } catch (err) {
          setLocalError((err as Error).message);
        }
      }}
    >
      <p className="aq-eyebrow">{view === "sign-up" ? "Create account" : view === "confirm" ? "Confirm email" : "Sign in to link your watch"}</p>
      <p className="text-[11.5px] leading-snug text-[var(--muted)]">
        Use the same account on the dashboard and the AEROSCOPE watch. {mode === "dev" && "Local dev server: any email works, no password check."}
      </p>
      <input className="aq-input" type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      {view !== "confirm" && (
        <input className="aq-input" type="password" autoComplete={view === "sign-up" ? "new-password" : "current-password"} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required={mode !== "dev"} minLength={mode === "dev" ? 0 : 10} />
      )}
      {view === "confirm" && <input className="aq-input" inputMode="numeric" placeholder="Code from the email" value={code} onChange={(e) => setCode(e.target.value)} required />}
      {note && <p className="text-[11.5px] text-[var(--accent)]">{note}</p>}
      {(localError || error) && <p className="text-[11.5px] text-[#e03131]" role="alert">{localError ?? error}</p>}
      <button type="submit" className="aq-btn is-active w-full justify-center" disabled={busy !== null}>
        {busy ?? (view === "sign-in" ? "Sign in" : view === "sign-up" ? "Create account" : "Confirm")}
      </button>
      <div className="flex justify-between text-[11.5px]">
        {view === "sign-in" ? (
          <button type="button" className="text-[var(--accent)] underline" onClick={() => setView("sign-up")}>
            Create an account
          </button>
        ) : (
          <button type="button" className="text-[var(--accent)] underline" onClick={() => setView("sign-in")}>
            Back to sign in
          </button>
        )}
        {view === "confirm" && (
          <button type="button" className="text-[var(--muted)] underline" onClick={() => void call("resend", { email }).then(() => setNote("New code sent."), (e: Error) => setLocalError(e.message))}>
            Resend code
          </button>
        )}
      </div>
    </form>
  );
}

function PairWatch() {
  const pairWatch = useLiveStore((s) => s.pairWatch);
  const busy = useLiveStore((s) => s.busy);
  const [code, setCode] = useState("");
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-1.5">
      <p className="aq-eyebrow">Pair Apple Watch</p>
      {done ? (
        <p className="text-[11.5px] text-[#2f9e44]">Paired — the watch signs in within a few seconds.</p>
      ) : (
        <form
          className="flex gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await pairWatch(code)) {
              setDone(true);
              setCode("");
            }
          }}
        >
          <input
            className="aq-input aq-num flex-1 uppercase tracking-[0.3em]"
            placeholder="CODE"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            aria-label="Code shown on the watch"
          />
          <button className="aq-btn" type="submit" disabled={busy !== null || code.replace(/[-\s]/g, "").length !== 6}>
            Pair
          </button>
        </form>
      )}
      <p className="text-[10.5px] leading-snug text-[var(--faint)]">On the watch: Settings → Sign in. Type the 6-character code it shows.</p>
    </div>
  );
}

function StartTrip() {
  const startTripAt = useLiveStore((s) => s.startTripAt);
  const busy = useLiveStore((s) => s.busy);
  const readings = useSimStore((s) => s.readings);
  const selected = useSelectedZoneId();
  const [start, setStart] = useState<string>(selected ?? DEFAULT_START);
  const [destination, setDestination] = useState<string>(DEFAULT_DESTINATION);
  const zones = [...readings].sort((a, b) => a.name.localeCompare(b.name));
  const startZone = readings.find((r) => r.id === (selected ?? start)) ?? readings.find((r) => r.id === start);
  return (
    <div className="space-y-1.5">
      <p className="aq-eyebrow">Start a live trip</p>
      <label className="flex items-center gap-2 text-[12px]">
        <MapPin size={13} className="text-[var(--muted)]" />
        <span className="w-[62px] text-[var(--muted)]">Start at</span>
        <select className="aq-input flex-1" value={selected ?? start} onChange={(e) => setStart(e.target.value)}>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name} · AQI {z.aqi}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-[12px]">
        <Navigation size={13} className="text-[var(--muted)]" />
        <span className="w-[62px] text-[var(--muted)]">Heading to</span>
        <select className="aq-input flex-1" value={destination} onChange={(e) => setDestination(e.target.value)}>
          <option value="">No destination</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="aq-btn is-active w-full justify-center"
        disabled={busy !== null || !startZone}
        onClick={() => startZone && void startTripAt(startZone.id, startZone.position, destination || null)}
      >
        <Footprints size={14} /> {busy ?? `Start at ${startZone?.name ?? "…"}`}
      </button>
      <p className="text-[10.5px] leading-snug text-[var(--faint)]">Or start on the watch — the dashboard picks the trip up automatically.</p>
    </div>
  );
}

function AlertRules() {
  const prefs = useLiveStore((s) => s.prefs);
  const update = useLiveStore((s) => s.updatePrefs);
  if (!prefs) return null;
  return (
    <div className="space-y-1.5">
      <p className="aq-eyebrow">Alert rules (shared with the watch)</p>
      <div className="grid grid-cols-2 gap-1.5 text-[11.5px]">
        <label className="space-y-0.5">
          <span className="text-[var(--muted)]">Alert from</span>
          <select className="aq-input w-full" value={prefs.threshold} onChange={(e) => void update({ threshold: e.target.value as typeof prefs.threshold })}>
            {["Moderate", "Poor", "Very Poor", "Severe"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="space-y-0.5">
          <span className="text-[var(--muted)]">Cooldown</span>
          <select className="aq-input w-full" value={prefs.cooldownMinutes} onChange={(e) => void update({ cooldownMinutes: Number(e.target.value) })}>
            {[0, 1, 2, 5, 15, 30].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "Off · every zone" : `${m} min`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[10.5px] leading-snug text-[var(--faint)]">One alert per zone and category; a worse category always alerts. “Off” alerts in every new zone — best for live demos.</p>
    </div>
  );
}

function RouteRow({ r, label, tone }: { r: RouteAlternative; label: string; tone: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] p-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold">
          <span className="h-2 w-4 rounded-full" style={{ background: tone }} /> {label}
        </span>
        <span className="aq-num text-[12px]">AQI {r.routeAQIScore ?? "—"}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
        {(r.distanceMeters / 1000).toFixed(1)} km · {Math.round(r.estimatedDurationSeconds / 60)} min · {Math.round(r.timeInElevatedAQIZonesSeconds / 60)} min in poor air
        {r.unknownSeconds > 30 ? ` · ${Math.round(r.unknownSeconds / 60)} min unscored` : ""}
      </p>
      <p className="truncate text-[11px] text-[var(--faint)]">{r.zoneSummaries.map((z) => z.zoneName).join(" → ")}</p>
    </div>
  );
}

function RouteChoice() {
  const comparison = useLiveStore((s) => s.comparison);
  const choose = useLiveStore((s) => s.chooseRoute);
  const dismiss = useLiveStore((s) => s.dismissComparison);
  const busy = useLiveStore((s) => s.busy);
  if (!comparison) return null;
  const current = comparison.alternatives.find((a) => a.kind === "planned" || a.kind === "fastest") ?? comparison.alternatives[0];
  const cleaner = comparison.alternatives.find((a) => a.kind === "cleaner");
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="aq-eyebrow">Routes · {comparison.provider === "amazon-location" ? "Amazon Location" : "demo zone graph"}</p>
        <button type="button" className="aq-icon-btn" aria-label="Close route comparison" onClick={dismiss}>
          <X size={13} />
        </button>
      </div>
      {current && <RouteRow r={current} label="Current" tone="#e03131" />}
      {cleaner && <RouteRow r={cleaner} label={`Cleaner · −${comparison.exposureReductionPercent}%`} tone="#2f9e44" />}
      <p className="text-[11px] text-[var(--ink-2)]">{comparison.note}</p>
      <div className="flex gap-1.5">
        {cleaner && (
          <button type="button" className="aq-btn is-active flex-1 justify-center" disabled={busy !== null} onClick={() => void choose(cleaner, "alternative")}>
            Take cleaner route
          </button>
        )}
        {current && (
          <button type="button" className="aq-btn flex-1 justify-center" disabled={busy !== null} onClick={() => void choose(current, "current")}>
            Keep route
          </button>
        )}
      </div>
      <p className="text-[10px] leading-snug text-[var(--faint)]" title={comparison.methodology}>
        Score = time-weighted scenario AQI along the route. Not a clinical exposure estimate.
      </p>
    </div>
  );
}

function TripCard() {
  const trip = useLiveStore((s) => s.trip)!;
  const here = useLiveStore((s) => s.here);
  const busy = useLiveStore((s) => s.busy);
  const follow = useLiveStore((s) => s.follow);
  const setFollow = useLiveStore((s) => s.setFollow);
  const clickToWalk = useLiveStore((s) => s.clickToWalk);
  const setClickToWalk = useLiveStore((s) => s.setClickToWalk);
  const watchActive = useLiveStore((s) => s.watchActive);
  const { pauseResume, endTrip, requestRoute } = useLiveStore.getState();
  const readings = useSimStore((s) => s.readings);
  const destination = readings.find((r) => r.id === trip.destinationZoneId);
  const band = here ? getAqiBand(here.aqi) : null;

  if (trip.phase === "ended") {
    const s = trip.summary;
    return (
      <div className="space-y-1.5">
        <p className="aq-eyebrow">Trip ended · saved summary</p>
        <div className="grid grid-cols-2 gap-1.5 text-[11.5px]">
          <div>Duration <b className="aq-num block text-[13px]">{fmtDuration(s.durationSeconds)}</b></div>
          <div>Average AQI <b className="aq-num block text-[13px]">{s.averageAqi ?? "—"}</b></div>
          <div>Peak <b className="aq-num block text-[13px]">{s.peakAqi ?? "—"} {s.peakZoneName ? `· ${s.peakZoneName}` : ""}</b></div>
          <div>In poor air <b className="aq-num block text-[13px]">{Math.round(s.secondsAtOrAbovePoor / 60)} min</b></div>
          <div>Alerts <b className="aq-num block text-[13px]">{s.alertCount}</b></div>
          <div>Reroutes <b className="aq-num block text-[13px]">{s.rerouteCount}</b></div>
        </div>
        <p className="text-[11px] text-[var(--muted)]">Zones: {s.zonesVisited.map((z) => readings.find((r) => r.id === z)?.name ?? z).join(" → ")}</p>
        <button type="button" className="aq-btn w-full justify-center" onClick={() => useLiveStore.setState({ trip: null })}>
          New trip
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="aq-eyebrow">{trip.phase === "paused" ? "Trip paused" : "Live trip"}</p>
        <span className="aq-badge">{trip.isDemo ? "SIMULATED POSITION" : "GPS"}</span>
      </div>
      {here && band && (
        <div className="flex items-center gap-2.5 rounded-lg p-2" style={{ background: `${band.color}22` }}>
          <span className="aq-num grid h-11 w-11 place-items-center rounded-lg text-[15px] font-bold" style={{ background: band.color, color: band.ink }}>
            {here.aqi}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{here.zoneName}</span>
            <span className="block text-[11px] text-[var(--muted)]">
              {band.category} · scenario AQI (DEMO data)
            </span>
          </span>
        </div>
      )}
      <p className="text-[11px] text-[var(--muted)]">
        {destination ? `Heading to ${destination.name}` : "No destination"} · {watchActive ? "watch reporting" : "watch: waiting for activity"}
      </p>
      <div className="rounded-lg border border-dashed border-[var(--line)] p-2 text-[11px] leading-snug text-[var(--ink-2)]">
        <b>Walk:</b> W A S D / arrow keys{clickToWalk ? ", or click the city" : ""}. Entering a zone at your alert level buzzes the watch.
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11.5px]">
        <label className="flex items-center gap-1.5">
          <button type="button" className="aq-switch" data-on={follow} aria-pressed={follow} aria-label="Camera follows" onClick={() => setFollow(!follow)} /> Follow
        </label>
        <label className="flex items-center gap-1.5">
          <button type="button" className="aq-switch" data-on={clickToWalk} aria-pressed={clickToWalk} aria-label="Click to walk" onClick={() => setClickToWalk(!clickToWalk)} /> Click to walk
        </label>
        <button type="button" className="aq-btn ml-auto" onClick={() => motion.placed && useSimStore.getState().flyTo({ target: [motion.x, 0, motion.z], distance: 70, polar: 0.95 })}>
          Find me
        </button>
      </div>
      <div className="flex gap-1.5">
        <button type="button" className="aq-btn flex-1 justify-center" disabled={busy !== null || !trip.destinationZoneId} onClick={() => void requestRoute(null)}>
          <Wind size={13} /> Cleaner route
        </button>
        <button type="button" className="aq-btn" disabled={busy !== null} onClick={() => void pauseResume()} aria-label={trip.phase === "active" ? "Pause trip" : "Resume trip"}>
          {trip.phase === "active" ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button type="button" className="aq-btn" disabled={busy !== null} onClick={() => void endTrip()} aria-label="End trip">
          <Square size={13} /> End
        </button>
      </div>
    </div>
  );
}

function RecentAlerts() {
  const alerts = useLiveStore((s) => s.alerts);
  const tripId = useLiveStore((s) => s.trip?.tripId);
  const list = alerts.filter((a) => !tripId || a.tripId === tripId).slice(0, 4);
  if (!list.length) return null;
  return (
    <div className="space-y-1">
      <p className="aq-eyebrow">Alerts this trip</p>
      {list.map((a) => {
        const band = getAqiBand(a.aqi);
        return (
          <div key={a.id} className="flex items-center gap-2 text-[11.5px]">
            <span className="h-5 w-1 rounded-full" style={{ background: band.color }} />
            <span className="min-w-0 flex-1 truncate">
              {a.zoneName} · AQI {a.aqi}
            </span>
            <span className="text-[10px] text-[var(--faint)]">{a.status === "active" ? "on watch" : a.status}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Live link panel: account, watch pairing, trip controls, alerts and routes. */
export function LivePanel() {
  const open = useLiveStore((s) => s.panelOpen);
  const setOpen = useLiveStore((s) => s.setPanelOpen);
  const status = useLiveStore((s) => s.authStatus);
  const session = useLiveStore((s) => s.session);
  const trip = useLiveStore((s) => s.trip);
  const error = useLiveStore((s) => s.error);
  const clearError = useLiveStore((s) => s.clearError);
  const signOut = useLiveStore((s) => s.signOut);
  if (!open) return null;
  return (
    <section className="aq-panel-strong aq-rise aq-scroll pointer-events-auto absolute left-3 right-3 top-[128px] z-30 max-h-[calc(100%-260px)] md:right-auto md:top-[188px] md:w-[340px]" aria-label="Live watch link">
      <header className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <Radio size={14} className="text-[var(--accent)]" />
        <span className="text-[13px] font-semibold">Live · Watch link</span>
        {status === "signed-in" && <LinkBadge />}
        <button type="button" className="aq-icon-btn ml-auto" aria-label="Close live panel" onClick={() => setOpen(false)}>
          <X size={14} />
        </button>
      </header>
      {status !== "signed-in" ? (
        <SignInForm />
      ) : (
        <div className="space-y-3 p-3">
          {error && (
            <button type="button" className="w-full rounded-lg bg-[#e0313118] p-2 text-left text-[11.5px] text-[#c92a2a]" onClick={clearError}>
              {error}
            </button>
          )}
          {trip ? <TripCard /> : <StartTrip />}
          <RouteChoice />
          <RecentAlerts />
          <div className="aq-divider" />
          <PairWatch />
          <AlertRules />
          <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
            <span className="truncate">{session?.email}</span>
            <button type="button" className="flex items-center gap-1 underline" onClick={() => void signOut()}>
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Mirrors the watch: a new alert pops up here at the same moment. */
export function AlertToast() {
  const toast = useLiveStore((s) => s.toast);
  const busy = useLiveStore((s) => s.busy);
  const hasDestination = useLiveStore((s) => Boolean(s.trip?.destinationZoneId));
  const { acknowledge, requestRoute, dismissToast } = useLiveStore.getState();
  if (!toast) return null;
  const band = getAqiBand(toast.aqi);
  const title = toast.kind === "upcoming-zone" ? "Poor air ahead" : toast.kind === "escalation" ? "Air getting worse" : "Poor air here";
  return (
    <div role="alert" className="aq-panel-strong aq-rise pointer-events-auto absolute left-1/2 top-[76px] z-40 w-[min(380px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden">
      <div className="h-1.5" style={{ background: band.color }} />
      <div className="flex gap-3 p-3">
        <span className="aq-num grid h-12 w-12 shrink-0 place-items-center rounded-xl text-[17px] font-bold" style={{ background: band.color, color: band.ink }}>
          {toast.aqi}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold">
            {title} · {toast.zoneName}
          </p>
          <p className="text-[11.5px] leading-snug text-[var(--muted)]">{toast.reason}</p>
          <p className="mt-0.5 text-[10px] text-[var(--faint)]">Sent to your watch · {toast.isDemo ? "DEMO data" : "LIVE"} · {toast.scenarioLabel}</p>
          <div className="mt-2 flex gap-1.5">
            {hasDestination && (
              <button type="button" className="aq-btn is-active" disabled={busy !== null} onClick={() => void requestRoute(toast.id)}>
                <Wind size={13} /> Cleaner route
              </button>
            )}
            <button type="button" className="aq-btn" disabled={busy !== null} onClick={() => void acknowledge(toast.id)}>
              Got it
            </button>
            <button type="button" className="aq-icon-btn ml-auto" aria-label="Hide" onClick={dismissToast}>
              <X size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

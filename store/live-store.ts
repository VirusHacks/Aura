"use client";

/**
 * Live mode: the signed-in user's trip, shared with their Apple Watch.
 * The server is the source of truth; this store mirrors it from HTTP responses,
 * real-time events and (as a fallback) polling. The 3D character's per-frame
 * position lives in lib/live/motion.ts.
 */
import { create } from "zustand";
import { ApiError, LiveApi, type LiveConfig, type Session, auth, loadConfig, newId } from "@/lib/live/client";
import { place, motion } from "@/lib/live/motion";
import { useSimStore } from "@/store/simulation-store";
import type {
  AlertPreferences,
  EventEnvelope,
  OperationResult,
  PollutionAlert,
  RouteAlternative,
  RouteComparison,
  SelectedRoute,
  TripStatusResponse,
} from "@/types/api";

export type AuthStatus = "unknown" | "signed-out" | "signed-in";
export type LinkStatus = "off" | "connecting" | "live" | "reconnecting" | "polling";

export interface Here {
  zoneId: string;
  zoneName: string;
  aqi: number;
  category: string;
  at: string;
}

interface LiveState {
  config: LiveConfig | null;
  authStatus: AuthStatus;
  session: Session | null;
  link: LinkStatus;
  linkDetail: string | null;
  trip: TripStatusResponse | null;
  here: Here | null;
  alerts: PollutionAlert[];
  toast: PollutionAlert | null;
  comparison: RouteComparison | null;
  comparisonFor: string | null;
  prefs: AlertPreferences | null;
  panelOpen: boolean;
  follow: boolean;
  clickToWalk: boolean;
  busy: string | null;
  error: string | null;
  lastSync: number | null;
  /** Watch activity: last position the watch (or its iPhone) reported. */
  watchSeenAt: string | null;
  /** True while the watch reported within the last five minutes (see tickWatch). */
  watchActive: boolean;
  tickWatch(): void;

  init(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  setPanelOpen(v: boolean): void;
  setFollow(v: boolean): void;
  setClickToWalk(v: boolean): void;
  clearError(): void;
  refreshTrip(): Promise<void>;
  startTripAt(zoneId: string, position: [number, number], destinationZoneId: string | null): Promise<void>;
  endTrip(): Promise<void>;
  pauseResume(): Promise<void>;
  reportPosition(x: number, z: number): Promise<void>;
  acknowledge(alertId: string): Promise<void>;
  requestRoute(alertId: string | null): Promise<void>;
  chooseRoute(alt: RouteAlternative, choice: "alternative" | "current"): Promise<void>;
  dismissComparison(): void;
  pairWatch(code: string): Promise<boolean>;
  updatePrefs(change: Partial<AlertPreferences>): Promise<void>;
  applyEvent(e: EventEnvelope): void;
  setLink(link: LinkStatus, detail?: string | null): void;
  dismissToast(): void;
}

let api: LiveApi | null = null;

/**
 * Saves the scenario on screen so the backend evaluates the same AQI the
 * dashboard shows. AWS: through the data API's scenario table; dev server: its stand-in.
 */
export async function syncScenario(): Promise<void> {
  const cfg = useLiveStore.getState().config;
  const { preset, timeIndex } = useSimStore.getState();
  const url = cfg?.mode === "dev" && cfg.apiUrl ? `${cfg.apiUrl}/dev/scenario` : "/api/scenarios";
  await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preset, timeIndex }) }).catch(() => undefined);
}
let refreshing: Promise<Session | null> | null = null;
const seen = new Set<string>();

function remember(id: string) {
  seen.add(id);
  if (seen.size > 500) seen.delete(seen.values().next().value as string);
}

export const useLiveStore = create<LiveState>()((set, get) => {
  const refresh = async (): Promise<Session | null> => {
    refreshing ??= auth
      .refresh()
      .then((s) => {
        set(s ? { session: s, authStatus: "signed-in" } : { session: null, authStatus: "signed-out" });
        return s;
      })
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  };

  const run = async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    set({ busy: label, error: null });
    try {
      return await fn();
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : "Connection problem — try again." });
      return undefined;
    } finally {
      set({ busy: null });
    }
  };

  /** Folds a trip snapshot into the store and moves the character if needed. */
  const takeTrip = (trip: TripStatusResponse | null, opts: { snap?: boolean } = {}) => {
    const prev = get().trip;
    const ev = trip?.lastEvaluation;
    set({
      trip,
      lastSync: Date.now(),
      here: ev ? { zoneId: ev.match.zoneId, zoneName: ev.match.zoneName, aqi: ev.reading.aqi, category: ev.reading.category, at: ev.dataAsOf } : trip ? get().here : null,
      ...(trip?.lastEvaluationSource === "device" && trip.lastEvaluationAt ? { watchSeenAt: trip.lastEvaluationAt } : {}),
    });
    if (trip) mergeAlerts(trip.alerts);
    const w = trip?.currentLocation?.world;
    if (w && trip?.phase !== "ended") {
      const newTrip = !prev || prev.tripId !== trip.tripId;
      if (newTrip || opts.snap || !motion.placed) place(w.x, w.z);
      else if (Math.hypot(w.x - motion.x, w.z - motion.z) > 1 && !motion.keys.size && !motion.target) motion.remote = { x: w.x, z: w.z };
    }
  };

  const mergeAlerts = (incoming: PollutionAlert[]) => {
    const byId = new Map(get().alerts.map((a) => [a.id, a]));
    for (const a of incoming) {
      const old = byId.get(a.id);
      if (!old || (a.updatedAt ?? a.createdAt) >= (old.updatedAt ?? old.createdAt)) byId.set(a.id, a);
    }
    const alerts = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
    const toast = get().toast;
    set({ alerts, toast: toast ? (byId.get(toast.id) ?? toast) : null });
    const t = get().toast;
    if (t && t.status !== "active" && t.status !== "reroute-requested") set({ toast: null });
  };

  const showAlert = (a: PollutionAlert) => {
    mergeAlerts([a]);
    if (a.status === "active" && Date.now() - Date.parse(a.createdAt) < 5 * 60_000) set({ toast: a });
  };

  const handleResult = (r: OperationResult | undefined) => {
    if (!r) return;
    if (r.trip) takeTrip(r.trip);
    else if (r.evaluation) {
      const ev = r.evaluation;
      set({ here: { zoneId: ev.match.zoneId, zoneName: ev.match.zoneName, aqi: ev.reading.aqi, category: ev.reading.category, at: ev.dataAsOf } });
    }
    const alert = r.alert ?? r.evaluation?.alert;
    if (alert) showAlert(alert);
    if (r.routeComparison) set({ comparison: r.routeComparison });
  };

  return {
    config: null,
    authStatus: "unknown",
    session: null,
    link: "off",
    linkDetail: null,
    trip: null,
    here: null,
    alerts: [],
    toast: null,
    comparison: null,
    comparisonFor: null,
    prefs: null,
    panelOpen: false,
    follow: true,
    clickToWalk: true,
    busy: null,
    error: null,
    lastSync: null,
    watchSeenAt: null,
    watchActive: false,

    tickWatch() {
      const at = get().watchSeenAt;
      const active = Boolean(at && Date.now() - Date.parse(at) < 5 * 60_000);
      if (active !== get().watchActive) set({ watchActive: active });
    },

    async init() {
      if (get().config) return;
      let config: LiveConfig;
      try {
        config = await loadConfig();
      } catch {
        config = { mode: "off", apiUrl: null, region: null, realtime: null, routing: null, push: false };
      }
      set({ config });
      if (config.mode === "off" || !config.apiUrl) {
        set({ authStatus: "signed-out" });
        return;
      }
      api = new LiveApi(config.apiUrl, () => get().session, refresh);
      const s = await refresh();
      if (s) await get().refreshTrip();
    },

    async signIn(email, password) {
      const s = await run("Signing in", () => auth.signIn(email, password));
      if (!s) return;
      set({ session: s, authStatus: "signed-in", panelOpen: true });
      await get().refreshTrip();
    },

    async signOut() {
      await auth.signOut();
      set({ session: null, authStatus: "signed-out", trip: null, here: null, alerts: [], toast: null, comparison: null, prefs: null, link: "off" });
      motion.placed = false;
    },

    setPanelOpen: (v) => {
      set({ panelOpen: v });
      // Make room: the live panel and the bottom table share the left side.
      if (v) useSimStore.getState().setBottomOpen(false);
    },
    setFollow: (v) => set({ follow: v }),
    setClickToWalk: (v) => set({ clickToWalk: v }),
    clearError: () => set({ error: null }),
    dismissToast: () => set({ toast: null }),
    dismissComparison: () => set({ comparison: null, comparisonFor: null }),
    setLink: (link, detail = null) => set({ link, linkDetail: detail }),

    async refreshTrip() {
      if (!api || get().authStatus !== "signed-in") return;
      try {
        const [trip, alerts, prefs] = await Promise.all([
          api.get<{ trip: TripStatusResponse | null }>("/v1/trips/active").then((r) => r.trip),
          api.get<{ alerts: PollutionAlert[] }>("/v1/alerts?limit=20"),
          get().prefs ? Promise.resolve(get().prefs) : api.get<AlertPreferences>("/v1/preferences"),
        ]);
        const current = get().trip;
        // Keep showing an ended trip's summary until the user starts another.
        if (trip || !current || current.phase !== "ended") takeTrip(trip);
        mergeAlerts(alerts.alerts);
        set({ prefs });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) set({ authStatus: "signed-out", session: null });
      }
    },

    async startTripAt(zoneId, position, destinationZoneId) {
      if (!api) return;
      const r = await run("Starting trip", async () => {
        // First make the backend use the scenario on screen, so the first alert matches it.
        await syncScenario();
        return api!.post<OperationResult>("/v1/trips", {
          tripId: newId(),
          startedAt: new Date().toISOString(),
          mode: "walk",
          source: "live",
          origin: { zoneId, world: { x: position[0], z: position[1] }, simulated: true },
          destinationZoneId,
        });
      });
      if (r?.trip) {
        takeTrip(r.trip, { snap: true });
        handleResult({ ...r, trip: undefined });
        set({ comparison: null, comparisonFor: null });
      }
    },

    async pauseResume() {
      const trip = get().trip;
      if (!api || !trip || trip.phase === "ended") return;
      const type = trip.phase === "active" ? "pause" : "resume";
      handleResult(await run(type === "pause" ? "Pausing" : "Resuming", () => api!.post<OperationResult>(`/v1/trips/${trip.tripId}/events`, { type, at: new Date().toISOString() })));
    },

    async endTrip() {
      const trip = get().trip;
      if (!api || !trip || trip.phase === "ended") return;
      handleResult(await run("Ending trip", () => api!.post<OperationResult>(`/v1/trips/${trip.tripId}/events`, { type: "end", at: new Date().toISOString() })));
      set({ comparison: null, toast: null });
    },

    async reportPosition(x, z) {
      const trip = get().trip;
      if (!api || !trip || trip.phase !== "active") return;
      try {
        const r = await api.post<OperationResult>(
          `/v1/trips/${trip.tripId}/events`,
          { type: "location", at: new Date().toISOString(), location: { world: { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 }, simulated: true } },
          false,
        );
        handleResult(r);
        set({ lastSync: Date.now(), error: null });
      } catch (err) {
        if (err instanceof ApiError && err.code === "outside-coverage") set({ error: "That's outside the modelled city — walk back toward a zone." });
        else if (err instanceof ApiError && err.status === 409) await get().refreshTrip();
      }
    },

    async acknowledge(alertId) {
      if (!api) return;
      const r = await run("Updating alert", () => api!.post<{ alert: PollutionAlert }>(`/v1/alerts/${alertId}/actions`, { action: "acknowledge", at: new Date().toISOString() }));
      if (r) mergeAlerts([r.alert]);
      if (get().toast?.id === alertId) set({ toast: null });
    },

    async requestRoute(alertId) {
      const trip = get().trip;
      if (!api || !trip) return;
      const from = get().here?.zoneId ?? trip.currentZoneId;
      const to = trip.destinationZoneId;
      if (!from || !to) {
        set({ error: "Start the trip with a destination to compare routes." });
        return;
      }
      const body = { mode: trip.mode, currentZoneId: from, destinationZoneId: to, plannedZoneIds: trip.plannedZoneIds };
      const r = alertId
        ? await run("Finding a cleaner route", () => api!.post<{ alert: PollutionAlert; routeComparison: RouteComparison | null }>(`/v1/alerts/${alertId}/actions`, { action: "request-route", at: new Date().toISOString(), ...body }))
        : await run("Comparing routes", async () => ({ alert: null, routeComparison: await api!.post<RouteComparison>("/v1/routes/compare", { fromZoneId: from, toZoneId: to, mode: trip.mode, plannedZoneIds: trip.plannedZoneIds, tripId: trip.tripId }, false) }));
      if (!r) return;
      if (r.alert) mergeAlerts([r.alert]);
      set({ comparison: r.routeComparison, comparisonFor: alertId, toast: null });
      if (!r.routeComparison) set({ error: "No route found between those zones." });
    },

    async chooseRoute(alt, choice) {
      const trip = get().trip;
      if (!api || !trip) return;
      const r = await run("Saving route", () =>
        api!.post<OperationResult>(`/v1/trips/${trip.tripId}/route`, {
          routeId: alt.routeId,
          choice,
          zoneIds: alt.zoneIds,
          world: alt.world,
          geometry: alt.geometry,
          provider: alt.provider,
          alertId: get().comparisonFor,
          at: new Date().toISOString(),
        }),
      );
      handleResult(r);
      if (r) set({ comparison: null, comparisonFor: null });
    },

    async pairWatch(code) {
      if (!api) return false;
      const r = await run("Pairing watch", () => api!.post<{ paired: boolean }>("/v1/pairing/claim", { code }, false));
      return Boolean(r?.paired);
    },

    async updatePrefs(change) {
      const current = get().prefs;
      if (!api || !current) return;
      const next = { ...current, ...change, updatedAt: new Date().toISOString() };
      set({ prefs: next });
      const saved = await run("Saving settings", () => api!.put<AlertPreferences>("/v1/preferences", next));
      if (saved) set({ prefs: saved });
    },

    applyEvent(e) {
      if (seen.has(e.eventId)) return;
      remember(e.eventId);
      const trip = get().trip;
      const p = e.payload as Record<string, unknown>;
      switch (e.type) {
        case "trip.started":
        case "trip.ended":
          if (p.trip) takeTrip(p.trip as TripStatusResponse, { snap: e.type === "trip.started" });
          break;
        case "trip.location.updated": {
          if (!trip || trip.tripId !== e.tripId) {
            void get().refreshTrip();
            break;
          }
          const world = p.world as { x: number; z: number } | null;
          set({
            here: { zoneId: String(p.zoneId), zoneName: String(p.zoneName), aqi: Number(p.aqi), category: String(p.category), at: String(p.at) },
            trip: { ...trip, currentZoneId: String(p.zoneId), currentLocation: world ? { world, zoneId: String(p.zoneId), simulated: Boolean(p.simulated), at: String(p.at) } : trip.currentLocation },
            ...(p.source === "device" ? { watchSeenAt: String(p.at) } : {}),
          });
          // Moves made here are already on screen; follow everyone else's.
          if (world && p.source !== "dashboard" && !motion.keys.size && !motion.target) motion.remote = { x: world.x, z: world.z };
          break;
        }
        case "trip.paused":
        case "trip.resumed":
          if (trip && trip.tripId === e.tripId) set({ trip: { ...trip, phase: p.phase as TripStatusResponse["phase"], status: p.phase as TripStatusResponse["phase"] } });
          break;
        case "alert.created":
          showAlert(p.alert as PollutionAlert);
          break;
        case "alert.updated":
        case "alert.acknowledged":
          mergeAlerts([p.alert as PollutionAlert]);
          break;
        case "route.alternatives.generated":
          if (!get().comparison) set({ comparison: p.comparison as RouteComparison });
          break;
        case "route.selected":
          if (trip && trip.tripId === e.tripId) {
            set({ trip: { ...trip, selectedRoute: p.selectedRoute as SelectedRoute, selectedRouteId: (p.selectedRoute as SelectedRoute).routeId, plannedZoneIds: p.plannedZoneIds as string[] }, comparison: null });
          }
          break;
        default:
          break;
      }
      set({ lastSync: Date.now() });
    },
  };
});

export const liveIsDriving = () => {
  const s = useLiveStore.getState();
  return s.authStatus === "signed-in" && s.trip?.phase === "active";
};

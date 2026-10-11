"use client";

import { useEffect, useRef } from "react";
import { cameraBridge } from "@/lib/camera-bridge";
import { isMovementKey, motion } from "@/lib/live/motion";
import { type RealtimeConnection, connectAppSync, connectDevStream } from "@/lib/live/realtime";
import { liveIsDriving, syncScenario, useLiveStore } from "@/store/live-store";
import { useSimStore } from "@/store/simulation-store";
import { nearestZone } from "../world/SceneInteraction";

/** How often a moving character is reported (zone changes go out immediately). */
const REPORT_EVERY_MS = 1000;
const POLL_WHEN_OFFLINE_MS = 4000;
const POLL_WHEN_LIVE_MS = 30_000;

/** Non-visual: connects live mode and drives reporting, keyboard and camera follow. */
export function LiveController() {
  const authStatus = useLiveStore((s) => s.authStatus);
  const config = useLiveStore((s) => s.config);
  const sub = useLiveStore((s) => s.session?.sub ?? null);
  const link = useLiveStore((s) => s.link);
  const tripId = useLiveStore((s) => s.trip?.tripId ?? null);
  const phase = useLiveStore((s) => s.trip?.phase ?? null);

  useEffect(() => {
    void useLiveStore.getState().init();
  }, []);

  // Real-time channel for the signed-in user.
  useEffect(() => {
    if (authStatus !== "signed-in" || !config || !sub) return;
    const store = useLiveStore.getState();
    const options = {
      getIdToken: async () => {
        const s = useLiveStore.getState().session;
        return s ? s.idToken : null;
      },
      onEvent: (e: Parameters<typeof store.applyEvent>[0]) => useLiveStore.getState().applyEvent(e),
      onStatus: (status: string, detail?: string) => {
        const set = useLiveStore.getState().setLink;
        if (status === "live") set("live");
        else if (status === "closed") set("polling", detail ?? null);
        else set(status === "connecting" ? "connecting" : "reconnecting", detail ?? null);
        // Catch up on anything missed while disconnected.
        if (status === "live") void useLiveStore.getState().refreshTrip();
      },
    };
    let conn: RealtimeConnection | null = null;
    if (config.mode === "aws" && config.realtime) {
      conn = connectAppSync(config.realtime.httpDomain, config.realtime.realtimeDomain, `/${config.realtime.namespace}/users/${sub}`, options);
    } else if (config.mode === "dev" && config.apiUrl) {
      conn = connectDevStream(config.apiUrl, options);
    } else {
      store.setLink("polling", "Real-time not configured");
    }
    return () => conn?.close();
  }, [authStatus, config, sub]);

  // "Watch active" indicator: re-evaluated every few seconds, not during render.
  useEffect(() => {
    const id = setInterval(() => useLiveStore.getState().tickWatch(), 5000);
    const unsub = useLiveStore.subscribe((s, prev) => {
      if (s.watchSeenAt !== prev.watchSeenAt) s.tickWatch();
    });
    return () => {
      clearInterval(id);
      unsub();
    };
  }, []);

  // HTTP fallback: frequent while real-time is down, occasional as a safety net.
  useEffect(() => {
    if (authStatus !== "signed-in") return;
    const every = link === "live" ? POLL_WHEN_LIVE_MS : POLL_WHEN_OFFLINE_MS;
    const id = setInterval(() => void useLiveStore.getState().refreshTrip(), every);
    return () => clearInterval(id);
  }, [authStatus, link]);

  // Keyboard walking (WASD / arrows) while a trip is active.
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (!isMovementKey(e.code) || typing(e.target) || !liveIsDriving()) return;
      e.preventDefault();
      motion.keys.add(e.code);
    };
    const up = (e: KeyboardEvent) => motion.keys.delete(e.code);
    const blur = () => motion.keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Report the walk: immediately on entering a new zone, otherwise about once a second.
  const last = useRef<{ x: number; z: number; at: number; zoneId: string | null; inFlight: boolean }>({ x: NaN, z: NaN, at: 0, zoneId: null, inFlight: false });
  useEffect(() => {
    if (phase !== "active") return;
    last.current = { x: motion.x, z: motion.z, at: Date.now(), zoneId: useLiveStore.getState().here?.zoneId ?? null, inFlight: false };
    const id = setInterval(() => {
      const l = last.current;
      if (l.inFlight || !motion.placed) return;
      const moved = Math.hypot(motion.x - l.x, motion.z - l.z);
      if (moved < 0.5) return;
      const zone = nearestZone(useSimStore.getState().readings, motion.x, motion.z, false);
      const changed = zone && zone.id !== l.zoneId;
      const stopped = !motion.moving;
      if (!changed && !stopped && Date.now() - l.at < REPORT_EVERY_MS) return;
      l.inFlight = true;
      l.x = motion.x;
      l.z = motion.z;
      l.at = Date.now();
      l.zoneId = zone?.id ?? l.zoneId;
      void useLiveStore
        .getState()
        .reportPosition(motion.x, motion.z)
        .finally(() => {
          l.inFlight = false;
        });
    }, 150);
    return () => clearInterval(id);
  }, [phase, tripId]);

  // Camera follows the character while it moves.
  useEffect(() => {
    if (phase !== "active" && phase !== "paused") return;
    const id = setInterval(() => {
      if (!useLiveStore.getState().follow || !motion.placed) return;
      if (motion.moving || motion.remote) cameraBridge.follow(motion.x, motion.z);
    }, 220);
    return () => clearInterval(id);
  }, [phase]);

  // Keep the backend's scenario in step with the one on screen, so the watch
  // and the dashboard show the same AQI. Saved through the data API (/api/scenarios).
  useEffect(() => {
    if (phase !== "active") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastKey = "";
    const push = () => {
      const { preset, timeIndex } = useSimStore.getState();
      const key = `${preset}:${timeIndex}`;
      if (key === lastKey) return;
      lastKey = key;
      void syncScenario();
    };
    push();
    const unsub = useSimStore.subscribe((s, prev) => {
      if (s.preset === prev.preset && s.timeIndex === prev.timeIndex) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(push, 1200);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [phase, tripId]);

  return null;
}

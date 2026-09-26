"use client";

import { useEffect, useRef, useState } from "react";

import { useAuthStore } from "@/stores/auth-store";

/**
 * Admin realtime (WebSocket `/api/v1/ws`). An optional enhancement: pages must work without it
 * (they also refetch on focus / interval), so every failure just schedules a reconnect.
 */

/** Exponential backoff with full jitter: 1s, 2s, 4s … capped at 30s. `random` is injectable for tests. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

export interface RealtimeMessage {
  event: string;
  data?: Record<string, unknown>;
  at?: string;
}

export function parseMessage(raw: unknown): RealtimeMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && typeof (value as RealtimeMessage).event === "string") return value as RealtimeMessage;
  } catch {
    // ignore malformed frames
  }
  return null;
}

export type RealtimeStatus = "connecting" | "live" | "offline";

interface Options {
  onEvent: (message: RealtimeMessage) => void;
  /** Injectable for tests. */
  createSocket?: (url: string) => WebSocket;
}

export function wsUrl(location: Pick<Location, "protocol" | "host">): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/v1/ws`;
}

/** Keeps a socket open while the user is signed in; reconnects with backoff. */
export function useRealtime({ onEvent, createSocket }: Options): RealtimeStatus {
  const token = useAuthStore((s) => s.accessToken);
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!token || typeof window === "undefined") return;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      try {
        socket = (createSocket ?? ((url: string) => new WebSocket(url)))(wsUrl(window.location));
      } catch {
        schedule();
        return;
      }
      socket.onopen = () => socket?.send(JSON.stringify({ type: "auth", token: useAuthStore.getState().accessToken }));
      socket.onmessage = (event: MessageEvent) => {
        const message = parseMessage(event.data);
        if (!message) return;
        if (message.event === "connected") {
          attempt = 0;
          setStatus("live");
        }
        handler.current(message);
      };
      socket.onclose = () => {
        setStatus("offline");
        schedule();
      };
    };
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(connect, reconnectDelay(attempt));
      attempt += 1;
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [token, createSocket]);

  return token ? status : "offline";
}

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth-store";

import { parseMessage, reconnectDelay, useRealtime, wsUrl } from "./realtime";

describe("reconnectDelay", () => {
  it("grows exponentially with jitter between half and full ceiling, capped at 30s", () => {
    expect(reconnectDelay(0, () => 0)).toBe(500);
    expect(reconnectDelay(0, () => 1)).toBe(1000);
    expect(reconnectDelay(3, () => 0)).toBe(4000);
    expect(reconnectDelay(3, () => 1)).toBe(8000);
    expect(reconnectDelay(20, () => 1)).toBe(30_000);
    expect(reconnectDelay(20, () => 0)).toBe(15_000);
  });
});

describe("parseMessage / wsUrl", () => {
  it("accepts only JSON objects with an event", () => {
    expect(parseMessage('{"event":"sync.applied","data":{"sales":2}}')).toEqual({ event: "sync.applied", data: { sales: 2 } });
    expect(parseMessage("not json")).toBeNull();
    expect(parseMessage('{"no":"event"}')).toBeNull();
    expect(parseMessage(42)).toBeNull();
  });

  it("uses wss on https", () => {
    expect(wsUrl({ protocol: "https:", host: "pos.example.com" })).toBe("wss://pos.example.com/api/v1/ws");
    expect(wsUrl({ protocol: "http:", host: "localhost:3000" })).toBe("ws://localhost:3000/api/v1/ws");
  });
});

class FakeSocket {
  static instances: FakeSocket[] = [];
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
}

describe("useRealtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    useAuthStore.setState({ accessToken: "tok" });
  });
  afterEach(() => {
    vi.useRealTimers();
    useAuthStore.setState({ accessToken: null });
  });

  it("authenticates with the first message, delivers events and reconnects after a drop", () => {
    const events: string[] = [];
    const create = (url: string) => new FakeSocket(url) as unknown as WebSocket;
    const { result, unmount } = renderHook(() => useRealtime({ onEvent: (m) => events.push(m.event), createSocket: create }));

    const first = FakeSocket.instances[0];
    act(() => first.onopen?.());
    expect(JSON.parse(first.sent[0])).toEqual({ type: "auth", token: "tok" });
    act(() => first.onmessage?.({ data: '{"event":"connected"}' } as MessageEvent));
    expect(result.current).toBe("live");
    act(() => first.onmessage?.({ data: '{"event":"sync.applied"}' } as MessageEvent));
    expect(events).toEqual(["connected", "sync.applied"]);

    act(() => first.onclose?.());
    expect(result.current).toBe("offline");
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeSocket.instances).toHaveLength(2);
    unmount();
  });
});

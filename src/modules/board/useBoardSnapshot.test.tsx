import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBoardSnapshot } from "./useBoardSnapshot";

// The wire shape of GET /api/board/clientes: ISO string instant, plain rows.
const FIRST = { generatedAt: "2026-10-26T15:00:00.000Z", rows: [{ plate: "AB1234", make: "Toyota", model: "Hilux", status: "Recibida" }] };
const NEXT = { generatedAt: "2026-10-26T15:00:30.000Z", rows: [{ plate: "CD5678", make: null, model: null, status: "En proceso" }] };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fetchMock = vi.fn();
const assign = vi.fn();
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
  fetchMock.mockReset();
  assign.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { assign });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useBoardSnapshot", () => {
  it("2xx replaces the snapshot and records lastOkAt", async () => {
    fetchMock.mockResolvedValue(json(NEXT));
    const { result } = renderHook(() => useBoardSnapshot("/api/board/clientes", FIRST));
    expect(result.current.snapshot).toEqual(FIRST);

    await tick(30_000);

    expect(result.current.snapshot).toEqual(NEXT);
    expect(result.current.lastOkAt).toBe(Date.parse("2026-10-26T15:00:30Z"));
    expect(result.current.failedAt).toBeNull();
  });

  it("polls every 30 s with cache no-store, and not before", async () => {
    fetchMock.mockImplementation(async () => json(FIRST));
    renderHook(() => useBoardSnapshot("/api/board/clientes", FIRST));

    await tick(29_999);
    expect(fetchMock).not.toHaveBeenCalled();
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/board/clientes", { cache: "no-store" });
    await tick(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never overlaps requests: a slow poll holds the next ticks back", async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (release = r)));
    fetchMock.mockImplementation(async () => json(FIRST));
    renderHook(() => useBoardSnapshot("/api/board/clientes", FIRST));

    await tick(90_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(json(NEXT));
    await tick(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a hidden tab still polls", async () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fetchMock.mockImplementation(async () => json(NEXT));
    const { result } = renderHook(() => useBoardSnapshot("/api/board/clientes", FIRST));

    await tick(30_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.snapshot).toEqual(NEXT);
  });

  it("401 navigates to /login and keeps no further timers", async () => {
    fetchMock.mockResolvedValue(json({ error: "Unauthorized" }, 401));
    renderHook(() => useBoardSnapshot("/api/board/clientes", FIRST));

    await tick(30_000);
    expect(assign).toHaveBeenCalledExactlyOnceWith("/login");
    expect(vi.getTimerCount()).toBe(0);
    await tick(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("403 navigates to / and NOT /login", async () => {
    fetchMock.mockResolvedValue(json({ error: "Forbidden" }, 403));
    renderHook(() => useBoardSnapshot("/api/board/clientes", FIRST));

    await tick(30_000);

    expect(assign).toHaveBeenCalledExactlyOnceWith("/");
    expect(vi.getTimerCount()).toBe(0);
  });

  const FAILURES: [string, () => Promise<Response>][] = [
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a 500", async () => json({ error: "boom" }, 500)],
    ["an HTML 200", async () => new Response("<html><body>login</body></html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["a 200 of the wrong shape", async () => json({ rows: "nope" })],
  ];

  it.each(FAILURES)("Failure keeps the snapshot: %s", async (_name, respond) => {
    fetchMock.mockImplementation(respond);
    const { result } = renderHook(() => useBoardSnapshot("/api/board/clientes", FIRST));

    await tick(30_000);

    expect(result.current.snapshot).toEqual(FIRST);
    expect(result.current.lastOkAt).toBe(Date.parse("2026-10-26T15:00:00Z"));
    expect(result.current.failedAt).toBe(Date.parse("2026-10-26T15:00:30Z"));
    expect(assign).not.toHaveBeenCalled();
  });

  it("Recovery clears the failure and renders the new snapshot", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchMock.mockImplementation(async () => json(NEXT));
    const { result } = renderHook(() => useBoardSnapshot("/api/board/clientes", FIRST));

    await tick(30_000);
    expect(result.current.failedAt).not.toBeNull();
    await tick(30_000);

    expect(result.current.failedAt).toBeNull();
    expect(result.current.snapshot).toEqual(NEXT);
  });

  describe("Stale banner clock", () => {
    it("exposes a live `now` while a failure is current: the banner can reach `hace 1 min` by t+70 s and `hace 2 min` by t+130 s", async () => {
      // Good snapshot lands at t+30.4 s; polls at 60 and 90 s fail, 59.6 s after it.
      fetchMock.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 400));
        return json(NEXT);
      });
      fetchMock.mockImplementation(async () => json({ error: "down" }, 500));
      const { result } = renderHook(() => useBoardSnapshot("/api/board/clientes", FIRST));
      const minutes = () => {
        const { lastOkAt, now } = result.current;
        return now === null ? null : Math.floor((now - lastOkAt) / 60_000);
      };

      await tick(90_000);
      expect(minutes()).toBe(0);
      await tick(11_000); // t+101 s, 70.6 s after the good snapshot
      expect(minutes()).toBe(1);
      await tick(60_000);
      expect(minutes()).toBe(2);
    });

    it("a success clears `now` and leaves no timer behind but the poll", async () => {
      fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      fetchMock.mockImplementation(async () => json(NEXT));
      const { result, unmount } = renderHook(() => useBoardSnapshot("/api/board/clientes", FIRST));

      await tick(30_000);
      expect(result.current.now).not.toBeNull();
      expect(vi.getTimerCount()).toBe(2); // poll + ticker
      await tick(30_000);

      expect(result.current.now).toBeNull();
      expect(vi.getTimerCount()).toBe(1); // poll only
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("unmounting during a failure clears the ticker too", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      const { unmount } = renderHook(() => useBoardSnapshot("/api/board/clientes", FIRST));
      await tick(30_000);
      expect(vi.getTimerCount()).toBe(2);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

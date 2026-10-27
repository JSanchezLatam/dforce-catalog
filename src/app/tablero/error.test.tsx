import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BoardError from "./error";

const reload = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  reload.mockReset();
  vi.stubGlobal("location", { reload });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("tablero error boundary", () => {
  it("says it is retrying and reloads the page after 60 s, not before", () => {
    render(<BoardError />);
    expect(screen.getByText("Sin conexión, reintentando…")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(59_999));
    expect(reload).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload after it is unmounted", () => {
    const { unmount } = render(<BoardError />);
    unmount();
    act(() => vi.advanceTimersByTime(120_000));
    expect(reload).not.toHaveBeenCalled();
  });
});

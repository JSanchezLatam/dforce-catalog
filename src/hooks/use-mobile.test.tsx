import { renderHook } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { useIsMobile } from "./use-mobile";

const original = window.innerWidth;

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.innerWidth = original;
});

function mobileAt(width: number): boolean {
  window.innerWidth = width;
  return renderHook(() => useIsMobile()).result.current;
}

/** Audit #17a: at 768-1023 nothing visible collapsed the sidebar; tablets now get the menu button. */
describe("useIsMobile — breakpoint", () => {
  it("treats 1023px as mobile (a tablet gets the off-canvas sidebar)", () => {
    expect(mobileAt(1023)).toBe(true);
  });

  it("treats 1024px as desktop", () => {
    expect(mobileAt(1024)).toBe(false);
  });

  it("treats a 768px tablet as mobile", () => {
    expect(mobileAt(768)).toBe(true);
  });
});

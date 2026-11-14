import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { patternOf, routeOf, SCREEN_LABELS, screenLabelFor } from "./screen-labels";

const APP_DIR = path.join(process.cwd(), "src/app/(app)");

/** Every `page.tsx` under `(app)`, as the route pattern its folders spell. */
function appPagePatterns(dir = APP_DIR, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return appPagePatterns(path.join(dir, entry.name), `${prefix}/${entry.name}`);
    return entry.name === "page.tsx" ? [prefix || "/"] : [];
  });
}

describe("screenLabelFor", () => {
  it("maps a dynamic route to its label", () => {
    expect(screenLabelFor("/service-orders/abc-123")).toBe("Orden de servicio — Detalle");
  });

  it("maps a static route to its label", () => {
    expect(screenLabelFor("/kanban")).toBe("Órdenes en curso");
  });

  it("picks the deepest pattern, not a prefix", () => {
    expect(screenLabelFor("/service-orders/abc/print")).toBe("Orden de servicio — Hoja impresa");
  });

  it("falls back to the raw route when unmapped", () => {
    expect(screenLabelFor("/nueva-pantalla/9")).toBe("/nueva-pantalla/9");
  });

  it("strips query and fragment before matching and from the fallback", () => {
    expect(screenLabelFor("/service-orders/abc?tab=2#top")).toBe("Orden de servicio — Detalle");
    expect(screenLabelFor("/nueva?x=1")).toBe("/nueva");
    expect(routeOf("/customers/1?q=a#b")).toBe("/customers/1");
  });

  it("ignores a trailing slash", () => {
    expect(screenLabelFor("/customers/")).toBe("Clientes");
  });
});

describe("patternOf", () => {
  it.each([
    ["/service-orders/a?tab=1#x", "/service-orders/[id]"],
    ["/customers/7/vehicles/9", "/customers/[id]/vehicles/[vehicleId]"],
    ["/agenda/", "/agenda"],
    ["/service-orders/a/print", "/service-orders/[id]/print"],
  ])("maps %s to %s", (path, pattern) => {
    expect(patternOf(path)).toBe(pattern);
  });

  it("returns null for a path with no label", () => {
    expect(patternOf("/nope")).toBeNull();
  });
});

describe("completeness", () => {
  it("finds the real pages (guards the walk itself)", () => {
    expect(appPagePatterns().length).toBeGreaterThan(10);
  });

  it("has a label for every (app) page", () => {
    const missing = appPagePatterns().filter((p) => !(p in SCREEN_LABELS));
    expect(missing).toEqual([]);
  });

  it("has no label for a page that no longer exists", () => {
    const pages = new Set(appPagePatterns());
    expect(Object.keys(SCREEN_LABELS).filter((p) => !pages.has(p))).toEqual([]);
  });
});

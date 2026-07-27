import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ACTIONS, type Action } from "./policy";

/**
 * Every route/page in the app that requires any form of authorization (not
 * just a valid session), mapped by URL path to the HTTP methods it handles
 * and the Action it requires.
 */
export const ROUTE_GUARDS: Record<string, Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", Action | "session-only">>> = {
  "/api/login": { GET: "session-only", POST: "session-only" },
  "/api/logout": { POST: "session-only" },
  "/api/customers": { GET: "customers.read", POST: "customers.write" },
  "/api/customers/[id]": { GET: "customers.read", PATCH: "customers.write", DELETE: "customers.write" },
  "/api/service-orders": { GET: "service-orders.read", POST: "service-orders.write" },
  "/api/service-orders/[id]": { GET: "service-orders.read", PATCH: "service-orders.write" },
  "/api/inventory-sync/manual": { GET: "sync.manual", POST: "sync.manual" },
  "/api/template-config": { GET: "template.edit", POST: "template.edit" },
  "/api/workshop-config": { GET: "workshop.read", POST: "workshop.edit" },
  "/api/workshop-config/logo": { GET: "workshop.read", POST: "workshop.edit", DELETE: "workshop.edit" },
  "/api/catalog-builder/products": { POST: "catalogs.read" },
  "/api/catalog-builder/generate": { POST: "catalogs.generate" },
  "/api/catalog-builder/queue-depth": { GET: "catalogs.read" },
  "/api/catalogs/[id]/file": { GET: "catalogs.download" },
  "/customers": { GET: "customers.read" },
  "/customers/[id]": { GET: "customers.read" },
  "/service-orders": { GET: "service-orders.read" },
  "/service-orders/[id]": { GET: "service-orders.read" },
  "/inventory": { GET: "inventory.read" },
  "/inventory/[id]": { GET: "inventory.read" },
  "/catalogs": { GET: "catalogs.read" },
  "/builder": { GET: "catalogs.generate" },
  "/template-config": { GET: "template.edit" },
};

const APP_DIR = path.resolve(import.meta.dirname, "../../app");
const API_DIR = path.join(APP_DIR, "api");
const APP_GROUP_DIR = path.join(APP_DIR, "(app)");

function filePathToUrl(file: string): string {
  let url = file
    .replace(/^src\/app\//, "/")
    .replace(/\/route\.ts$/, "")
    .replace(/\/page\.tsx$/, "")
    .replace(/^\/\(app\)/, "");
  if (url.endsWith("/index")) url = url.slice(0, -6);
  return url || "/";
}

function findRouteFiles(dir: string, suffix: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith(suffix))
    .map((f) => f.replace(/\\/g, "/"));
}

describe("ROUTE_GUARDS completeness", () => {
  it("every existing API route and page has a ROUTE_GUARDS entry", () => {
    const relApiDir = "src/app/api";
    const relAppDir = "src/app/(app)";

    const apiRoutes = findRouteFiles(API_DIR, "/route.ts").map((f) =>
      filePathToUrl(`${relApiDir}/${f}`),
    );
    const pages = findRouteFiles(APP_GROUP_DIR, "/page.tsx").map((f) =>
      filePathToUrl(`${relAppDir}/${f}`),
    );

    const allUrls = [...apiRoutes, ...pages].sort();
    const guardedUrls = Object.keys(ROUTE_GUARDS).sort();

    expect(allUrls).toEqual(guardedUrls);
  });

  it("every Action with a route in v1 is reachable", () => {
    const usedActions = new Set(
      Object.values(ROUTE_GUARDS)
        .flatMap((methods) => Object.values(methods))
        .filter((v): v is Action => v !== "session-only"),
    );

    // Four actions have no route in v1 — they get their own route in later WUs:
    // users.manage (deferred follow-up), workshop.edit (WU3b),
    // catalogs.listAll (no dedicated route), account.self (WU5b).
    const exempt: readonly Action[] = ["users.manage", "catalogs.listAll", "account.self"];

    for (const action of ACTIONS) {
      if ((exempt as readonly string[]).includes(action)) continue;
      expect(usedActions.has(action as Action)).toBe(true);
    }
  });
});

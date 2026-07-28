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
  "/workshop-config": { GET: "workshop.edit" },
  "/account": { GET: "account.self" },
  "/api/account": { GET: "account.self", PATCH: "account.self" },
  "/api/account/password": { POST: "account.self" },
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

/**
 * Maps every registered URL back to the absolute source file that implements
 * it, reusing the same enumeration as the completeness test above.
 */
function buildUrlToFileMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of findRouteFiles(API_DIR, "/route.ts")) {
    map.set(filePathToUrl(`src/app/api/${f}`), path.join(API_DIR, f));
  }
  for (const f of findRouteFiles(APP_GROUP_DIR, "/page.tsx")) {
    map.set(filePathToUrl(`src/app/(app)/${f}`), path.join(APP_GROUP_DIR, f));
  }
  return map;
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
    const exempt: readonly Action[] = ["users.manage", "catalogs.listAll"];

    for (const action of ACTIONS) {
      if ((exempt as readonly string[]).includes(action)) continue;
      expect(usedActions.has(action as Action)).toBe(true);
    }
  });
});

/**
 * design.md Decision 1b's item #2 ("invoke with forged tecnico headers,
 * assert 403 whenever MATRIX.tecnico[action] === false") was never built,
 * and would not have caught C1/C2 of the apply-review anyway: both
 * mis-registered actions here (`catalogs.read`, `catalogs.download`) are
 * `true` for every role today, so a behavioral 403-assertion test would
 * pass regardless of which action string the route actually evaluates.
 *
 * This is the practical replacement design.md 1b explicitly disclaimed as
 * uncatchable ("a registry entry that names the wrong action"): a static
 * source-text cross-reference between the DECLARED action in ROUTE_GUARDS
 * and the action string(s) actually passed to `can(user, ...)` inside the
 * route/page file.
 *
 * What this test CANNOT catch (stated plainly, not papered over):
 * - It is a textual match, not semantic — a `can(user, "x")` call inside a
 *   comment, a dead branch, or a string that is never reached would still
 *   count as "evaluated."
 * - It does not distinguish between HTTP methods in the same file — if a
 *   file exports both GET and POST with different required actions, the
 *   test only proves the declared action string appears SOMEWHERE in the
 *   file, not that it gates the correct handler.
 * - It cannot verify the check actually GATES access (returns 403/404 on
 *   failure) versus being read for an unrelated UI decision.
 * - It does not follow re-exported/aliased `can` wrappers (e.g. a
 *   route that imports a helper which itself calls `can()`).
 * - Ownership-override control flow (e.g. `catalogs/[id]/file/route.ts`'s
 *   `isOwner` branch) remains hand-written and hand-tested, same
 *   limitation design.md already stated for the registry-completeness test.
 * - A registered HTTP method with NO exported handler function of that name
 *   in the file at all (a different, pre-existing gap — a declared method
 *   nothing implements) is skipped here, not flagged: that is out of scope
 *   for "the declared action is evaluated with the wrong name" and is a
 *   distinct defect class this test does not claim to cover.
 */
describe("ROUTE_GUARDS declared actions are actually evaluated", () => {
  const urlToFile = buildUrlToFileMap();

  it("every non-session-only registry entry's declared Action appears as a can(user, \"<action>\") call in its source file", () => {
    const failures: string[] = [];

    for (const [urlPath, methods] of Object.entries(ROUTE_GUARDS)) {
      const file = urlToFile.get(urlPath);
      if (!file || !fs.existsSync(file)) continue; // covered separately by the completeness test
      const source = fs.readFileSync(file, "utf8");
      const isPage = file.endsWith("page.tsx");
      // Matches a quoted action string in call-argument position: either
      // immediately after `(` (e.g. `authorize("workshop.read", req)`) or
      // after `identifier,` (e.g. `can(user, "customers.write")`). This
      // follows local wrapper functions like this file's own `authorize()`
      // without hardcoding its name, while skipping bare type-union
      // declarations such as `action: "workshop.read" | "workshop.edit"`
      // (no comma/open-paren immediately precedes the quoted string there).
      const evaluatedActions = new Set(
        [...source.matchAll(/\(\s*(?:\w+\s*,\s*)?"([^"]+)"/g)].map((m) => m[1]),
      );

      for (const [method, action] of Object.entries(methods)) {
        if (action === "session-only") continue;
        // Pages have no exported HTTP method function — the whole file IS
        // the GET handler. API routes must actually export that method;
        // otherwise the declared method has no implementation at all,
        // which is a different (out-of-scope) defect class — skip it.
        if (!isPage && !new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(source)) {
          continue;
        }
        if (!evaluatedActions.has(action as Action)) {
          failures.push(
            `${urlPath} [${method}] declares "${action}" but ${file} only evaluates can(user, ...) for [${[...evaluatedActions].join(", ") || "nothing"}]`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });
});

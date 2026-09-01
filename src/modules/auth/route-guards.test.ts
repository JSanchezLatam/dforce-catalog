import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ACTIONS, type Action } from "./policy";

/**
 * Every route/page in the app that requires any form of authorization (not
 * just a valid session), mapped by URL path to the HTTP methods it handles
 * and the Action it requires.
 */
export const ROUTE_GUARDS: Record<
  string,
  // An ARRAY means every listed Action is EVALUATED in the handler — which is
  // exactly what the cross-reference test below proves, and deliberately not
  // "all are required". `/api/customers/[id]` PATCH is the first: a tecnico
  // PATCHes customers all day with `customers.write` alone;
  // `customers.deleteVehicle` is required only when the payload asks to
  // destroy a vehicle row rather than deactivate it. Reading this registry as
  // "requires every listed Action" would get this route wrong.
  Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", Action | readonly Action[] | "session-only" | "public">>
> = {
  // "public" = reachable with NO session at all (excluded by proxy.ts's
  // config.matcher). Distinct from "session-only", which still requires a
  // valid session and only skips the permission matrix.
  "/login": { GET: "public" },
  "/": { GET: "session-only" },
  // The forced-rotation screen. session-only by design (Decision 8): gating the
  // only screen that can clear a lockout would make the lockout unrecoverable.
  "/change-password": { GET: "session-only" },
  "/api/login": { POST: "session-only" },
  "/api/logout": { POST: "session-only" },
  "/api/customers": { GET: "customers.read", POST: "customers.write" },
  "/api/customers/[id]": { PATCH: ["customers.write", "customers.deleteVehicle"] },
  "/api/service-orders": { POST: "service-orders.write" },
  "/api/service-orders/[id]": { PATCH: "service-orders.write" },
  "/api/inventory-sync/manual": { GET: "sync.manual", POST: "sync.manual" },
  "/api/template-config": { GET: "template.edit", POST: "template.edit" },
  "/api/workshop-config": { GET: "workshop.read", POST: "workshop.edit" },
  "/api/workshop-config/logo": { GET: "workshop.read", POST: "workshop.edit", DELETE: "workshop.edit" },
  "/api/workshop-config/cover-image": { GET: "workshop.read", POST: "workshop.edit", DELETE: "workshop.edit" },
  "/api/catalog-builder/products": { POST: "catalogs.read" },
  "/api/catalog-builder/generate": { POST: "catalogs.generate" },
  "/api/catalog-builder/queue-depth": { GET: "catalogs.read" },
  "/api/catalogs/[id]/file": { GET: "catalogs.download" },
  "/customers": { GET: "customers.read" },
  // Reads `customers.deleteVehicle` too, but only to decide whether to render
  // a button — it is not required to VIEW the page, and this registry records
  // what a route requires. The cross-reference test below is one-directional
  // for exactly this reason: it proves every DECLARED action is evaluated,
  // never that every evaluated action is declared.
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
  "/users": { GET: "users.manage" },
  "/api/account": { GET: "account.self", PATCH: "account.self" },
  "/api/users": { GET: "users.manage", POST: "users.manage" },
  "/api/users/[id]": { PATCH: "users.manage" },
  // session-only, never Action-gated: this is the only route that can clear a
  // `mustChangePassword` flag, so gating it by the matrix would make one matrix
  // mistake an unrecoverable lockout (design.md Decision 8). It is safe without
  // an Action because it only ever rewrites the CALLER's own password —
  // `changePassword()` takes the id from the session, never from the body.
  "/api/account/password": { POST: "session-only" },
};

const APP_DIR = path.resolve(import.meta.dirname, "../../app");
const API_DIR = path.join(APP_DIR, "api");

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
 * Every `page.tsx` under `src/app`, including the ones OUTSIDE the `(app)`
 * route group (`/login`, `/`, `/change-password`). Those used to be invisible
 * to the registry entirely — a page could ship with no guard declaration at
 * all and nothing would notice. `endsWith("/page.tsx")` cannot be used here
 * because the root page's relative path is bare `page.tsx`.
 */
function findPageFiles(): string[] {
  if (!fs.existsSync(APP_DIR)) return [];
  return (fs.readdirSync(APP_DIR, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => /(^|\/)page\.tsx$/.test(f));
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
  for (const f of findPageFiles()) {
    map.set(filePathToUrl(`src/app/${f}`), path.join(APP_DIR, f));
  }
  return map;
}

describe("ROUTE_GUARDS completeness", () => {
  it("every existing API route and page has a ROUTE_GUARDS entry", () => {
    const relApiDir = "src/app/api";

    const apiRoutes = findRouteFiles(API_DIR, "/route.ts").map((f) =>
      filePathToUrl(`${relApiDir}/${f}`),
    );
    const pages = findPageFiles().map((f) => filePathToUrl(`src/app/${f}`));

    const allUrls = [...apiRoutes, ...pages].sort();
    const guardedUrls = Object.keys(ROUTE_GUARDS).sort();

    expect(allUrls).toEqual(guardedUrls);
  });

  it("every Action with a route in v1 is reachable", () => {
    const usedActions = new Set(
      Object.values(ROUTE_GUARDS)
        .flatMap((methods) => Object.values(methods).flat())
        .filter((v): v is Action => v !== "session-only" && v !== "public"),
    );

    // `users.manage` came off this list once /api/users landed — it now has a
    // real route and must stay reachable. `catalogs.listAll` has no dedicated
    // route of its own by design.
    const exempt: readonly Action[] = ["catalogs.listAll"];

    for (const action of ACTIONS) {
      if ((exempt as readonly string[]).includes(action)) continue;
      expect(usedActions.has(action as Action)).toBe(true);
    }
  });
});

/**
 * Closes verify-report W3. design.md Decision 8: if the screen that unlocks a
 * locked-out user ever required an `Action`, one matrix mistake becomes an
 * unrecoverable lockout — the user cannot reach the only surface that would
 * clear their flag. These entries are therefore permanently `"session-only"`,
 * and this test exists to fail loudly the day someone "tightens" them.
 */
describe("lockout safety — the unlock path is never Action-gated", () => {
  const NEVER_ACTION_GATED: readonly [string, "GET" | "POST" | "PATCH" | "DELETE"][] = [
    ["/api/login", "POST"],
    ["/api/logout", "POST"],
    ["/api/account/password", "POST"],
    ["/change-password", "GET"],
  ];

  it.each(NEVER_ACTION_GATED)("%s [%s] stays session-only", (urlPath, method) => {
    expect(ROUTE_GUARDS[urlPath]?.[method]).toBe("session-only");
  });

  it("no entry on the unlock path carries an Action under any method", () => {
    for (const [urlPath] of NEVER_ACTION_GATED) {
      for (const value of Object.values(ROUTE_GUARDS[urlPath] ?? {})) {
        expect(value).toBe("session-only");
      }
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

      for (const [method, declared] of Object.entries(methods)) {
        if (declared === "session-only" || declared === "public") continue;
        // Pages have no exported HTTP method function — the whole file IS
        // the GET handler. API routes must actually export that method;
        // otherwise the declared method has no implementation at all,
        // which is a different (out-of-scope) defect class — skip it.
        if (!isPage && !new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(source)) {
          continue;
        }
        // Every Action a method declares must be evaluated in its file, so
        // widening an entry to an array cannot smuggle in an unchecked one.
        for (const action of [declared].flat()) {
          if (!evaluatedActions.has(action as Action)) {
            failures.push(
              `${urlPath} [${method}] declares "${action}" but ${file} only evaluates can(user, ...) for [${[...evaluatedActions].join(", ") || "nothing"}]`,
            );
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});

/**
 * The completeness test above matches URLs, not methods — so a registry entry
 * could declare a `DELETE` no route exports (a permission decision recorded
 * for code that does not exist), or a route could export one the registry
 * never mentions (a real endpoint shipping with no declared permission at
 * all). Both passed until now; the second is the dangerous one.
 *
 * Pages are excluded: they export `default`, and a page is a GET by
 * construction.
 */
describe("ROUTE_GUARDS methods match what each route actually exports", () => {
  const HTTP_METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;

  function exportedMethods(file: string): string[] {
    const src = fs.readFileSync(file, "utf8");
    return HTTP_METHODS.filter((m) =>
      new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\s*\\(`).test(src),
    );
  }

  function apiEntries(): Array<{ url: string; file: string; declared: string[]; exported: string[] }> {
    const urlToFile = buildUrlToFileMap();
    return Object.entries(ROUTE_GUARDS)
      .map(([url, methods]) => ({ url, file: urlToFile.get(url) ?? "", declared: Object.keys(methods) }))
      .filter((e) => e.file.endsWith("/route.ts"))
      .map((e) => ({ ...e, exported: exportedMethods(e.file) }));
  }

  it("declares no method the route does not export", () => {
    const phantom = apiEntries()
      .flatMap(({ url, declared, exported }) =>
        declared.filter((m) => !exported.includes(m)).map((m) => `${m} ${url}`),
      )
      .sort();

    expect(phantom).toEqual([]);
  });

  // The one that matters: ship a DELETE and forget to say who may call it,
  // and this fails. That is the guarantee — not a convention anyone can skip.
  it("declares every method the route exports", () => {
    const undeclared = apiEntries()
      .flatMap(({ url, declared, exported }) =>
        exported.filter((m) => !declared.includes(m)).map((m) => `${m} ${url}`),
      )
      .sort();

    expect(undeclared).toEqual([]);
  });
});

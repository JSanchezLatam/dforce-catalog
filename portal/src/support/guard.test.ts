import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Inventory of the support area: every page, route handler and server-action file
// must verify the session ITSELF. A new one without `requireSupport(` fails here.
const ROOT = path.resolve(__dirname, "../..");
const AREAS = ["app/support", "app/api/support"];
// The only unguarded entry points: they are how a session starts.
const PUBLIC = new Set(["app/support/login/page.tsx", "app/api/support/login/route.ts"]);

const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(rel) : [rel];
  });

// A mention in a comment must not count as a check.
const code = (file: string) => readFileSync(path.join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const entryPoints = AREAS.flatMap(walk).filter((file) => {
  if (/\.test\.tsx?$/.test(file) || !/\.tsx?$/.test(file)) return false;
  return /\/(page\.tsx|route\.ts)$/.test(file) || /^["']use server["']/m.test(readFileSync(path.join(ROOT, file), "utf8"));
});

describe("support area guard inventory", () => {
  it("finds the entry points it is meant to protect", () => {
    expect(entryPoints).toEqual(
      expect.arrayContaining([
        "app/support/page.tsx",
        "app/support/login/page.tsx",
        "app/api/support/login/route.ts",
        "app/api/support/logout/route.ts",
      ]),
    );
  });

  it("every entry point outside the public list verifies the session itself", () => {
    // The login page also calls requireSupport (to skip the form when signed in), so
    // "public" is a list of exceptions to the rule, not "the files that lack the call".
    const unguarded = entryPoints.filter((f) => !PUBLIC.has(f) && !/\bawait requireSupport\(\)/.test(code(f)));
    expect(unguarded).toEqual([]);
  });

  it("the public list names real entry points, so a rename cannot silently widen it", () => {
    expect([...PUBLIC].filter((f) => !entryPoints.includes(f))).toEqual([]);
  });
});

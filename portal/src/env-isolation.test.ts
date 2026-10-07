import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// portal/ deploys alone (Vercel + Neon): it must never read a workshop
// variable. Add a name here only when the portal genuinely owns it.
const PORTAL_VARIABLES = new Set(["DATABASE_URL", "PORTAL_INGEST_SECRET", "NODE_ENV"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === ".next" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

describe("portal environment", () => {
  it("reads only its own variables", () => {
    const root = path.resolve(__dirname, "..");
    const read = new Set<string>();
    for (const dir of ["src", "app"]) {
      for (const file of sourceFiles(path.join(root, dir))) {
        for (const m of readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)|process\.env\[["']([A-Z0-9_]+)["']\]/g)) {
          read.add(m[1] ?? m[2]);
        }
      }
    }
    expect([...read].filter((name) => !PORTAL_VARIABLES.has(name))).toEqual([]);
    expect(read.has("DATABASE_URL")).toBe(true);
  });
});

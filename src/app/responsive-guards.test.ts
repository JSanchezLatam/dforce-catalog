import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A mechanical sweep (36 `p-8` copies) is unprovable by reading, and a new page
 * copied from an old one would bring the bare `p-8` back: 32px a side takes 64
 * of a 390px screen (audit #12). Same idea as `route-guards.test.ts`: the
 * regression is a test, not a review comment.
 *
 * Excluded on purpose: the print sheet owns its padding (`print:p-0`, a sheet
 * of paper, not a screen) and `loading.tsx` skeletons are not pages.
 */
const APP_ROOT = path.join(process.cwd(), "src/app/(app)");

function pageFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return entry.name === "page.tsx" ? [full] : [];
  });
}

/** `p-8` as a whole class: not `sm:p-8`, `px-8`, `p-80` or `-p-8`. */
function hasBarePadding8(source: string): boolean {
  return /(^|[\s"'`{])p-8(?=[\s"'`}]|$)/.test(source);
}

const SCANNED = pageFiles(APP_ROOT).filter((file) => !file.includes(`${path.sep}print${path.sep}`));

describe("responsive guards — page padding", () => {
  it("recognises a bare p-8 and nothing that merely contains it", () => {
    expect(hasBarePadding8('<div className="p-8">')).toBe(true);
    expect(hasBarePadding8('<div className="flex flex-col gap-6 p-8">')).toBe(true);
    expect(hasBarePadding8('<div className="p-8 flex flex-col gap-6">')).toBe(true);
    expect(hasBarePadding8('<div className="p-4 sm:p-8">')).toBe(false);
    expect(hasBarePadding8('<div className="px-8 py-8 p-80">')).toBe(false);
  });

  it("scans the real pages (a scan of zero files would pass trivially)", () => {
    expect(SCANNED.length).toBeGreaterThanOrEqual(14);
    expect(SCANNED.some((file) => file.endsWith(path.join("service-orders", "page.tsx")))).toBe(true);
    expect(SCANNED.some((file) => file.includes(`${path.sep}print${path.sep}`))).toBe(false);
  });

  it.each(SCANNED.map((file) => [path.relative(process.cwd(), file), file]))(
    "%s has no bare p-8 (use p-4 sm:p-8)",
    (_name, file) => {
      expect(hasBarePadding8(fs.readFileSync(file, "utf8"))).toBe(false);
    },
  );
});

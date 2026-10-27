/**
 * Text guard over the agenda module and page (AGENTS.md known limit 3: a secure-context API or a
 * locale date string in a client file passes jsdom and breaks the workshop LAN). Covers every later
 * work unit too: it scans whatever files exist.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = [import.meta.dirname, path.resolve(import.meta.dirname, "../../app/(app)/agenda")];

const files = ROOTS.flatMap((dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => ({ name: f, text: fs.readFileSync(path.join(dir, f), "utf8") })),
);

const matching = (re: RegExp, only: (text: string) => boolean = () => true) =>
  files.filter((f) => only(f.text) && re.test(f.text)).map((f) => f.name);

describe("agenda safety", () => {
  it("has files to scan", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it("No secure-context APIs: nothing that only exists on https or localhost", () => {
    expect(matching(/crypto\.randomUUID|crypto\.subtle|navigator\.clipboard|mediaDevices|geolocation|serviceWorker|showSaveFilePicker/)).toEqual([]);
  });

  it("No client locale date text: no 'use client' file formats a date with locale text", () => {
    expect(matching(/toLocaleString|toLocaleDateString|toLocaleTimeString|Intl\.DateTimeFormat/, (t) => /^\s*["']use client["']/.test(t))).toEqual([]);
  });

  it("no portal gated by typeof document, and no polling timer", () => {
    expect(matching(/typeof document/)).toEqual([]);
    expect(matching(/setInterval/)).toEqual([]);
  });
});

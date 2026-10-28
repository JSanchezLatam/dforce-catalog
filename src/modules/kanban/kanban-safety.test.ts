/**
 * Text guard over the kanban module and page (AGENTS.md known limits 2 and 3: a secure-context API, a
 * locale date string or a `typeof document` portal in a client file passes jsdom and breaks the workshop
 * LAN or hydration). It scans whatever files exist, so later work units are covered too. The poller lives
 * in `board/`, outside these roots, so any timer here is a new one.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = [import.meta.dirname, path.resolve(import.meta.dirname, "../../app/(app)/kanban")];

const files = ROOTS.flatMap((dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => ({ name: f, text: fs.readFileSync(path.join(dir, f), "utf8") })),
);

const matching = (re: RegExp, only: (text: string) => boolean = () => true) =>
  files.filter((f) => only(f.text) && re.test(f.text)).map((f) => f.name);

describe("kanban safety", () => {
  it("has files to scan, the page and the board among them", () => {
    expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(["page.tsx", "KanbanBoard.tsx", "KanbanCard.tsx"]));
  });

  it("No secure-context APIs: nothing that only exists on https or localhost", () => {
    expect(matching(/crypto\.randomUUID|crypto\.subtle|navigator\.clipboard|mediaDevices|geolocation|serviceWorker|showSaveFilePicker/)).toEqual([]);
  });

  it("No client locale date text: no 'use client' file formats a date with locale text", () => {
    expect(matching(/toLocaleString|toLocaleDateString|toLocaleTimeString|Intl\.DateTimeFormat/, (t) => /^\s*["']use client["']/.test(t))).toEqual([]);
  });

  it("no render branch on the environment, no portal behind a typeof check, and no timer of its own", () => {
    expect(matching(/typeof (document|window)/)).toEqual([]);
    expect(matching(/setInterval|setTimeout/)).toEqual([]);
  });
});

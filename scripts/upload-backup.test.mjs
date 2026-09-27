import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { buildUploads, isMainModule } from "./upload-backup.mjs";

// Coverage scope and rationale: see upload-backup.mjs's header comment.
describe("buildUploads", () => {
  it("pairs a Windows absolute dump path (the real standalone.ps1 wire shape) under the backups/ prefix", () => {
    const result = buildUploads(
      "C:\\Users\\op\\dforce-backups\\dforce_catalog-20260926-120000.dump",
      "C:\\Users\\op\\dforce-backups\\service.log",
    );

    expect(result).toEqual([
      { key: "backups/dforce_catalog-20260926-120000.dump", path: "C:\\Users\\op\\dforce-backups\\dforce_catalog-20260926-120000.dump" },
      { key: "backups/dforce_catalog-20260926-120000.service.log", path: "C:\\Users\\op\\dforce-backups\\service.log" },
    ]);
  });

  it("pairs the dump and its log under the backups/ prefix", () => {
    const result = buildUploads(
      "/tmp/dforce-backups/dforce_catalog-20260926-120000.dump",
      "/tmp/dforce-backups/service.log",
    );

    expect(result).toEqual([
      { key: "backups/dforce_catalog-20260926-120000.dump", path: "/tmp/dforce-backups/dforce_catalog-20260926-120000.dump" },
      { key: "backups/dforce_catalog-20260926-120000.service.log", path: "/tmp/dforce-backups/service.log" },
    ]);
  });

  it("uploads the dump only when no log path is given", () => {
    const result = buildUploads("/tmp/dforce-backups/dforce_catalog-20260926-120000.dump");

    expect(result).toEqual([
      { key: "backups/dforce_catalog-20260926-120000.dump", path: "/tmp/dforce-backups/dforce_catalog-20260926-120000.dump" },
    ]);
  });
});

// The main() guard must resolve symlinks/junctions before comparing, or a
// junction/case difference (the failure class GGA flagged) makes main()
// silently never run. Exercised with synthetic temp files, never main().
describe("isMainModule", () => {
  it("matches when invoked through a symlink to the same file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "upload-backup-"));
    const real = path.join(dir, "real.mjs");
    writeFileSync(real, "");
    const link = path.join(dir, "link.mjs");
    symlinkSync(real, link);

    expect(isMainModule(pathToFileURL(real).href, link)).toBe(true);
  });

  it("does not match when invoked as a different file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "upload-backup-"));
    const a = path.join(dir, "a.mjs");
    const b = path.join(dir, "b.mjs");
    writeFileSync(a, "");
    writeFileSync(b, "");

    expect(isMainModule(pathToFileURL(a).href, b)).toBe(false);
  });
});

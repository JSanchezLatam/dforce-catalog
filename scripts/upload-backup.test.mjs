import { describe, expect, it } from "vitest";

import { buildUploads } from "./upload-backup.mjs";

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

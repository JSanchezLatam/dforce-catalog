import { describe, expect, it } from "vitest";

import { statusBadgeClassName } from "./StatusBadge";

describe("statusBadgeClassName() — confirmed dash-* status mapping (design.md, v2 redesign)", () => {
  it("maps sync_status: running/completed/failed", () => {
    expect(statusBadgeClassName("running")).toContain("bg-dash-gold");
    expect(statusBadgeClassName("completed")).toContain("bg-dash-green");
    expect(statusBadgeClassName("failed")).toContain("bg-dash-red");
  });

  it("maps upload_status: pending/uploading/uploaded/failed", () => {
    expect(statusBadgeClassName("pending")).toContain("bg-dash-muted");
    expect(statusBadgeClassName("uploading")).toContain("bg-dash-gold");
    expect(statusBadgeClassName("uploaded")).toContain("bg-dash-green");
    expect(statusBadgeClassName("failed")).toContain("bg-dash-red");
  });
});

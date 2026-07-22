import { describe, expect, it } from "vitest";

import { statusBadgeClassName } from "./StatusBadge";

describe("statusBadgeClassName() — confirmed Kanagawa Dragon status mapping (design.md)", () => {
  it("maps sync_status: running/completed/failed", () => {
    expect(statusBadgeClassName("running")).toContain("bg-dragon-yellow");
    expect(statusBadgeClassName("completed")).toContain("bg-dragon-green");
    expect(statusBadgeClassName("failed")).toContain("bg-dragon-red");
  });

  it("maps upload_status: pending/uploading/uploaded/failed", () => {
    expect(statusBadgeClassName("pending")).toContain("bg-dragon-muted");
    expect(statusBadgeClassName("uploading")).toContain("bg-dragon-yellow");
    expect(statusBadgeClassName("uploaded")).toContain("bg-dragon-green");
    expect(statusBadgeClassName("failed")).toContain("bg-dragon-red");
  });
});

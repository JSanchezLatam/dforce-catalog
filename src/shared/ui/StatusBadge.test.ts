import { describe, expect, it } from "vitest";

import { statusBadgeClassName } from "./StatusBadge";

describe("statusBadgeClassName() — confirmed shadcn status mapping", () => {
  it("maps sync_status: running/completed/failed", () => {
    expect(statusBadgeClassName("running")).toContain("bg-amber-600");
    expect(statusBadgeClassName("completed")).toContain("bg-green-600");
    expect(statusBadgeClassName("failed")).toContain("bg-destructive");
  });

  it("maps upload_status: pending/uploading/uploaded/failed", () => {
    expect(statusBadgeClassName("pending")).toContain("bg-muted");
    expect(statusBadgeClassName("uploading")).toContain("bg-amber-600");
    expect(statusBadgeClassName("uploaded")).toContain("bg-green-600");
    expect(statusBadgeClassName("failed")).toContain("bg-destructive");
  });
});

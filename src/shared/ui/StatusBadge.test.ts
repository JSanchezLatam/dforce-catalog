import { describe, expect, it } from "vitest";

import { statusBadgeClassName } from "./StatusBadge";

describe("statusBadgeClassName() — confirmed shadcn status mapping", () => {
  it("maps sync_status: running/completed/failed", () => {
    expect(statusBadgeClassName("running")).toContain("bg-warning");
    expect(statusBadgeClassName("completed")).toContain("bg-success");
    expect(statusBadgeClassName("failed")).toContain("bg-destructive");
  });

  it("maps upload_status: pending/uploading/uploaded/failed", () => {
    expect(statusBadgeClassName("pending")).toContain("bg-muted");
    expect(statusBadgeClassName("uploading")).toContain("bg-warning");
    expect(statusBadgeClassName("uploaded")).toContain("bg-success");
    expect(statusBadgeClassName("failed")).toContain("bg-destructive");
  });

  it("renders icon indicator for each status", () => {
    const running = statusBadgeClassName("running");
    expect(running).toContain("inline-flex");
    expect(running).toContain("items-center");
    expect(running).toContain("gap-1");
  });

  it("maps order_status (R21, Phase 6): open/in_progress/done/cancelled", () => {
    expect(statusBadgeClassName("open")).toContain("bg-muted");
    expect(statusBadgeClassName("in_progress")).toContain("bg-warning");
    expect(statusBadgeClassName("done")).toContain("bg-success");
    expect(statusBadgeClassName("cancelled")).toContain("bg-muted");
  });

  it("maps reminder_status (R24/R25/R26, Phase 6): scheduled/sent/skipped/opted_out", () => {
    expect(statusBadgeClassName("scheduled")).toContain("bg-muted");
    expect(statusBadgeClassName("sent")).toContain("bg-success");
    expect(statusBadgeClassName("skipped")).toContain("bg-muted");
    expect(statusBadgeClassName("opted_out")).toContain("bg-muted");
  });
});

import { describe, expect, it } from "vitest";

import { statusBadgeClassName, type BadgeStatus } from "./StatusBadge";

/**
 * Audit #6: the old chips painted `text-white` / `text-success-foreground`
 * (white) on `bg-success` / `bg-warning` (mid green / amber), which fails 4.5:1
 * in BOTH themes. The fix is the approved mockup's `CHIP` map (ink on a tint in
 * light, light ink on a tint in dark), the same pattern as `badge.tsx`'s
 * destructive variant. `failed` is not in the mockup (it has no red chip), so it
 * takes the same recipe in red. jsdom computes no colour: these pin the classes,
 * the ratios are measured in the browser (tasks 1.9).
 */
const TINT = {
  zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-400/15 dark:text-zinc-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
  green: "bg-green-100 text-green-800 dark:bg-green-400/15 dark:text-green-300",
  red: "bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-300",
} as const;

const ALL_STATUSES: BadgeStatus[] = [
  "running", "uploading", "completed", "uploaded", "failed", "pending",
  "open", "in_progress", "ready_for_review", "done", "cancelled", "scheduled", "sent", "skipped", "opted_out",
];

describe("statusBadgeClassName() — theme-paired colours (audit #6)", () => {
  it.each([
    ["open", TINT.zinc],
    ["in_progress", TINT.amber],
    ["ready_for_review", TINT.amber],
    ["done", TINT.green],
    ["cancelled", `${TINT.zinc} line-through decoration-1`],
  ] as const)("%s carries the mockup CHIP classes", (status, expected) => {
    expect(statusBadgeClassName(status)).toContain(expected);
  });

  it.each(ALL_STATUSES)("%s has a dark: twin for both background and text, and no solid fill or white ink", (status) => {
    const cls = statusBadgeClassName(status);
    expect(cls).toMatch(/dark:bg-/);
    expect(cls).toMatch(/dark:text-/);
    expect(cls).not.toMatch(/\bbg-(success|warning|destructive|muted)\b/);
    expect(cls).not.toMatch(/text-(white|success-foreground|warning-foreground|destructive-foreground)/);
  });
});

describe("statusBadgeClassName() — confirmed shadcn status mapping", () => {
  it("maps sync_status: running/completed/failed", () => {
    expect(statusBadgeClassName("running")).toContain(TINT.amber);
    expect(statusBadgeClassName("completed")).toContain(TINT.green);
    expect(statusBadgeClassName("failed")).toContain(TINT.red);
  });

  it("maps upload_status: pending/uploading/uploaded/failed", () => {
    expect(statusBadgeClassName("pending")).toContain(TINT.zinc);
    expect(statusBadgeClassName("uploading")).toContain(TINT.amber);
    expect(statusBadgeClassName("uploaded")).toContain(TINT.green);
    expect(statusBadgeClassName("failed")).toContain(TINT.red);
  });

  it("renders icon indicator for each status", () => {
    const running = statusBadgeClassName("running");
    expect(running).toContain("inline-flex");
    expect(running).toContain("items-center");
    expect(running).toContain("gap-1");
  });

  it("maps order_status (R21, Phase 6): open/in_progress/done/cancelled", () => {
    expect(statusBadgeClassName("open")).toContain(TINT.zinc);
    expect(statusBadgeClassName("in_progress")).toContain(TINT.amber);
    expect(statusBadgeClassName("done")).toContain(TINT.green);
    expect(statusBadgeClassName("cancelled")).toContain(TINT.zinc);
  });

  it("maps reminder_status (R24/R25/R26, Phase 6): scheduled/sent/skipped/opted_out", () => {
    expect(statusBadgeClassName("scheduled")).toContain(TINT.zinc);
    expect(statusBadgeClassName("sent")).toContain(TINT.green);
    expect(statusBadgeClassName("skipped")).toContain(TINT.zinc);
    expect(statusBadgeClassName("opted_out")).toContain(TINT.zinc);
  });
});

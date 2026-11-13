import { describe, expect, it, vi } from "vitest";

import type { IngestBody } from "@portal/contract";
import { parseIngest } from "../../../portal/src/ingest/parse";
import { SCREEN_LABELS } from "@/modules/feedback/screen-labels";
import { deliverUsage, type DeliverUsageDeps, type UsageCount } from "./deliver";

type Usage = Extract<IngestBody, { kind: "usage" }>;
const CONFIG = { url: "https://portal.example/api/ingest", secret: "portal-secret-value" };
const DAY_MS = 86_400_000;
const TODAY = "2026-11-13";
const shift = (day: string, n: number) => new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);

const respond = (...statuses: number[]) => {
  let i = 0;
  return vi.fn<typeof fetch>(async () => new Response("{}", { status: statuses[Math.min(i++, statuses.length - 1)] }));
};

function harness(over: Partial<DeliverUsageDeps> & { start?: string | null; rows?: UsageCount[] } = {}) {
  const { start = shift(TODAY, -2), rows = [], ...rest } = over;
  const readPlan = vi.fn<NonNullable<DeliverUsageDeps["readPlan"]>>(async () => ({ start, today: TODAY }));
  // Like the real SELECT: only the rows inside [from, to].
  const readCounts = vi.fn<NonNullable<DeliverUsageDeps["readCounts"]>>(async (from, to) => rows.filter((r) => r.day >= from && r.day <= to));
  const setWatermark = vi.fn<NonNullable<DeliverUsageDeps["setWatermark"]>>(async () => {});
  const report = vi.fn();
  const fetchFn = respond(200);
  const deps: DeliverUsageDeps = { config: CONFIG, readPlan, readCounts, setWatermark, report, fetch: fetchFn, ...rest };
  const sent = () => (deps.fetch as ReturnType<typeof respond>).mock.calls.map(([, init]) => JSON.parse(String(init!.body)) as Usage);
  return { deps, readPlan, readCounts, setWatermark, report, sent };
}

describe("deliverUsage", () => {
  it.each([{ url: undefined, secret: "s" }, { url: "https://p.example/i", secret: undefined }])(
    "does nothing while the portal is unconfigured (%j)",
    async (config) => {
      const h = harness({ config });
      await deliverUsage(h.deps);
      expect(h.readPlan).not.toHaveBeenCalled();
      expect(h.sent()).toEqual([]);
    },
  );

  it("sends nothing and keeps the watermark when there is nothing to send (empty table, no watermark)", async () => {
    const h = harness({ start: null });
    expect(await deliverUsage(h.deps)).toBe(0);
    expect(h.sent()).toEqual([]);
    expect(h.setWatermark).not.toHaveBeenCalled();
  });

  it("a 40-day catch-up is two batches, 31 days then 10 with today, and the watermark ends at yesterday", async () => {
    const start = shift(TODAY, -40);
    const rows: UsageCount[] = [
      { day: start, screen: "/kanban", group: "gestion", views: 3 },
      { day: shift(start, 30), screen: "/agenda", group: "tecnico", views: 7 },
      { day: shift(start, 31), screen: "/kanban", group: "tecnico", views: 1 },
      { day: TODAY, screen: "/kanban", group: "gestion", views: 9 },
    ];
    const h = harness({ start, rows });
    expect(await deliverUsage(h.deps)).toBe(2);
    const [a, b] = h.sent();
    expect(h.sent()).toHaveLength(2);
    expect([a.from, a.to]).toEqual([start, shift(start, 30)]);
    expect([b.from, b.to]).toEqual([shift(start, 31), TODAY]);
    expect(a.counts).toEqual(rows.slice(0, 2));
    expect(b.counts).toEqual(rows.slice(2));
    for (const body of [a, b]) expect(parseIngest(body)).toEqual({ ok: true, body });
    expect(h.setWatermark.mock.calls).toEqual([[shift(start, 30)], [shift(TODAY, -1)]]);
  });

  it("an exact 31-day span is one batch", async () => {
    const h = harness({ start: shift(TODAY, -30) });
    expect(await deliverUsage(h.deps)).toBe(1);
    expect(h.sent().map((s) => [s.from, s.to])).toEqual([[shift(TODAY, -30), TODAY]]);
  });

  it("a run caught up to yesterday sends today alone and leaves the watermark at yesterday, never today", async () => {
    const h = harness({ start: TODAY });
    expect(await deliverUsage(h.deps)).toBe(1);
    expect(h.sent().map((s) => [s.from, s.to])).toEqual([[TODAY, TODAY]]);
    expect(h.setWatermark.mock.calls).toEqual([[shift(TODAY, -1)]]);
  });

  it("every body is a valid portal usage body carrying the whole screen catalog, empty days included", async () => {
    const h = harness({ start: shift(TODAY, -40), rows: [] });
    await deliverUsage(h.deps);
    const catalog = Object.entries(SCREEN_LABELS).map(([pattern, label]) => ({ pattern, label }));
    for (const body of h.sent()) {
      expect(body.counts).toEqual([]);
      expect(body.screens).toEqual(catalog);
      expect(parseIngest(body)).toEqual({ ok: true, body });
    }
  });

  it.each([
    ["a 5xx", () => respond(200, 503), "PortalServerError", "503"],
    ["a 4xx", () => respond(200, 400), "PortalRejectedError", "400"],
    [
      "a network throw",
      () => {
        const f = respond(200);
        f.mockImplementationOnce(async () => new Response("{}", { status: 200 })).mockRejectedValueOnce(new TypeError("fetch failed"));
        return f;
      },
      "TypeError",
      undefined,
    ],
  ])("%s stops the loop, keeps the watermark, and reports class and status only", async (_name, makeFetch, errorClass, status) => {
    const rows: UsageCount[] = [{ day: shift(TODAY, -5), screen: "/kanban", group: "gestion", views: 4242 }];
    const h = harness({ start: shift(TODAY, -40), rows, fetch: makeFetch() });
    expect(await deliverUsage(h.deps)).toBe(1);
    expect(h.sent()).toHaveLength(2); // the second batch failed; nothing after it
    expect(h.setWatermark.mock.calls).toEqual([[shift(TODAY, -10)]]); // only the first, acknowledged batch
    expect(h.report).toHaveBeenCalledOnce();
    const [error, context] = h.report.mock.calls[0];
    expect(context.tags).toEqual({ job: "usage-deliver", errorClass, ...(status ? { status } : {}) });
    expect(JSON.stringify([String(error), error.message, context])).not.toContain("4242");
  });

  it("a failing first batch never touches the watermark", async () => {
    const h = harness({ start: shift(TODAY, -2), fetch: respond(500) });
    expect(await deliverUsage(h.deps)).toBe(0);
    expect(h.sent()).toHaveLength(1);
    expect(h.setWatermark).not.toHaveBeenCalled();
  });
});

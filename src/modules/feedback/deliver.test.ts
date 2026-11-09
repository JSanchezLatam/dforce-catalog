import { describe, expect, it, vi } from "vitest";

import { parseIngest } from "../../../portal/src/ingest/parse";
import { backoffMinutes, deliverFeedback, type DeliverDeps } from "./deliver";
import type { FeedbackRow } from "./service";

const ID = "0b1f6f0e-5a3c-4d7e-9a55-1d2c3e4f5a6b";
const SECRET = "portal-secret-value";
const TEXT = "No me deja guardar la orden 4521";
const CONFIG = { url: "https://portal.example/api/ingest", secret: SECRET };

const row = (over: Partial<FeedbackRow> = {}): FeedbackRow => ({
  id: ID,
  userId: "u1",
  username: "jperez",
  role: "tecnico",
  category: "bug",
  text: TEXT,
  route: "/service-orders/abc",
  screenLabel: "Orden de servicio — Detalle",
  createdAt: new Date("2026-11-01T15:00:00.000Z"),
  deliveredAt: null,
  attempts: 1,
  nextAttemptAt: new Date("2026-11-01T15:00:00.000Z"),
  lastError: null,
  ...over,
});

// The fetch is the portal's real surface: 200 on success, 400 with a body, 401 on a bad signature, 5xx.
const respond = (status: number, body: unknown = {}) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

function harness(over: Partial<DeliverDeps> & { claimed?: FeedbackRow | null } = {}) {
  const { claimed = row(), ...rest } = over;
  const claim = vi.fn<NonNullable<DeliverDeps["claim"]>>(async () => claimed);
  const markDelivered = vi.fn<NonNullable<DeliverDeps["markDelivered"]>>(async () => {});
  const markFailed = vi.fn<NonNullable<DeliverDeps["markFailed"]>>(async () => {});
  const report = vi.fn();
  const fetchFn = respond(200);
  const deps: DeliverDeps = { config: CONFIG, claim, markDelivered, markFailed, report, fetch: fetchFn, ...rest };
  return { deps, claim, markDelivered, markFailed, report, fetchFn };
}

describe("backoffMinutes", () => {
  it("is 1, 2, 4 ... and capped at 60, monotone", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(backoffMinutes)).toEqual([1, 2, 4, 8, 16, 32, 60, 60]);
    expect(backoffMinutes(5000)).toBe(60);
  });
});

describe("deliverFeedback", () => {
  it.each([{ url: undefined, secret: "s" }, { url: "https://p.example/i", secret: undefined }, {}])(
    "answers queued before claiming anything when unconfigured (%j)",
    async (config) => {
      const h = harness({ config });
      expect(await deliverFeedback(ID, 5_000, h.deps)).toBe("queued");
      expect(h.claim).not.toHaveBeenCalled();
      expect(h.fetchFn).not.toHaveBeenCalled();
    },
  );

  it("sends nothing when the claim finds no due, undelivered row", async () => {
    const h = harness({ claimed: null });
    expect(await deliverFeedback(ID, 5_000, h.deps)).toBe("queued");
    expect(h.fetchFn).not.toHaveBeenCalled();
    expect(h.markDelivered).not.toHaveBeenCalled();
  });

  it("on a 2xx marks delivered and answers delivered", async () => {
    const h = harness();
    expect(await deliverFeedback(ID, 5_000, h.deps)).toBe("delivered");
    expect(h.markDelivered).toHaveBeenCalledWith(ID);
    expect(h.markFailed).not.toHaveBeenCalled();
  });

  it("sends a body the portal's own parser accepts, with the row's id", async () => {
    const h = harness();
    await deliverFeedback(ID, 5_000, h.deps);
    const sent = JSON.parse(h.fetchFn.mock.calls[0][1]?.body as string);
    expect(sent).toEqual({
      kind: "feedback",
      id: ID,
      username: "jperez",
      role: "tecnico",
      category: "bug",
      text: TEXT,
      route: "/service-orders/abc",
      screenLabel: "Orden de servicio — Detalle",
      createdAt: "2026-11-01T15:00:00.000Z",
    });
    expect(parseIngest(sent).ok).toBe(true);
  });

  it("truncates a username longer than the portal's 200 so the row is never rejected for it", async () => {
    const h = harness({ claimed: row({ username: "u".repeat(250) }) });
    await deliverFeedback(ID, 5_000, h.deps);
    const sent = JSON.parse(h.fetchFn.mock.calls[0][1]?.body as string);
    expect(sent.username).toHaveLength(200);
    expect(parseIngest(sent).ok).toBe(true);
  });

  it("passes the inline timeout to the transport", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    await deliverFeedback(ID, 5_000, harness().deps);
    expect(spy).toHaveBeenCalledWith(5_000);
    spy.mockRestore();
  });

  describe.each([
    ["400 with its body", () => respond(400, { error: "invalid" }), "4xx 400"],
    ["401 on a bad signature", () => respond(401, { error: "unauthorized" }), "4xx 401"],
    ["503", () => respond(503), "5xx 503"],
    [
      "a timeout",
      () =>
        vi.fn<typeof fetch>(async () => {
          throw new DOMException("The operation timed out", "TimeoutError");
        }),
      "timeout",
    ],
    [
      "a network failure",
      () =>
        vi.fn<typeof fetch>(async () => {
          throw new TypeError(`fetch failed: ${TEXT} ${SECRET}`);
        }),
      "network",
    ],
  ])("failure: %s", (_name, makeFetch, lastError) => {
    it("leaves the row undelivered, records class and status only, and backs off by the attempt", async () => {
      const h = harness({ fetch: makeFetch(), claimed: row({ attempts: 3 }) });
      expect(await deliverFeedback(ID, 5_000, h.deps)).toBe("queued");
      expect(h.markDelivered).not.toHaveBeenCalled();
      expect(h.markFailed).toHaveBeenCalledWith(ID, { lastError, delayMinutes: 4 });
    });

    it("reports to Sentry with id, status and attempt, and never the text or the secret", async () => {
      const h = harness({ fetch: makeFetch(), claimed: row({ attempts: 3 }) });
      await deliverFeedback(ID, 5_000, h.deps);
      expect(h.report).toHaveBeenCalledOnce();
      const [error, ctx] = h.report.mock.calls[0];
      expect(ctx.tags).toMatchObject({ job: "feedback-deliver", feedbackId: ID, attempt: "3" });
      const everything = JSON.stringify([String(error), (error as Error).stack, ctx]);
      expect(everything).not.toContain(TEXT);
      expect(everything).not.toContain(SECRET);
    });
  });

  it("reports 4xx as an error and a timeout as a warning, with the status tag", async () => {
    const a = harness({ fetch: respond(400) });
    await deliverFeedback(ID, 5_000, a.deps);
    expect(a.report.mock.calls[0][1]).toMatchObject({ level: "error", tags: { failure: "4xx", status: "400" } });
    const b = harness({
      fetch: vi.fn<typeof fetch>(async () => {
        throw new DOMException("t", "TimeoutError");
      }),
    });
    await deliverFeedback(ID, 5_000, b.deps);
    expect(b.report.mock.calls[0][1]).toMatchObject({ level: "warning", tags: { failure: "timeout" } });
  });

  it("recovers after a 4xx: the next attempt claims again and delivers with the same id", async () => {
    const failing = respond(400);
    const h = harness({ fetch: failing });
    await deliverFeedback(ID, 5_000, h.deps);
    const again = harness({ claimed: row({ attempts: 2 }) });
    expect(await deliverFeedback(ID, 5_000, again.deps)).toBe("delivered");
    expect(JSON.parse(again.fetchFn.mock.calls[0][1]?.body as string).id).toBe(JSON.parse(failing.mock.calls[0][1]?.body as string).id);
  });

  it("never throws: a failing claim is reported and answered queued", async () => {
    const h = harness({
      claim: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    expect(await deliverFeedback(ID, 5_000, h.deps)).toBe("queued");
    expect(h.report).toHaveBeenCalled();
  });

  it("never throws, and does not claim delivery, when marking delivered fails", async () => {
    const h = harness({
      markDelivered: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    expect(await deliverFeedback(ID, 5_000, h.deps)).toBe("queued");
  });

  it("never throws when Sentry itself throws", async () => {
    const h = harness({
      fetch: respond(503),
      report: () => {
        throw new Error("sentry down");
      },
    });
    expect(await deliverFeedback(ID, 5_000, h.deps)).toBe("queued");
    expect(h.markFailed).toHaveBeenCalled();
  });
});

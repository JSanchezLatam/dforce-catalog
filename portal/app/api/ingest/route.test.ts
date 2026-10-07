import { beforeEach, describe, expect, it, vi } from "vitest";

import { sign, type IngestBody } from "../../../src/contract";

const applyIngest = vi.hoisted(() => vi.fn());
vi.mock("../../../src/ingest/apply", () => ({ applyIngest }));

import * as route from "./route";

const SECRET = "unit-secret";
const url = "http://portal.test/api/ingest";
const body: IngestBody = { kind: "delete", clienteId: "c1", version: 3 };
const now = () => Math.floor(Date.now() / 1000);

const signed = (raw: string, over: { now?: number; secret?: string } = {}) =>
  sign(raw, over.secret ?? SECRET, over.now);

beforeEach(() => {
  applyIngest.mockReset().mockResolvedValue({ applied: true });
  process.env.PORTAL_INGEST_SECRET = SECRET;
});

describe("POST /api/ingest", () => {
  it("is a node runtime route", () => {
    expect(route.runtime).toBe("nodejs");
  });

  it("401 without any signature header", async () => {
    const res = await route.POST(new Request(url, { method: "POST", body: JSON.stringify(body) }));
    expect(res.status).toBe(401);
    expect(applyIngest).not.toHaveBeenCalled();
  });

  it("401 on a signature made with another secret", async () => {
    const raw = JSON.stringify(body);
    const res = await route.POST(new Request(url, { method: "POST", body: raw, headers: signed(raw, { secret: "x" }) }));
    expect(res.status).toBe(401);
    expect(applyIngest).not.toHaveBeenCalled();
  });

  it("401 on a 6 minute old timestamp, even with a valid MAC", async () => {
    const raw = JSON.stringify(body);
    const headers = signed(raw, { now: now() - 360 });
    const res = await route.POST(new Request(url, { method: "POST", body: raw, headers }));
    expect(res.status).toBe(401);
    expect(applyIngest).not.toHaveBeenCalled();
  });

  it("401 on a tampered body", async () => {
    const raw = JSON.stringify(body);
    const headers = signed(raw);
    const res = await route.POST(new Request(url, { method: "POST", body: raw.replace("c1", "c2"), headers }));
    expect(res.status).toBe(401);
    expect(applyIngest).not.toHaveBeenCalled();
  });

  it("401 when the portal has no secret configured (fails closed)", async () => {
    delete process.env.PORTAL_INGEST_SECRET;
    const raw = JSON.stringify(body);
    const res = await route.POST(new Request(url, { method: "POST", body: raw, headers: signed(raw, { secret: "" }) }));
    expect(res.status).toBe(401);
    expect(applyIngest).not.toHaveBeenCalled();
  });

  it("answers 401 to GET, PUT, PATCH and DELETE without a signature", async () => {
    for (const method of ["GET", "PUT", "PATCH", "DELETE"] as const) {
      const res = await route[method](new Request(url, { method }));
      expect(res.status, method).toBe(401);
    }
    expect(applyIngest).not.toHaveBeenCalled();
  });

  it("a signed non-POST is 405, never applied", async () => {
    const res = await route.PUT(new Request(url, { method: "PUT", body: "", headers: signed("") }));
    expect(res.status).toBe(405);
    expect(applyIngest).not.toHaveBeenCalled();
  });

  it("400 on a signed body that is not JSON or has a bad shape", async () => {
    for (const raw of ["not json", JSON.stringify({ ...body, phone: "555" }), JSON.stringify({ kind: "x" })]) {
      const res = await route.POST(new Request(url, { method: "POST", body: raw, headers: signed(raw) }));
      expect(res.status, raw).toBe(400);
    }
    expect(applyIngest).not.toHaveBeenCalled();
  });

  it("200 {applied} from apply, no-store on every answer", async () => {
    const raw = JSON.stringify(body);
    const ok = await route.POST(new Request(url, { method: "POST", body: raw, headers: signed(raw) }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ applied: true });
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(applyIngest).toHaveBeenCalledWith(body);

    applyIngest.mockResolvedValue({ applied: false });
    const stale = await route.POST(new Request(url, { method: "POST", body: raw, headers: signed(raw) }));
    expect(stale.status).toBe(200);
    expect(await stale.json()).toEqual({ applied: false });

    const denied = await route.POST(new Request(url, { method: "POST", body: raw }));
    expect(denied.headers.get("cache-control")).toBe("no-store");
  });
});

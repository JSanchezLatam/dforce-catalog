import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findByToken = vi.fn();
const recordAcceptance = vi.fn();
vi.mock("../../../src/portal/lookup", () => ({ findByToken: (t: string) => findByToken(t) }));
vi.mock("../../../src/portal/accept", () => ({ recordAcceptance: (t: string) => recordAcceptance(t) }));
// `undefined` = the real TERMS_GATE_ENABLED, so the gate-off tests read the shipped value.
const gate = vi.hoisted(() => ({ on: undefined as boolean | undefined }));
vi.mock("../../../src/terms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/terms")>();
  return {
    ...actual,
    get TERMS_GATE_ENABLED() {
      return gate.on ?? actual.TERMS_GATE_ENABLED;
    },
  };
});

import { POST as accept } from "./accept/route";
import { POST as open } from "./open/route";
import { POST as snapshot } from "./snapshot/route";

const SNAP = { vehicles: [], generatedAt: "2026-10-01T10:00:00.000Z" };
let n = 0;
const call = (route: typeof open, body: string | undefined, url = "http://portal.test/api/c/x") =>
  route(
    new Request(url, {
      method: "POST",
      body,
      // A fresh IP per call: the limiter is module state shared across tests.
      headers: { "x-forwarded-for": `9.9.${Math.floor(++n / 250)}.${n % 250}` },
    }),
  );
const tok = (t = "tok") => JSON.stringify({ token: t });
const routes = { open, accept, snapshot };

let spies: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  findByToken.mockReset();
  recordAcceptance.mockReset();
  gate.on = undefined;
  spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});
afterEach(() => vi.restoreAllMocks());

describe.each(Object.entries(routes))("POST /api/c/%s", (_name, route) => {
  it("reads the token only from the body: a ?token= query with no body is 400", async () => {
    const res = await call(route, undefined, "http://portal.test/api/c/x?token=tok");
    expect(res.status).toBe(400);
    expect(findByToken).not.toHaveBeenCalled();
  });

  it.each([["not json"], ["[]"], ["{}"], [JSON.stringify({ token: 5 })], ["x".repeat(5000)]])(
    "malformed body %j is 400",
    async (raw) => {
      expect((await call(route, raw)).status).toBe(400);
      expect(findByToken).not.toHaveBeenCalled();
    },
  );

  it("answers every unknown token with the same 404, body and headers", async () => {
    findByToken.mockResolvedValue(null);
    const a = await call(route, tok("one"));
    const b = await call(route, tok(""));
    expect(a.status).toBe(404);
    expect(await a.clone().json()).toEqual({ state: "invalid" });
    expect(await b.text()).toBe(await a.text());
    expect([...b.headers]).toEqual([...a.headers]);
  });

  it("sets no-store, no-referrer and noindex on 200, 404 and 400", async () => {
    findByToken.mockResolvedValueOnce({ snapshot: SNAP, accepted: true });
    findByToken.mockResolvedValueOnce(null);
    for (const res of [await call(route, tok()), await call(route, tok()), await call(route, "nope")]) {
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    }
  });

  it("429s with the same headers and never reaches the lookup", async () => {
    findByToken.mockResolvedValue(null);
    const headers = { "x-forwarded-for": "7.7.7.7" };
    const send = () => route(new Request("http://portal.test/api/c/x", { method: "POST", body: tok(), headers }));
    for (let i = 0; i < 30; i++) await send();
    findByToken.mockClear();
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(findByToken).not.toHaveBeenCalled();
  });

  it("never logs the token or the body", async () => {
    findByToken.mockResolvedValue(null);
    await call(route, tok("SECRET-TOKEN"));
    await call(route, "SECRET-TOKEN {");
    findByToken.mockRejectedValue(new Error("db down"));
    await call(route, tok("SECRET-TOKEN")).catch(() => {});
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain("SECRET-TOKEN");
  });
});

describe("open", () => {
  it("reports terms and accepted, without any snapshot, when the terms gate is on", async () => {
    gate.on = true;
    findByToken.mockResolvedValueOnce({ snapshot: SNAP, accepted: false });
    findByToken.mockResolvedValueOnce({ snapshot: SNAP, accepted: true });
    expect(await (await call(open, tok())).json()).toEqual({ state: "terms" });
    expect(await (await call(open, tok())).json()).toEqual({ state: "accepted" });
  });
});

describe("snapshot", () => {
  it("returns data only once accepted when the terms gate is on", async () => {
    gate.on = true;
    findByToken.mockResolvedValueOnce({ snapshot: SNAP, accepted: false });
    findByToken.mockResolvedValueOnce({ snapshot: SNAP, accepted: true });
    expect(await (await call(snapshot, tok())).json()).toEqual({ state: "terms" });
    expect(await (await call(snapshot, tok())).json()).toEqual({ state: "accepted", snapshot: SNAP });
  });
});

describe("accept", () => {
  it("records the acceptance before it returns the snapshot when the terms gate is on", async () => {
    gate.on = true;
    findByToken.mockResolvedValue({ snapshot: SNAP, accepted: false });
    const order: string[] = [];
    recordAcceptance.mockImplementation(async () => void order.push("insert"));
    const res = await call(accept, tok("abc"));
    order.push("response");
    expect(order).toEqual(["insert", "response"]);
    expect(recordAcceptance).toHaveBeenCalledWith("abc");
    expect(await res.json()).toEqual({ state: "accepted", snapshot: SNAP });
  });

  it("never returns the snapshot when the acceptance could not be stored when the terms gate is on", async () => {
    gate.on = true;
    findByToken.mockResolvedValue({ snapshot: SNAP, accepted: false });
    recordAcceptance.mockRejectedValue(new Error("insert failed"));
    await expect(call(accept, tok())).rejects.toThrow("insert failed");
  });

  it("does not record anything for an invalid token", async () => {
    findByToken.mockResolvedValue(null);
    await call(accept, tok());
    expect(recordAcceptance).not.toHaveBeenCalled();
  });
});

// The provisional terms are hidden at the client's request: TERMS_GATE_ENABLED ships false.
describe("with the terms gate off (the default)", () => {
  it("open lets an un-accepted valid token straight through to the history", async () => {
    findByToken.mockResolvedValue({ snapshot: SNAP, accepted: false });
    const res = await call(open, tok());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "accepted" });
  });

  it("snapshot returns the data to an un-accepted valid token", async () => {
    findByToken.mockResolvedValue({ snapshot: SNAP, accepted: false });
    const res = await call(snapshot, tok());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "accepted", snapshot: SNAP });
  });

  it("accept writes no acceptance row for text the customer never saw", async () => {
    findByToken.mockResolvedValue({ snapshot: SNAP, accepted: false });
    const res = await call(accept, tok("abc"));
    expect(recordAcceptance).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ state: "accepted", snapshot: SNAP });
  });

  it.each(Object.entries(routes))("%s still answers an unknown token with the invalid 404", async (_name, route) => {
    findByToken.mockResolvedValue(null);
    const res = await call(route, tok("nope"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ state: "invalid" });
    expect(recordAcceptance).not.toHaveBeenCalled();
  });
});

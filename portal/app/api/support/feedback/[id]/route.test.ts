import { beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH } from "./route";

let authed: boolean;
const updateFeedback = vi.fn();
vi.mock("../../../../../src/support/session", () => ({ requireSupport: async () => authed }));
vi.mock("../../../../../src/support/queries", async (original) => ({
  ...(await original<typeof import("../../../../../src/support/queries")>()),
  updateFeedback: (...args: unknown[]) => updateFeedback(...args),
}));

const ID = "11111111-1111-4111-8111-111111111111";
const call = (body: unknown, id = ID) =>
  PATCH(new Request(`http://portal.test/api/support/feedback/${id}`, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  authed = true;
  updateFeedback.mockReset().mockResolvedValue(true);
});

describe("PATCH /api/support/feedback/[id]", () => {
  it("answers 401 without a session and touches nothing", async () => {
    authed = false;
    expect((await call({ status: "resuelto" })).status).toBe(401);
    expect(updateFeedback).not.toHaveBeenCalled();
  });

  it("saves a status", async () => {
    const res = await call({ status: "resuelto" });
    expect(res.status).toBe(200);
    expect(updateFeedback).toHaveBeenCalledWith(ID, { status: "resuelto" });
  });

  it("saves a note, and a note of exactly 2000 characters", async () => {
    const note = "n".repeat(2000);
    expect((await call({ note })).status).toBe(200);
    expect(updateFeedback).toHaveBeenCalledWith(ID, { note });
  });

  it("saves status and note together", async () => {
    expect((await call({ status: "leido", note: "x" })).status).toBe(200);
    expect(updateFeedback).toHaveBeenCalledWith(ID, { status: "leido", note: "x" });
  });

  it("an empty note is allowed: it clears the previous one", async () => {
    expect((await call({ note: "" })).status).toBe(200);
    expect(updateFeedback).toHaveBeenCalledWith(ID, { note: "" });
  });

  it("rejects a status outside the three with 400", async () => {
    expect((await call({ status: "archivado" })).status).toBe(400);
    expect(updateFeedback).not.toHaveBeenCalled();
  });

  it("rejects a note of 2001 characters with 400", async () => {
    expect((await call({ note: "n".repeat(2001) })).status).toBe(400);
    expect(updateFeedback).not.toHaveBeenCalled();
  });

  it("rejects any key outside {status, note}, even next to valid ones", async () => {
    expect((await call({ status: "leido", username: "otro" })).status).toBe(400);
    expect((await call({ internalNote: "x" })).status).toBe(400);
    expect(updateFeedback).not.toHaveBeenCalled();
  });

  it("rejects an empty body, a non-object and malformed JSON with 400", async () => {
    for (const body of [{}, [], null, "x", "{not json"]) expect((await call(body)).status).toBe(400);
    expect(updateFeedback).not.toHaveBeenCalled();
  });

  it("rejects a non-string note and a non-string status with 400", async () => {
    expect((await call({ note: 5 })).status).toBe(400);
    expect((await call({ status: ["nuevo"] })).status).toBe(400);
  });

  it("answers 404 for an id that is not a uuid, without querying", async () => {
    expect((await call({ status: "leido" }, "no-es-uuid")).status).toBe(404);
    expect(updateFeedback).not.toHaveBeenCalled();
  });

  it("answers 404 when no row has that id", async () => {
    updateFeedback.mockResolvedValue(false);
    expect((await call({ status: "leido" })).status).toBe(404);
  });
});

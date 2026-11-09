import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/modules/auth/roles";
import { handleSendFeedback } from "./route";

function req(body: unknown, role: Role = "tecnico", raw?: string) {
  return new NextRequest("http://localhost/api/feedback", {
    method: "POST",
    headers: { "x-user-id": "user-1", "x-user-role": role, "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

const valid = { category: "bug", text: "Se cayó al guardar", route: "/service-orders/abc?x=1" };

// The real service validates; the route test runs it for real and only fakes the insert and the user lookup.
function deps() {
  const insert = vi.fn().mockResolvedValue({ id: "f1" });
  const getUsername = vi.fn().mockResolvedValue("jperez");
  const deliver = vi.fn<(id: string, timeoutMs: number) => Promise<"delivered" | "queued">>().mockResolvedValue("queued");
  return { insert, getUsername, deliver, deps: { getUsername, deliver, createDeps: { insert } } };
}

describe("POST /api/feedback", () => {
  it("401 when the request carries no session", async () => {
    const { insert, deps: d } = deps();
    const request = new NextRequest("http://localhost/api/feedback", { method: "POST", body: JSON.stringify(valid) });
    const res = await handleSendFeedback(request, d);
    expect(res.status).toBe(401);
    expect(insert).not.toHaveBeenCalled();
  });

  it("401 when the session user no longer exists", async () => {
    const { insert, deps: d } = deps();
    d.getUsername.mockResolvedValue(null);
    const res = await handleSendFeedback(req(valid), d);
    expect(res.status).toBe(401);
    expect(insert).not.toHaveBeenCalled();
  });

  it("403 for pantalla, without touching the service", async () => {
    const { insert, getUsername, deps: d } = deps();
    const res = await handleSendFeedback(req(valid, "pantalla"), d);
    expect(res.status).toBe(403);
    expect(getUsername).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it.each(["tecnico", "jefe_taller", "administrador"] as const)("201 {id, outcome} for %s", async (role) => {
    const { deps: d } = deps();
    const res = await handleSendFeedback(req(valid, role), d);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "f1", outcome: "queued" });
  });

  it("delivers inline with a 5 s timeout and answers its outcome", async () => {
    const { deliver, deps: d } = deps();
    deliver.mockResolvedValue("delivered");
    const res = await handleSendFeedback(req(valid), d);
    expect(deliver).toHaveBeenCalledWith("f1", 5_000);
    expect(await res.json()).toEqual({ id: "f1", outcome: "delivered" });
  });

  it("does not attempt delivery for a request it refused", async () => {
    const { deliver, deps: d } = deps();
    await handleSendFeedback(req({ ...valid, text: " " }), d);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("stamps author and role from the SESSION and ignores body attempts; label is derived server-side", async () => {
    const { insert, deps: d } = deps();
    await handleSendFeedback(
      req({ ...valid, userId: "evil", username: "evil", role: "administrador", screenLabel: "Hack" }, "tecnico"),
      d,
    );
    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({ userId: "user-1", username: "jperez", role: "tecnico", route: "/service-orders/abc" });
    expect(row.screenLabel).not.toBe("Hack");
  });

  it.each([
    ["missing category", { text: "hola", route: "/x" }, "category"],
    ["unknown category", { category: "nope", text: "hola", route: "/x" }, "category"],
    ["blank text", { category: "bug", text: "   ", route: "/x" }, "text"],
    ["missing text", { category: "bug", route: "/x" }, "text"],
    ["non-string text", { category: "bug", text: 7, route: "/x" }, "text"],
    ["missing route", { category: "bug", text: "hola" }, "route"],
  ])("400 with the Spanish errors map for %s, persisting nothing", async (_n, body, field) => {
    const { insert, deps: d } = deps();
    const res = await handleSendFeedback(req(body), d);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { errors: Record<string, string> };
    expect(typeof json.errors[field]).toBe("string");
    expect(insert).not.toHaveBeenCalled();
  });

  it("accepts exactly 2000 characters and refuses 2001 with nothing persisted", async () => {
    const ok = deps();
    expect((await handleSendFeedback(req({ ...valid, text: "a".repeat(2000) }), ok.deps)).status).toBe(201);
    expect(ok.insert).toHaveBeenCalledTimes(1);

    const bad = deps();
    const res = await handleSendFeedback(req({ ...valid, text: "a".repeat(2001) }), bad.deps);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: Record<string, string> }).errors.text).toMatch(/2000/);
    expect(bad.insert).not.toHaveBeenCalled();
  });

  it.each([["malformed JSON", "{nope"], ["a JSON array", "[]"], ["JSON null", "null"]])("400 for %s", async (_n, raw) => {
    const { insert, deps: d } = deps();
    const res = await handleSendFeedback(req(null, "tecnico", raw), d);
    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rethrows an error that is not a validation error", async () => {
    const { deps: d } = deps();
    d.createDeps.insert.mockRejectedValue(new Error("db down"));
    await expect(handleSendFeedback(req(valid), d)).rejects.toThrow("db down");
  });
});

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/modules/auth/roles";
import { handleRecordView } from "./route";

function req(body: unknown, role: Role = "tecnico", raw?: string) {
  return new NextRequest("http://localhost/api/usage/view", {
    method: "POST",
    headers: { "x-user-id": "user-1", "x-user-role": role, "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

// The real recordView runs; only its upsert is faked.
function deps() {
  const upsert = vi.fn<(screen: string, group: "gestion" | "tecnico") => Promise<void>>().mockResolvedValue();
  return { upsert, deps: { recordDeps: { upsert } } };
}

describe("POST /api/usage/view", () => {
  it("401 without a session, even with a bad body, and stores nothing", async () => {
    const { upsert, deps: d } = deps();
    for (const body of [JSON.stringify({ screen: "/agenda" }), "{nope"]) {
      const res = await handleRecordView(new NextRequest("http://localhost/api/usage/view", { method: "POST", body }), d);
      expect(res.status).toBe(401);
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  it("403 for pantalla, and stores nothing", async () => {
    const { upsert, deps: d } = deps();
    const res = await handleRecordView(req({ screen: "/agenda" }, "pantalla"), d);
    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{nope"],
    ["a JSON string", JSON.stringify("/agenda")],
    ["null", "null"],
    ["an array", JSON.stringify(["/agenda"])],
  ])("400 for an unreadable body (%s), and stores nothing", async (_label, raw) => {
    const { upsert, deps: d } = deps();
    const res = await handleRecordView(req(null, "tecnico", raw), d);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "validation_error", errors: { form: "No se pudo leer el pedido." } });
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each(["/service-orders/123", "/nope", "constructor", undefined, 7])(
    "400 for the unknown screen %j, and stores nothing",
    async (screen) => {
      const { upsert, deps: d } = deps();
      const res = await handleRecordView(req({ screen }), d);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "validation_error", errors: { screen: "Pantalla inválida." } });
      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["administrador", "gestion"],
    ["jefe_taller", "gestion"],
    ["tecnico", "tecnico"],
  ] as const)("204 with no body for %s, counted as %s", async (role, group) => {
    const { upsert, deps: d } = deps();
    const res = await handleRecordView(req({ screen: "/agenda" }, role), d);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(upsert).toHaveBeenCalledExactlyOnceWith("/agenda", group);
  });

  it("takes the group from the SESSION: a técnico naming gestion in the body counts as tecnico", async () => {
    const { upsert, deps: d } = deps();
    const res = await handleRecordView(
      req({ screen: "/service-orders/[id]", group: "gestion", roleGroup: "gestion", role: "administrador" }, "tecnico"),
      d,
    );
    expect(res.status).toBe(204);
    expect(upsert).toHaveBeenCalledExactlyOnceWith("/service-orders/[id]", "tecnico");
  });
});

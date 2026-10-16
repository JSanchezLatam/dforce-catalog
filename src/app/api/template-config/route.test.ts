import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET, POST } from "./route";

function requestAs(role: "usuario" | "administrador", options?: { method?: string; body?: string }) {
  return new NextRequest("http://localhost/api/template-config", {
    method: options?.method,
    body: options?.body,
    headers: { "x-user-id": "user-1", "x-user-role": role },
  });
}

/**
 * R9.6/NFR-8 — "template.edit" is one of the three explicit `can()`-gated
 * actions: non-admin requests must receive 403 before any business logic
 * (here: before any DB query) executes.
 */
describe("template-config route — role gating (403)", () => {
  it("GET rejects a non-admin (usuario) with 403", async () => {
    const response = await GET(requestAs("usuario"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("POST rejects a non-admin (usuario) with 403", async () => {
    const response = await POST(requestAs("usuario", { method: "POST", body: "{}" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("throws when called without session headers (proxy.ts did not validate)", async () => {
    const request = new NextRequest("http://localhost/api/template-config");
    await expect(GET(request)).rejects.toThrow();
  });
});

describe("POST /api/template-config — unreadable body", () => {
  // A real request carrying the bad bytes: `request.json()` fails (or yields a non-object) exactly as on the wire.
  it.each(["{not json", "null", "[]"])("answers 400, not 500, for the body %s", async (body) => {
    const raw = new NextRequest("http://localhost/api/template-config", {
      method: "POST",
      headers: { "x-user-id": "u-1", "x-user-role": "administrador", "Content-Type": "application/json" },
      body,
    });

    const response = await POST(raw);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ errors: { form: "No se pudo leer el pedido" } });
  });
});

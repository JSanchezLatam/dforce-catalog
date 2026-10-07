import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { PortalConsentRequiredError } from "@/modules/customers/consent";
import { ClienteDeactivatedError, ClienteNotFoundError } from "@/modules/customers/service";
import { handleRotatePortalToken } from "./route";

function requestFor(body: unknown, role = "administrador", raw?: string) {
  return new NextRequest("http://localhost/api/customers/c1/portal-token/rotate", {
    method: "POST",
    headers: { "x-user-id": "u1", "x-user-role": role, "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

describe("POST /api/customers/[id]/portal-token/rotate", () => {
  it.each(["jefe_taller", "tecnico", "ghost"])("403s %s before the body is read or any service call", async (role) => {
    const rotate = vi.fn();
    const response = await handleRotatePortalToken(requestFor({ confirm: true }, role), "c1", { rotate });

    expect(response.status).toBe(403);
    expect(rotate).not.toHaveBeenCalled();
  });

  it("throws without session headers (proxy.ts did not validate)", async () => {
    const request = new NextRequest("http://localhost/api/customers/c1/portal-token/rotate", { method: "POST" });
    await expect(handleRotatePortalToken(request, "c1", { rotate: vi.fn() })).rejects.toThrow();
  });

  it.each([{}, { confirm: false }, { confirm: "true" }, { confirm: 1 }, { confirm: null }, []])(
    "does not rotate without an explicit boolean confirm (%j)",
    async (body) => {
      const rotate = vi.fn();
      const response = await handleRotatePortalToken(requestFor(body), "c1", { rotate });

      expect(response.status).toBe(400);
      expect(rotate).not.toHaveBeenCalled();
    },
  );

  it("400s an unparseable body without rotating", async () => {
    const rotate = vi.fn();
    const response = await handleRotatePortalToken(requestFor(null, "administrador", "{nope"), "c1", { rotate });

    expect(response.status).toBe(400);
    expect(rotate).not.toHaveBeenCalled();
  });

  it("rotates for the administrador on confirm:true and never echoes a token", async () => {
    const rotate = vi.fn(async () => undefined);
    const response = await handleRotatePortalToken(requestFor({ confirm: true }), "c1", { rotate });

    expect(response.status).toBe(200);
    expect(rotate).toHaveBeenCalledWith("c1");
    expect(await response.json()).toEqual({ rotated: true });
  });

  it("maps the service refusals: 404 unknown, 409 deactivated, 409 without current consent", async () => {
    const run = (err: Error) =>
      handleRotatePortalToken(requestFor({ confirm: true }), "c1", {
        rotate: async () => {
          throw err;
        },
      });

    expect((await run(new ClienteNotFoundError("c1"))).status).toBe(404);
    const deactivated = await run(new ClienteDeactivatedError("c1"));
    expect(deactivated.status).toBe(409);
    expect(await deactivated.json()).toEqual({ error: "cliente_deactivated" });
    const noConsent = await run(new PortalConsentRequiredError("c1"));
    expect(noConsent.status).toBe(409);
    expect(await noConsent.json()).toEqual({ error: "consent_required" });
  });
});

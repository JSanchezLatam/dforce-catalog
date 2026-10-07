import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { ClienteDeactivatedError, ClienteNotFoundError } from "@/modules/customers/service";
import { handleRecordConsent } from "./route";

function requestFor(body: unknown, role = "administrador", raw?: string) {
  return new NextRequest("http://localhost/api/customers/c1/consent", {
    method: "POST",
    headers: { "x-user-id": "u1", "x-user-role": role, "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

const consent = { granted: true, clauseVersion: "v1", recordedAt: new Date("2026-10-07T15:00:00Z"), recordedByName: "Ana" };

describe("POST /api/customers/[id]/consent", () => {
  it("403s a tecnico before any service call", async () => {
    const record = vi.fn();
    const response = await handleRecordConsent(requestFor({ granted: true }, "tecnico"), "c1", { recordConsent: record });

    expect(response.status).toBe(403);
    expect(record).not.toHaveBeenCalled();
  });

  it("403s an unknown role", async () => {
    const record = vi.fn();
    const response = await handleRecordConsent(requestFor({ granted: true }, "ghost"), "c1", { recordConsent: record });

    expect(response.status).toBe(403);
    expect(record).not.toHaveBeenCalled();
  });

  it.each(["administrador", "jefe_taller"])("lets %s record a grant and passes the session user through", async (role) => {
    const record = vi.fn(async () => ({ changed: true, consent }));
    const response = await handleRecordConsent(requestFor({ granted: true }, role), "c1", { recordConsent: record });

    expect(response.status).toBe(200);
    expect(record).toHaveBeenCalledWith("c1", true, "u1");
    expect(await response.json()).toEqual({
      changed: true,
      consent: { ...consent, recordedAt: "2026-10-07T15:00:00.000Z" },
    });
  });

  it("passes a revoke through as granted:false", async () => {
    const record = vi.fn(async () => ({ changed: true, consent: { ...consent, granted: false } }));
    await handleRecordConsent(requestFor({ granted: false }), "c1", { recordConsent: record });

    expect(record).toHaveBeenCalledWith("c1", false, "u1");
  });

  it.each([{}, { granted: "true" }, { granted: 1 }, { granted: null }, []])(
    "400s a body whose granted is not a boolean (%j), never coercing it",
    async (body) => {
      const record = vi.fn();
      const response = await handleRecordConsent(requestFor(body), "c1", { recordConsent: record });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ errors: { granted: "Debe ser verdadero o falso" } });
      expect(record).not.toHaveBeenCalled();
    },
  );

  it("400s a body that is not JSON", async () => {
    const record = vi.fn();
    const response = await handleRecordConsent(requestFor(null, "administrador", "{nope"), "c1", { recordConsent: record });

    expect(response.status).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });

  it("maps a missing customer to 404 and a deactivated one to 409", async () => {
    const missing = await handleRecordConsent(requestFor({ granted: true }), "c1", {
      recordConsent: async () => {
        throw new ClienteNotFoundError("c1");
      },
    });
    const frozen = await handleRecordConsent(requestFor({ granted: true }), "c1", {
      recordConsent: async () => {
        throw new ClienteDeactivatedError("c1");
      },
    });

    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });
    expect(frozen.status).toBe(409);
    expect(await frozen.json()).toEqual({ error: "cliente_deactivated" });
  });

  it("rethrows an error it does not recognise", async () => {
    await expect(
      handleRecordConsent(requestFor({ granted: true }), "c1", {
        recordConsent: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
  });
});

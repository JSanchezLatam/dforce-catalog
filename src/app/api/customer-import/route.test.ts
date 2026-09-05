import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { InterfuerzaAbortError } from "@/shared/interfuerza/client";
import type { ImportResult } from "@/modules/customer-import/job";
import { handleCustomerImport, POST } from "./route";

function requestAs(role: string) {
  return new NextRequest("http://localhost/api/customer-import", {
    method: "POST",
    headers: { "x-user-id": "user-1", "x-user-role": role },
  });
}

describe("POST /api/customer-import — customers.write gating (R21)", () => {
  it("throws when called without session headers (proxy.ts did not validate)", async () => {
    const request = new NextRequest("http://localhost/api/customer-import", { method: "POST" });
    await expect(POST(request)).rejects.toThrow();
  });

  it("denies an unrecognised role without running the import", async () => {
    const runCustomerImport = vi.fn();

    const response = await handleCustomerImport(requestAs("unknown"), { runCustomerImport });

    expect(response.status).toBe(403);
    expect(runCustomerImport).not.toHaveBeenCalled();
  });

  it("runs the import for a role holding customers.write and returns its result", async () => {
    const result: ImportResult = {
      created: 2,
      updated: 1,
      skipped: [{ externalId: "9", name: "Sin Telefono", reason: "missing_phone" }],
    };
    const runCustomerImport = vi.fn().mockResolvedValue(result);

    const response = await handleCustomerImport(requestAs("administrador"), { runCustomerImport });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(runCustomerImport).toHaveBeenCalledTimes(1);
  });

  it("maps an aborted run (InterfuerzaAbortError) to a 502 naming the failure, never a bare 500", async () => {
    const runCustomerImport = vi.fn().mockRejectedValue(new InterfuerzaAbortError("customers page 3 failed after 3 attempts"));

    const response = await handleCustomerImport(requestAs("administrador"), { runCustomerImport });

    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/failed after 3 attempts/);
  });

  it("rethrows an unrecognised error rather than swallowing it", async () => {
    const runCustomerImport = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(handleCustomerImport(requestAs("administrador"), { runCustomerImport })).rejects.toThrow("boom");
  });
});

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { InterfuerzaAbortError } from "@/shared/interfuerza/client";
import { ImportAlreadyRunningError, type ImportResult } from "@/modules/customer-import/job";
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

  it("maps an aborted run (InterfuerzaAbortError) to a 502 with a Spanish message for staff, and logs the English detail", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const runCustomerImport = vi.fn().mockRejectedValue(new InterfuerzaAbortError("customers page 3 failed after 3 attempts"));

    const response = await handleCustomerImport(requestAs("administrador"), { runCustomerImport });

    expect(response.status).toBe(502);
    // AGENTS.md: error messages shown to staff are Spanish, never the raw
    // English diagnostic from shared/interfuerza/client.ts.
    const body = await response.json();
    expect(body.error).not.toMatch(/failed after 3 attempts/);
    // Pins the exact Spanish string the operator reads — not a loose pattern
    // that would pass for any wording containing "pudo" or "guardó". This is
    // the literal `CustomerImportButton.test.tsx` also pins on the UI side.
    expect(body.error).toBe(
      "No se pudo completar la importación. No se guardó ningún cambio; probá de nuevo más tarde.",
    );
    // The English detail is not deleted — it goes to the log instead, where
    // a failure stays diagnosable.
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("customer-import"), expect.stringContaining("failed after 3 attempts"));
    consoleError.mockRestore();
  });

  it("rethrows an unrecognised error rather than swallowing it", async () => {
    const runCustomerImport = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(handleCustomerImport(requestAs("administrador"), { runCustomerImport })).rejects.toThrow("boom");
  });

  it("maps a concurrent run (ImportAlreadyRunningError) to a 409 with a clear Rioplatense Spanish message — not a generic failure", async () => {
    const runCustomerImport = vi.fn().mockRejectedValue(new ImportAlreadyRunningError());

    const response = await handleCustomerImport(requestAs("administrador"), { runCustomerImport });

    expect(response.status).toBe(409);
    // Pins the exact Spanish string the operator reads, same convention as
    // the 502 message above — not a loose pattern that would also match a
    // generic "no se pudo" failure.
    expect((await response.json()).error).toBe(
      "Ya hay una importación de clientes en curso. Esperá a que termine antes de iniciar otra.",
    );
  });
});

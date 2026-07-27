import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Cliente } from "@/shared/db/schema";
import { handleCreateCliente, POST } from "./route";

const validInput = { name: "Juan Pérez", phone: "+52 55 1234 5678" };

function requestWith(body: unknown) {
  return new NextRequest("http://localhost/api/customers", {
    method: "POST",
    headers: { "x-user-id": "user-1", "x-user-role": "tecnico", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/customers (R16)", () => {
  it("throws when called without session headers (proxy.ts did not validate)", async () => {
    const request = new NextRequest("http://localhost/api/customers", {
      method: "POST",
      body: JSON.stringify(validInput),
    });
    await expect(POST(request)).rejects.toThrow();
  });

  it("creates the cliente and returns 201 on valid input", async () => {
    const insert = vi.fn().mockResolvedValue({ id: "c1", ...validInput, phone: "+525512345678" });

    const response = await handleCreateCliente(requestWith(validInput), {
      findByPhone: async () => null,
      insert,
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.cliente).toEqual({ id: "c1", name: "Juan Pérez", phone: "+525512345678" });
  });

  it("returns 400 with field errors on invalid input (R17)", async () => {
    const response = await handleCreateCliente(requestWith({ name: "" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors.name).toBeTruthy();
    expect(body.errors.phone).toBeTruthy();
  });

  it("returns 409 with a link to the existing customer on a duplicate phone (R18)", async () => {
    const response = await handleCreateCliente(requestWith(validInput), {
      findByPhone: async () => ({ id: "existing-1" }) as unknown as Cliente,
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.existingClienteId).toBe("existing-1");
  });
});

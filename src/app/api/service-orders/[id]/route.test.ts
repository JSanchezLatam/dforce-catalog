import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { OrdenServicio } from "@/shared/db/schema";
import { handleUpdateOrdenServicio, PATCH } from "./route";

function requestWith(body: unknown) {
  return new NextRequest("http://localhost/api/service-orders/o1", {
    method: "PATCH",
    headers: { "x-user-id": "user-1", "x-user-role": "usuario", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const current = {
  orden: { id: "o1", status: "open", clienteId: "cli-1", appointmentAt: null } as unknown as OrdenServicio,
  items: [],
};

function fakeDb(updated: Partial<OrdenServicio>) {
  return {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => [{ ...current.orden, ...updated }],
        }),
      }),
    }),
  };
}

describe("PATCH /api/service-orders/[id] (R21)", () => {
  it("throws when called without session headers", async () => {
    const request = new NextRequest("http://localhost/api/service-orders/o1", {
      method: "PATCH",
      body: JSON.stringify({ status: "in_progress" }),
    });
    await expect(PATCH(request, { params: Promise.resolve({ id: "o1" }) })).rejects.toThrow();
  });

  it("drives a valid status transition and returns 200", async () => {
    const response = await handleUpdateOrdenServicio(requestWith({ status: "in_progress" }), "o1", {
      getById: async () => current,
      db: fakeDb({ status: "in_progress" }) as never,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.orden.status).toBe("in_progress");
  });

  it("rejects an invalid transition with 400 (R21)", async () => {
    const response = await handleUpdateOrdenServicio(
      requestWith({ status: "done" }),
      "o1",
      { getById: async () => current },
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 for a missing order", async () => {
    const response = await handleUpdateOrdenServicio(requestWith({ status: "in_progress" }), "missing", {
      getById: async () => null,
    });
    expect(response.status).toBe(404);
  });

  it("updates plain fields (description/appointmentAt) without a status transition", async () => {
    const update = vi.fn();
    const response = await handleUpdateOrdenServicio(
      requestWith({ description: "Cambio de aceite" }),
      "o1",
      {
        getById: async () => current,
        db: {
          update: (...args: unknown[]) => {
            update(...args);
            return {
              set: () => ({
                where: () => ({ returning: async () => [{ ...current.orden, description: "Cambio de aceite" }] }),
              }),
            };
          },
        } as never,
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.orden.description).toBe("Cambio de aceite");
  });
});

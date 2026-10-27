import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { BoardOrderRow } from "@/modules/board/shape";
import * as route from "./route";
import { handleCustomerBoard } from "./route";

const req = (role: string) =>
  new NextRequest("http://localhost/api/board/clientes", { headers: { "x-user-id": "u-1", "x-user-role": role } });

// A source row poisoned in every field the customer view must never carry.
const ROW: BoardOrderRow = {
  id: "ORDER-ID-LEAK",
  status: "on_hold",
  esperaMotivo: "repuesto",
  updatedAt: new Date("2026-10-26T14:00:00Z"),
  appointmentAt: new Date("2026-10-27T14:00:00Z"),
  plate: "AB1234",
  make: "Toyota",
  model: "Hilux",
};
const NOW = new Date("2026-10-26T15:00:00Z");

describe("GET /api/board/clientes", () => {
  it.each(["administrador", "jefe_taller", "pantalla"])("%s gets 200 with the whitelist shape", async (role) => {
    const load = vi.fn().mockResolvedValue([ROW]);

    const response = await handleCustomerBoard(req(role), { load, now: () => NOW });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      generatedAt: "2026-10-26T15:00:00.000Z",
      rows: [{ plate: "AB1234", make: "Toyota", model: "Hilux", status: "En proceso" }],
    });
  });

  it("Técnico is denied the customer view: 403 JSON, and nothing is queried", async () => {
    const load = vi.fn();

    const response = await handleCustomerBoard(req("tecnico"), { load });

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(load).not.toHaveBeenCalled();
  });

  it("a database error is a JSON 5xx, never an HTML page", async () => {
    const load = vi.fn().mockRejectedValue(new Error("connection refused: secret-host"));

    const response = await handleCustomerBoard(req("pantalla"), { load });

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(JSON.stringify(await response.json())).not.toContain("secret-host");
  });

  it("exports GET only", () => {
    expect(Object.keys(route).filter((k) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(k))).toEqual(["GET"]);
  });
});

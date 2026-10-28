import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { KanbanData } from "@/modules/kanban/queries";
import * as route from "./route";
import { handleKanban } from "./route";

const req = (role: string, id = "u-1") => new NextRequest("http://localhost/api/kanban", { headers: { "x-user-id": id, "x-user-role": role } });

const NOW = new Date("2026-10-26T15:00:00Z");
const data: KanbanData = {
  rows: [
    {
      id: "ord-1",
      status: "on_hold",
      esperaMotivo: "repuesto",
      updatedAt: new Date("2026-10-26T14:00:00Z"),
      appointmentAt: null,
      urgenteAt: new Date("2026-10-26T14:10:00Z"),
      vehiculoId: "veh-1",
      categoria: "reparacion",
      plate: "AB1234",
      make: "Toyota",
      model: "Hilux",
    },
  ],
  techs: [{ ordenId: "ord-1", nombre: "Ana" }],
  since: [{ ordenId: "ord-1", changedAt: new Date("2026-10-26T14:30:00Z") }],
  viewer: { onRoster: true, ordenIds: ["ord-1"] },
};

describe("GET /api/kanban", () => {
  it.each(["administrador", "jefe_taller", "tecnico"])("%s gets 200 with the kanban shape", async (role) => {
    const load = vi.fn().mockResolvedValue(data);

    const response = await handleKanban(req(role, "viewer-7"), { load, now: () => NOW });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(load).toHaveBeenCalledWith("viewer-7", NOW);
    expect(await response.json()).toEqual({
      generatedAt: "2026-10-26T15:00:00.000Z",
      onRoster: true,
      rows: [
        {
          id: "ord-1",
          status: "on_hold",
          statusLabel: "En espera",
          plate: "AB1234",
          make: "Toyota",
          model: "Hilux",
          holdReason: "Repuesto",
          technicians: ["Ana"],
          statusSince: "2026-10-26T14:30:00.000Z",
          urgent: true,
          categoria: "reparacion",
          missing: [],
          mine: true,
        },
      ],
    });
  });

  it("Pantalla is denied: 403 JSON, and nothing is queried", async () => {
    const load = vi.fn();

    const response = await handleKanban(req("pantalla"), { load });

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(load).not.toHaveBeenCalled();
  });

  it("a database error is a JSON 500 that leaks nothing", async () => {
    const load = vi.fn().mockRejectedValue(new Error("connection refused: secret-host"));

    const response = await handleKanban(req("administrador"), { load });

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(JSON.stringify(await response.json())).not.toContain("secret-host");
  });

  it("exports GET only", () => {
    expect(Object.keys(route).filter((k) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(k))).toEqual(["GET"]);
  });
});

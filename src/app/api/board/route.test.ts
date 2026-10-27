import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { BoardOrderRow, BoardSinceRow, BoardTechRow } from "@/modules/board/shape";
import * as route from "./route";
import { handleBoard } from "./route";

const req = (role: string) => new NextRequest("http://localhost/api/board", { headers: { "x-user-id": "u-1", "x-user-role": role } });

// A source row poisoned in every field the board must never carry.
const ROW: BoardOrderRow = {
  id: "ORDER-ID-LEAK",
  status: "on_hold",
  esperaMotivo: "repuesto",
  updatedAt: new Date("2026-10-26T14:00:00Z"),
  appointmentAt: new Date("2026-10-27T14:00:00Z"),
  urgenteAt: null,
  vehiculoId: "VEHICLE-ID-LEAK",
  categoria: "reparacion",
  plate: "AB1234",
  make: "Toyota",
  model: "Hilux",
};
const TECHS: BoardTechRow[] = [{ ordenId: "ORDER-ID-LEAK", nombre: "Ana" }];
const SINCE: BoardSinceRow[] = [{ ordenId: "ORDER-ID-LEAK", changedAt: new Date("2026-10-26T14:30:00Z") }];
const NOW = new Date("2026-10-26T15:00:00Z");
const data = { rows: [ROW], techs: TECHS, since: SINCE };

describe("GET /api/board", () => {
  it.each(["administrador", "jefe_taller", "tecnico"])("%s gets 200 with the full-board whitelist shape", async (role) => {
    const load = vi.fn().mockResolvedValue(data);

    const response = await handleBoard(req(role), { load, now: () => NOW });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      generatedAt: "2026-10-26T15:00:00.000Z",
      rows: [
        {
          status: "on_hold",
          statusLabel: "En espera",
          plate: "AB1234",
          make: "Toyota",
          model: "Hilux",
          holdReason: "Repuesto",
          technicians: ["Ana"],
          statusSince: "2026-10-26T14:30:00.000Z",
          urgent: false,
        },
      ],
    });
  });

  it("Pantalla is denied the full board: 403 JSON, and nothing is queried", async () => {
    const load = vi.fn();

    const response = await handleBoard(req("pantalla"), { load });

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(load).not.toHaveBeenCalled();
  });

  it("a database error is a JSON 5xx, never an HTML page", async () => {
    const load = vi.fn().mockRejectedValue(new Error("connection refused: secret-host"));

    const response = await handleBoard(req("administrador"), { load });

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(JSON.stringify(await response.json())).not.toContain("secret-host");
  });

  it("exports GET only", () => {
    expect(Object.keys(route).filter((k) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(k))).toEqual(["GET"]);
  });
});

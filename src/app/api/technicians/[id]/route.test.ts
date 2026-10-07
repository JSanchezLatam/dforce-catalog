import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Tecnico } from "@/shared/db/schema";
import { TechnicianLinkError, TechnicianNotFoundError } from "@/modules/technicians/service";
import { handleUpdateTecnico } from "./route";

function req(role: string, body: unknown) {
  return new NextRequest("http://localhost/api/technicians/t-1", {
    method: "PATCH",
    headers: { "x-user-id": "u-1", "x-user-role": role, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const row: Tecnico = { id: "t-1", nombre: "Luis", userId: "u-9", deactivatedAt: null, createdAt: new Date("2026-10-07T12:00:00.000Z") };
const deps = (over: Record<string, unknown> = {}) => ({ updateTecnico: vi.fn().mockResolvedValue(row), ...over });

describe("PATCH /api/technicians/[id]", () => {
  it("denies a técnico with 403 before running anything", async () => {
    const d = deps();

    const response = await handleUpdateTecnico(req("tecnico", { nombre: "X" }), "t-1", d);

    expect(response.status).toBe(403);
    expect(d.updateTecnico).not.toHaveBeenCalled();
  });

  it("denies a jefe carrying userId (even null) with 403 and changes nothing", async () => {
    const d = deps();

    expect((await handleUpdateTecnico(req("jefe_taller", { userId: "u-9" }), "t-1", d)).status).toBe(403);
    expect((await handleUpdateTecnico(req("jefe_taller", { userId: null }), "t-1", d)).status).toBe(403);
    expect(d.updateTecnico).not.toHaveBeenCalled();
  });

  it("lets a jefe rename and deactivate", async () => {
    const d = deps();

    const response = await handleUpdateTecnico(req("jefe_taller", { nombre: "Luis R.", active: false }), "t-1", d);

    expect(response.status).toBe(200);
    expect(d.updateTecnico).toHaveBeenCalledWith({ role: "jefe_taller" }, "t-1", { nombre: "Luis R.", active: false });
    expect((await response.json()).technician).toMatchObject({ id: "t-1", userId: "u-9", deactivatedAt: null });
  });

  it("lets an administrador link: 200", async () => {
    const d = deps();

    const response = await handleUpdateTecnico(req("administrador", { userId: "u-9" }), "t-1", d);

    expect(response.status).toBe(200);
    expect(d.updateTecnico).toHaveBeenCalledWith({ role: "administrador" }, "t-1", { userId: "u-9" });
  });

  it("rejects a non-boolean active and a non-string userId with 400", async () => {
    const d = deps();

    expect((await handleUpdateTecnico(req("administrador", { active: "false" }), "t-1", d)).status).toBe(400);
    expect((await handleUpdateTecnico(req("administrador", { userId: 5 }), "t-1", d)).status).toBe(400);
    expect(d.updateTecnico).not.toHaveBeenCalled();
  });

  it("maps link conflicts to 409 and a missing row to 404", async () => {
    const run = (err: Error) =>
      handleUpdateTecnico(req("administrador", { userId: "u-9" }), "t-1", deps({ updateTecnico: vi.fn().mockRejectedValue(err) }));

    expect((await run(new TechnicianLinkError("Ese usuario ya está vinculado a otro técnico."))).status).toBe(409);
    expect((await run(new TechnicianNotFoundError())).status).toBe(404);
  });
});

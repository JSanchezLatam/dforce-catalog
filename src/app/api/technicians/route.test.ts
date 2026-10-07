import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Tecnico } from "@/shared/db/schema";
import { TechnicianForbiddenError, TechnicianLinkError, TechnicianValidationError } from "@/modules/technicians/service";
import { handleCreateTecnico } from "./route";

function req(role: string, body: unknown) {
  return new NextRequest("http://localhost/api/technicians", {
    method: "POST",
    headers: { "x-user-id": "u-1", "x-user-role": role, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Serialized exactly as it crosses the wire: dates are ISO strings after `response.json()`.
const created: Tecnico = { id: "t-1", nombre: "Luis", userId: null, deactivatedAt: null, createdAt: new Date("2026-10-07T12:00:00.000Z") };

const deps = (over: Record<string, unknown> = {}) => ({ createTecnico: vi.fn().mockResolvedValue(created), ...over });

describe("POST /api/technicians", () => {
  it("denies a técnico with 403 before running anything", async () => {
    const d = deps();

    const response = await handleCreateTecnico(req("tecnico", { nombre: "Luis" }), d);

    expect(response.status).toBe(403);
    expect(d.createTecnico).not.toHaveBeenCalled();
  });

  it("denies a jefe who carries userId with 403 before the service runs", async () => {
    const d = deps();

    const response = await handleCreateTecnico(req("jefe_taller", { nombre: "Luis", userId: "u-9" }), d);

    expect(response.status).toBe(403);
    expect(d.createTecnico).not.toHaveBeenCalled();
  });

  it("lets a jefe create an unlinked row: 201 and the session actor reaches the service", async () => {
    const d = deps();

    const response = await handleCreateTecnico(req("jefe_taller", { nombre: "Luis" }), d);

    expect(response.status).toBe(201);
    expect(d.createTecnico).toHaveBeenCalledWith({ role: "jefe_taller" }, { nombre: "Luis" });
    expect((await response.json()).technician).toMatchObject({ id: "t-1", nombre: "Luis", createdAt: "2026-10-07T12:00:00.000Z" });
  });

  it("lets an administrador create with a link", async () => {
    const d = deps();

    const response = await handleCreateTecnico(req("administrador", { nombre: "Luis", userId: "u-9" }), d);

    expect(response.status).toBe(201);
    expect(d.createTecnico).toHaveBeenCalledWith({ role: "administrador" }, { nombre: "Luis", userId: "u-9" });
  });

  it("maps service refusals: validation 400, link 409, forbidden 403", async () => {
    const run = (err: Error) =>
      handleCreateTecnico(req("administrador", { nombre: "x" }), deps({ createTecnico: vi.fn().mockRejectedValue(err) }));

    const validation = await run(new TechnicianValidationError({ nombre: "El nombre es obligatorio." }));
    expect(validation.status).toBe(400);
    expect(await validation.json()).toEqual({ errors: { nombre: "El nombre es obligatorio." } });

    const link = await run(new TechnicianLinkError("Ese usuario ya está vinculado a otro técnico."));
    expect(link.status).toBe(409);
    expect(await link.json()).toEqual({ error: "Ese usuario ya está vinculado a otro técnico." });

    expect((await run(new TechnicianForbiddenError())).status).toBe(403);
  });

  it("drops body keys outside the whitelist", async () => {
    const d = deps();

    await handleCreateTecnico(req("jefe_taller", { nombre: "Luis", id: "forged", deactivatedAt: "2020-01-01" }), d);

    expect(d.createTecnico).toHaveBeenCalledWith({ role: "jefe_taller" }, { nombre: "Luis" });
  });
});

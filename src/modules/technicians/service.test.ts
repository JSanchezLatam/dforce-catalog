import { describe, expect, it, vi } from "vitest";

import type { Tecnico } from "@/shared/db/schema";
import {
  createTecnico,
  TechnicianForbiddenError,
  TechnicianLinkError,
  TechnicianNotFoundError,
  TechnicianValidationError,
  updateTecnico,
} from "./service";

const admin = { role: "administrador" as const };
const jefe = { role: "jefe_taller" as const };

const row = (over: Partial<Tecnico> = {}): Tecnico => ({
  id: "t-1",
  nombre: "Luis",
  userId: null,
  deactivatedAt: null,
  createdAt: new Date("2026-10-07T12:00:00.000Z"),
  ...over,
});

function deps(overrides: Record<string, unknown> = {}) {
  return {
    insert: vi.fn(async (r: { nombre: string; userId: string | null }) => row({ nombre: r.nombre, userId: r.userId })),
    update: vi.fn(async (_id: string, set: Partial<Tecnico>) => row(set)),
    findByUserId: vi.fn(async () => null as { id: string } | null),
    findLinkableUser: vi.fn(async () => ({ role: "tecnico", deactivatedAt: null }) as { role: string; deactivatedAt: Date | null } | null),
    ...overrides,
  };
}

describe("createTecnico", () => {
  it("requires a non-blank nombre, in Spanish, and writes nothing", async () => {
    const d = deps();

    await expect(createTecnico(jefe, { nombre: "   " }, d)).rejects.toThrow(TechnicianValidationError);
    await expect(createTecnico(jefe, { nombre: "   " }, d)).rejects.toMatchObject({
      errors: { nombre: "El nombre es obligatorio." },
    });
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("trims the nombre and creates an unlinked row for a jefe", async () => {
    const d = deps();

    const created = await createTecnico(jefe, { nombre: "  Luis  " }, d);

    expect(d.insert).toHaveBeenCalledWith({ nombre: "Luis", userId: null });
    expect(created.nombre).toBe("Luis");
  });

  it("refuses a jefe who supplies a userId before touching anything", async () => {
    const d = deps();

    await expect(createTecnico(jefe, { nombre: "Luis", userId: "u-1" }, d)).rejects.toThrow(TechnicianForbiddenError);
    expect(d.insert).not.toHaveBeenCalled();
    expect(d.findByUserId).not.toHaveBeenCalled();
  });

  it("lets an administrador link a login", async () => {
    const d = deps();

    await createTecnico(admin, { nombre: "Luis", userId: "u-1" }, d);

    expect(d.insert).toHaveBeenCalledWith({ nombre: "Luis", userId: "u-1" });
  });

  it("refuses a link when the user is already linked, in Spanish", async () => {
    const d = deps({ findByUserId: vi.fn(async () => ({ id: "t-9" })) });

    await expect(createTecnico(admin, { nombre: "Luis", userId: "u-1" }, d)).rejects.toThrow(TechnicianLinkError);
    await expect(createTecnico(admin, { nombre: "Luis", userId: "u-1" }, d)).rejects.toMatchObject({
      message: "Ese usuario ya está vinculado a otro técnico.",
    });
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("refuses a link to a user that is missing, deactivated or not a técnico", async () => {
    for (const user of [null, { role: "administrador", deactivatedAt: null }, { role: "tecnico", deactivatedAt: new Date() }]) {
      const d = deps({ findLinkableUser: vi.fn(async () => user) });
      await expect(createTecnico(admin, { nombre: "Luis", userId: "u-1" }, d)).rejects.toMatchObject({
        message: "El usuario debe ser un técnico activo.",
      });
      expect(d.insert).not.toHaveBeenCalled();
    }
  });

  it("maps the DB unique violation (a concurrent link) to the same refusal", async () => {
    const d = deps({
      insert: vi.fn(async () => {
        throw Object.assign(new Error("dup"), { cause: { code: "23505" } });
      }),
    });

    await expect(createTecnico(admin, { nombre: "Luis", userId: "u-1" }, d)).rejects.toThrow(TechnicianLinkError);
  });
});

describe("updateTecnico", () => {
  it("renames, and refuses a blank nombre", async () => {
    const d = deps();

    await updateTecnico(jefe, "t-1", { nombre: " Luis R. " }, d);
    expect(d.update).toHaveBeenCalledWith("t-1", { nombre: "Luis R." });

    await expect(updateTecnico(jefe, "t-1", { nombre: " " }, deps())).rejects.toMatchObject({
      errors: { nombre: "El nombre es obligatorio." },
    });
  });

  it("deactivation sets deactivatedAt and reactivation clears it", async () => {
    const d = deps();

    await updateTecnico(jefe, "t-1", { active: false }, d);
    expect((d.update.mock.calls[0][1] as { deactivatedAt: Date }).deactivatedAt).toBeInstanceOf(Date);

    await updateTecnico(jefe, "t-1", { active: true }, d);
    expect(d.update.mock.calls[1][1]).toEqual({ deactivatedAt: null });
  });

  it("refuses a jefe carrying userId, even null, and changes nothing", async () => {
    const d = deps();

    await expect(updateTecnico(jefe, "t-1", { userId: null }, d)).rejects.toThrow(TechnicianForbiddenError);
    await expect(updateTecnico(jefe, "t-1", { userId: "u-1", nombre: "X" }, d)).rejects.toThrow(TechnicianForbiddenError);
    expect(d.update).not.toHaveBeenCalled();
  });

  it("lets an administrador link, unlink, and refuses a link held by another row", async () => {
    const d = deps();
    await updateTecnico(admin, "t-1", { userId: "u-1" }, d);
    await updateTecnico(admin, "t-1", { userId: null }, d);
    expect(d.update).toHaveBeenNthCalledWith(1, "t-1", { userId: "u-1" });
    expect(d.update).toHaveBeenNthCalledWith(2, "t-1", { userId: null });

    const held = deps({ findByUserId: vi.fn(async () => ({ id: "t-OTHER" })) });
    await expect(updateTecnico(admin, "t-1", { userId: "u-1" }, held)).rejects.toThrow(TechnicianLinkError);
    expect(held.update).not.toHaveBeenCalled();
  });

  it("re-linking the user a row already holds is not a conflict", async () => {
    const d = deps({ findByUserId: vi.fn(async () => ({ id: "t-1" })) });

    await updateTecnico(admin, "t-1", { userId: "u-1" }, d);

    expect(d.update).toHaveBeenCalledOnce();
  });

  it("throws not-found when the row does not exist", async () => {
    const d = deps({ update: vi.fn(async () => null) });

    await expect(updateTecnico(jefe, "ghost", { nombre: "X" }, d)).rejects.toThrow(TechnicianNotFoundError);
  });

  it("an empty patch is a validation error, not a silent no-op", async () => {
    await expect(updateTecnico(jefe, "t-1", {}, deps())).rejects.toThrow(TechnicianValidationError);
  });
});

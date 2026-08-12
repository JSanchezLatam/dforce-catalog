import { describe, expect, it, vi } from "vitest";

import {
  validateWorkshopConfigInput,
  getWorkshopConfig,
  saveWorkshopConfig,
  WorkshopConfigValidationError,
} from "./service";

describe("validateWorkshopConfigInput", () => {
  it("accepts a valid name", () => {
    expect(validateWorkshopConfigInput({ name: "Mi Taller" })).toEqual({ name: "Mi Taller" });
  });

  it("trims whitespace from name", () => {
    expect(validateWorkshopConfigInput({ name: "  Taller  " })).toEqual({ name: "Taller" });
  });

  it("rejects a name that is too long", () => {
    expect(() => validateWorkshopConfigInput({ name: "x".repeat(101) })).toThrow();
  });

  it("accepts an empty input (no name)", () => {
    expect(validateWorkshopConfigInput({})).toEqual({ name: null });
  });

  it.each(["phone", "whatsapp", "email", "address", "hours", "website", "coverText"])(
    "accepts %s independently",
    (field) => {
      const result = validateWorkshopConfigInput({ [field]: "some value" }) as Record<string, unknown>;
      expect(result[field]).toBe("some value");
    },
  );

  it("stores hours verbatim with no per-day parsing", () => {
    const result = validateWorkshopConfigInput({ hours: "Lun-Vie 9-18, Sáb 9-13" });
    expect(result.hours).toBe("Lun-Vie 9-18, Sáb 9-13");
  });

  it("accepts socialHandles with an arbitrary platform key", () => {
    const result = validateWorkshopConfigInput({ socialHandles: { instagram: "@mitaller", tiktok: "@mitaller" } });
    expect(result.socialHandles).toEqual({ instagram: "@mitaller", tiktok: "@mitaller" });
  });

  it.each(["phone", "whatsapp", "email", "address", "hours", "website", "coverText"])(
    "collapses an empty %s to null instead of persisting an empty string",
    (field) => {
      const result = validateWorkshopConfigInput({ [field]: "" }) as Record<string, unknown>;
      expect(result[field]).toBeNull();
    },
  );

  it("ignores a non-string contact field instead of coercing it with String()", () => {
    const result = validateWorkshopConfigInput({ phone: { not: "a string" } }) as Record<string, unknown>;
    expect(result).not.toHaveProperty("phone");
  });

  it("rejects a coverText over the length cap", () => {
    expect(() => validateWorkshopConfigInput({ coverText: "x".repeat(501) })).toThrow();
  });

  it("gives a Spanish message when coverText is over the length cap", () => {
    try {
      validateWorkshopConfigInput({ coverText: "x".repeat(501) });
      expect.unreachable();
    } catch (err) {
      expect((err as WorkshopConfigValidationError).errors.coverText).toMatch(/500 caracteres/);
    }
  });

  it("ignores socialHandles when it is not a plain object (string)", () => {
    const result = validateWorkshopConfigInput({ socialHandles: "instagram" }) as Record<string, unknown>;
    expect(result).not.toHaveProperty("socialHandles");
  });

  it("ignores socialHandles when it is an array", () => {
    const result = validateWorkshopConfigInput({ socialHandles: [1, 2, 3] }) as Record<string, unknown>;
    expect(result).not.toHaveProperty("socialHandles");
  });

  it("drops individual socialHandles entries whose value is not a string", () => {
    const result = validateWorkshopConfigInput({
      socialHandles: { instagram: "@mitaller", tiktok: { nested: true } },
    });
    expect(result.socialHandles).toEqual({ instagram: "@mitaller" });
  });

  it("drops a socialHandles entry left blank instead of persisting an empty handle", () => {
    const result = validateWorkshopConfigInput({ socialHandles: { instagram: "@mitaller", facebook: "" } });
    expect(result.socialHandles).toEqual({ instagram: "@mitaller" });
  });

  it.each(["phone", "whatsapp", "email", "address", "hours", "website"])(
    "rejects %s over the shared contact-field length cap",
    (field) => {
      expect(() => validateWorkshopConfigInput({ [field]: "x".repeat(201) })).toThrow();
    },
  );

  it("drops a socialHandles entry whose platform key is whitespace-only", () => {
    const result = validateWorkshopConfigInput({ socialHandles: { "   ": "@mitaller", instagram: "@real" } });
    expect(result.socialHandles).toEqual({ instagram: "@real" });
  });

  it("trims a socialHandles platform key before persisting it", () => {
    const result = validateWorkshopConfigInput({ socialHandles: { "  instagram  ": "@mitaller" } });
    expect(result.socialHandles).toEqual({ instagram: "@mitaller" });
  });

  it("rejects socialHandles over the entry-count cap instead of silently truncating it", () => {
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`platform${i}`, `@handle${i}`]));
    expect(() => validateWorkshopConfigInput({ socialHandles: many })).toThrow();
  });

  it("gives a Spanish message when socialHandles is over the entry-count cap", () => {
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`platform${i}`, `@handle${i}`]));
    try {
      validateWorkshopConfigInput({ socialHandles: many });
      expect.unreachable();
    } catch (err) {
      expect((err as WorkshopConfigValidationError).errors.socialHandles).toMatch(/20/);
    }
  });

  it("rejects a socialHandles entry over the per-entry length cap instead of silently dropping it", () => {
    expect(() =>
      validateWorkshopConfigInput({ socialHandles: { instagram: "x".repeat(101) } }),
    ).toThrow();
  });
});

describe("getWorkshopConfig", () => {
  it("returns null when no config has been saved", async () => {
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }) };
    const result = await getWorkshopConfig(db as never);
    expect(result).toBeNull();
  });

  it("returns the saved config row", async () => {
    const row = { id: "singleton", name: "Mi Taller", logoR2Key: null, logoContentType: null, updatedAt: new Date() };
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([row]) }) }) }) };
    const result = await getWorkshopConfig(db as never);
    expect(result).toEqual(row);
  });
});

describe("saveWorkshopConfig", () => {
  it("inserts with onConflictDoUpdate returning the saved row", async () => {
    const row = { id: "singleton", name: "Taller", logoR2Key: null, logoContentType: null, updatedAt: new Date() };
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([row]) }) });
    const db = { insert: vi.fn().mockReturnValue({ values } as never) } as never;
    const result = await saveWorkshopConfig({ name: "Taller" }, db);
    expect(result).toEqual(row);
  });

  it("persists logoR2Key and logoContentType on both the insert values and the onConflictDoUpdate set clause", async () => {
    const row = { id: "singleton", name: "Taller", logoR2Key: "logos/abc.png", logoContentType: "image/png", updatedAt: new Date() };
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([row]) });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const db = { insert: vi.fn().mockReturnValue({ values } as never) } as never;

    await saveWorkshopConfig({ name: "Taller", logoR2Key: "logos/abc.png", logoContentType: "image/png" }, db);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ logoR2Key: "logos/abc.png", logoContentType: "image/png" }));
    const onConflictArg = onConflictDoUpdate.mock.calls[0][0] as { set: Record<string, unknown> };
    expect(onConflictArg.set).toEqual(expect.objectContaining({ logoR2Key: "logos/abc.png", logoContentType: "image/png" }));
  });

  it("does NOT include logoR2Key/logoContentType in the update set when saving name only, so an existing logo is never clobbered", async () => {
    const row = { id: "singleton", name: "Taller Nuevo", logoR2Key: "logos/existing.png", logoContentType: "image/png", updatedAt: new Date() };
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([row]) });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const db = { insert: vi.fn().mockReturnValue({ values } as never) } as never;

    await saveWorkshopConfig({ name: "Taller Nuevo" }, db);

    const onConflictArg = onConflictDoUpdate.mock.calls[0][0] as { set: Record<string, unknown> };
    expect(onConflictArg.set).not.toHaveProperty("logoR2Key");
    expect(onConflictArg.set).not.toHaveProperty("logoContentType");
  });

  it("persists a new contact field without touching other already-set fields (partial update)", async () => {
    const row = { id: "singleton", name: "Taller", phone: "555-1234", email: "old@taller.com", updatedAt: new Date() };
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([row]) });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const db = { insert: vi.fn().mockReturnValue({ values } as never) } as never;

    await saveWorkshopConfig({ name: "Taller", phone: "555-1234" }, db);

    const onConflictArg = onConflictDoUpdate.mock.calls[0][0] as { set: Record<string, unknown> };
    expect(onConflictArg.set).toEqual(expect.objectContaining({ phone: "555-1234" }));
    expect(onConflictArg.set).not.toHaveProperty("email");
    expect(onConflictArg.set).not.toHaveProperty("coverText");
    expect(onConflictArg.set).not.toHaveProperty("socialHandles");
  });

  it("explicitly clears logoR2Key/logoContentType when null is passed (DELETE flow)", async () => {
    const row = { id: "singleton", name: "Taller", logoR2Key: null, logoContentType: null, updatedAt: new Date() };
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([row]) });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const db = { insert: vi.fn().mockReturnValue({ values } as never) } as never;

    await saveWorkshopConfig({ name: "Taller", logoR2Key: null, logoContentType: null }, db);

    const onConflictArg = onConflictDoUpdate.mock.calls[0][0] as { set: Record<string, unknown> };
    expect(onConflictArg.set).toEqual(expect.objectContaining({ logoR2Key: null, logoContentType: null }));
  });
});

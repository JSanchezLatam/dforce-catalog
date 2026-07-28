import { describe, expect, it, vi } from "vitest";

import { validateWorkshopConfigInput, getWorkshopConfig, saveWorkshopConfig } from "./service";

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

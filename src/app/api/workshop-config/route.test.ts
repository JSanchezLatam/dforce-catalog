import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

const { mockGetConfig, mockSaveConfig, WorkshopConfigValidationError } = vi.hoisted(() => {
  const WCE = class extends Error {
    constructor(public readonly errors: Record<string, string>) {
      super("Invalid workshop config");
    }
  };
  return {
    mockGetConfig: vi.fn(),
    mockSaveConfig: vi.fn(),
    WorkshopConfigValidationError: WCE,
  };
});

vi.mock("@/modules/workshop-config/service", () => ({
  getWorkshopConfig: (...args: unknown[]) => mockGetConfig(...args),
  saveWorkshopConfig: (...args: unknown[]) => {
    const input = args[0] as { name?: string };
    if (input.name && input.name.length > 100) {
      throw new WorkshopConfigValidationError({ name: "El nombre no puede superar los 100 caracteres" });
    }
    return mockSaveConfig(...args);
  },
  validateWorkshopConfigInput: vi.fn(),
  WorkshopConfigValidationError,
}));

function req(role: string, options?: { method?: string; body?: string }) {
  return new NextRequest("http://localhost/api/workshop-config", {
    method: options?.method,
    body: options?.body,
    headers: { "x-user-id": "user-1", "x-user-role": role },
  });
}

describe("workshop-config route", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET — workshop.read (both roles)", () => {
    it("returns the config when one exists", async () => {
      const config = { id: "singleton", name: "Mi Taller", logoR2Key: null, logoContentType: null, updatedAt: new Date().toISOString() };
      mockGetConfig.mockResolvedValue({ ...config, updatedAt: new Date(config.updatedAt) });

      const res = await GET(req("administrador"));
      expect(res.status).toBe(200);
      expect((await res.json()).config).toEqual(config);
    });

    it("returns null when unsaved", async () => {
      mockGetConfig.mockResolvedValue(null);

      const res = await GET(req("tecnico"));
      expect(res.status).toBe(200);
      expect((await res.json()).config).toBeNull();
    });

    it("is accessible by both roles", async () => {
      mockGetConfig.mockResolvedValue(null);

      const [a, t] = await Promise.all([GET(req("administrador")), GET(req("tecnico"))]);
      expect(a.status).toBe(200);
      expect(t.status).toBe(200);
    });
  });

  describe("POST — workshop.edit (admin only)", () => {
    it("saves valid config for admin", async () => {
      const saved = { id: "singleton", name: "Taller", logoR2Key: null, logoContentType: null, updatedAt: new Date().toISOString() };
      mockSaveConfig.mockResolvedValue({ ...saved, updatedAt: new Date(saved.updatedAt) });

      const res = await POST(req("administrador", { method: "POST", body: JSON.stringify({ name: "Taller" }) }));
      expect(res.status).toBe(200);
      expect((await res.json()).config).toEqual(saved);
    });

    it("rejects tecnico with 403", async () => {
      const res = await POST(req("tecnico", { method: "POST", body: "{}" }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Forbidden" });
    });

    it("returns 400 for invalid input", async () => {
      const res = await POST(req("administrador", { method: "POST", body: JSON.stringify({ name: "x".repeat(101) }) }));
      expect(res.status).toBe(400);
    });

    it("throws when called without session headers", async () => {
      const r = new NextRequest("http://localhost/api/workshop-config");
      await expect(GET(r)).rejects.toThrow();
    });
  });
});

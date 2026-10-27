import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

const requireSessionFromHeaders = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders }));

import Home from "./page";

describe("/ — Landing per role", () => {
  beforeEach(() => redirect.mockClear());

  it.each([
    ["pantalla", "/tablero/clientes"],
    ["administrador", "/inventory"],
    ["jefe_taller", "/inventory"],
    ["tecnico", "/inventory"],
  ])("sends %s to %s", async (role, path) => {
    requireSessionFromHeaders.mockResolvedValue({ id: "u1", role });

    await Home();

    expect(redirect).toHaveBeenCalledWith(path);
  });
});

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const authenticateUser = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/authenticate", () => ({ authenticateUser }));

import { POST } from "./route";

const login = () =>
  POST(new NextRequest("http://192.168.0.7:3000/api/login", { method: "POST", body: JSON.stringify({ username: "u", password: "p" }) }));

describe("POST /api/login", () => {
  it("Cookie follows expiry: the session cookie expires with the issued session", async () => {
    const expiresAt = new Date("2027-04-24T15:00:00.000Z");
    authenticateUser.mockResolvedValue({ ok: true, token: "t", expiresAt, role: "pantalla" });

    const cookie = (await login()).cookies.get("session");

    expect(cookie?.value).toBe("t");
    expect(cookie?.expires).toEqual(expiresAt);
  });

  it("refuses bad credentials with 401 and sets no cookie", async () => {
    authenticateUser.mockResolvedValue({ ok: false });

    const response = await login();

    expect(response.status).toBe(401);
    expect(response.cookies.get("session")).toBeUndefined();
  });
});

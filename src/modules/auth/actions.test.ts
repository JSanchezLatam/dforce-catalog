import { describe, expect, it, vi } from "vitest";

// `actions.ts` imports these at module load even on the path under test, and
// both throw outside a request scope.
const set = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({ set }) }));
vi.mock("next/navigation", () => ({ redirect }));

const authenticateUser = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/authenticate", () => ({ authenticateUser }));

import { loginAction } from "./actions";

describe("loginAction", () => {
  /**
   * The refusal is rendered verbatim into `LoginForm`'s `role="alert"`, so it
   * is UI copy and AGENTS.md requires Spanish. Nothing asserted this string in
   * EITHER language before, which is how an English alert survived under a
   * Spanish label, placeholder and button.
   */
  it("refuses a bad credential in Spanish", async () => {
    authenticateUser.mockResolvedValue({ ok: false });

    const state = await loginAction(null, new FormData());

    expect(state).toEqual({ error: "Usuario o contraseña incorrectos." });
  });

  it.each([
    ["pantalla", "/tablero/clientes"],
    ["tecnico", "/inventory"],
  ])("Landing per role: a %s login redirects to %s", async (role, path) => {
    authenticateUser.mockResolvedValue({ ok: true, token: "t", expiresAt: new Date(), role });
    redirect.mockClear();

    await loginAction(null, new FormData());

    expect(redirect).toHaveBeenCalledWith(path);
  });

  // Cookie follows expiry: a pantalla screen keeps its cookie as long as its 180-day session row.
  it("Cookie follows expiry: the session cookie expires with the issued session", async () => {
    const expiresAt = new Date("2027-04-24T15:00:00.000Z");
    authenticateUser.mockResolvedValue({ ok: true, token: "t", expiresAt, role: "pantalla" });
    set.mockClear();

    await loginAction(null, new FormData());

    expect(set).toHaveBeenCalledWith("session", "t", expect.objectContaining({ expires: expiresAt }));
  });

  // The no-enumeration property (R9.1/9.2) is NOT tested here. It lives in
  // `authenticateUser`, which has three failure causes to keep identical —
  // unknown username, wrong password, deactivated account — and
  // `authenticate.test.ts` already pins it ("generic failure (no
  // enumeration)" and "shape parity"). A copy of that guard at this layer
  // would see only the single `{ ok: false }` this file mocks, so it could
  // never fail on its own. The first attempt at one here was exactly that:
  // it passed while `"Contraseña incorrecta."` — a real oracle — was in the
  // string.
});

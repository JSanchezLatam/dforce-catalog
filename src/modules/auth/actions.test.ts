import { describe, expect, it, vi } from "vitest";

// `actions.ts` imports these at module load even on the path under test, and
// both throw outside a request scope.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

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

  /**
   * R9.1/9.2 — the refusal must not say WHICH half was wrong, or it becomes a
   * username oracle. Pinned here because translating the string is exactly the
   * moment someone helpfully makes it specific.
   */
  it("does not reveal whether the username exists", async () => {
    authenticateUser.mockResolvedValue({ ok: false });

    const state = await loginAction(null, new FormData());

    expect(state?.error).not.toMatch(/usuario no existe|no encontrado|contraseña incorrecta$/i);
  });
});

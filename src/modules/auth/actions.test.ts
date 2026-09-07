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

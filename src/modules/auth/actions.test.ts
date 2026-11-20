import { describe, expect, it, vi } from "vitest";

// `actions.ts` imports these at module load even on the path under test, and
// both throw outside a request scope.
const set = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ set }),
  headers: vi.fn().mockResolvedValue(new Headers({ "x-forwarded-for": "192.168.1.23" })),
}));
vi.mock("next/navigation", () => ({ redirect }));

const authenticateUser = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/authenticate", () => ({ authenticateUser }));

import { loginAction } from "./actions";
import { UNTIL_UNLOCKED } from "./login-lock";

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

  it("passes the client IP to the credential check", async () => {
    authenticateUser.mockResolvedValue({ ok: false });
    const form = new FormData();
    form.set("username", "ana");
    form.set("password", "clave");

    await loginAction(null, form);

    expect(authenticateUser).toHaveBeenLastCalledWith("ana", "clave", { ip: "192.168.1.23" });
  });

  it.each([
    [14 * 60_000 + 1, "15 minutos"],
    [30_000, "1 minuto"],
  ])("explains a lock with the minutes left", async (remaining, text) => {
    vi.useFakeTimers({ now: new Date("2026-11-18T12:00:00.000Z"), toFake: ["Date"] });
    authenticateUser.mockResolvedValue({ ok: false, lockedUntil: new Date(Date.now() + remaining) });
    const form = new FormData();
    form.set("username", "ana");

    const state = await loginAction(null, form);
    vi.useRealTimers();

    expect(state).toEqual({
      error: "Demasiados intentos fallidos.",
      detail: `Por seguridad, el acceso quedó bloqueado. Intentá de nuevo en ${text} o pedí al administrador que te desbloquee.`,
      lockedUsername: "ana",
      retryAt: new Date("2026-11-18T12:00:00.000Z").getTime() + remaining,
    });
  });

  it("sends a login locked until an unlock to the administrator, with no time to wait", async () => {
    authenticateUser.mockResolvedValue({ ok: false, lockedUntil: UNTIL_UNLOCKED });

    const state = await loginAction(null, new FormData());

    expect(state).toEqual({
      error: "Demasiados intentos fallidos.",
      detail: "Por seguridad, el acceso quedó bloqueado. Pedí al administrador que te desbloquee.",
    });
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

  // A right password for a 2FA user is only half a login (T6).
  it("sends a pending verify login to the code screen, not the role's landing", async () => {
    const expiresAt = new Date("2026-11-20T12:10:00.000Z");
    authenticateUser.mockResolvedValue({ ok: true, token: "p", expiresAt, role: "administrador", pending: "verify" });
    redirect.mockClear();
    set.mockClear();

    await loginAction(null, new FormData());

    expect(redirect).toHaveBeenCalledWith("/two-factor");
    expect(set).toHaveBeenCalledWith("session", "p", expect.objectContaining({ expires: expiresAt }));
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

import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleLogin } from "./login";
import { THROTTLED, WRONG_PASSWORD } from "./messages";
import { verifySession } from "./session";
import type { ThrottleStore } from "./throttle";

const PASSWORD = "the-shared-password";
const SECRET = "session-secret";
const NOW = 1_800_000_000;

let store: { [K in keyof ThrottleStore]: ReturnType<typeof vi.fn<ThrottleStore[K]>> };
let locked: boolean;

beforeEach(() => {
  vi.stubEnv("SUPPORT_PASSWORD", PASSWORD);
  vi.stubEnv("SUPPORT_SESSION_SECRET", SECRET);
  locked = false;
  store = {
    isLocked: vi.fn(async () => locked),
    recordFailure: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  };
});

const login = (body: unknown, ip = "203.0.113.7") =>
  handleLogin(
    new Request("http://portal.test/api/support/login", {
      method: "POST",
      headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { store, now: () => NOW * 1000 },
  );

describe("handleLogin", () => {
  it("a correct password sets the session cookie, clears the counter and answers 200", async () => {
    const res = await login({ password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    const [pair, ...attrs] = cookie.split("; ");
    expect(attrs).toEqual(["Max-Age=43200", "Path=/", "HttpOnly", "Secure", "SameSite=Strict"]);
    expect(verifySession(pair.split("=")[1], SECRET, NOW)).toBe(true);
    expect(store.clear).toHaveBeenCalledExactlyOnceWith("203.0.113.7");
    expect(store.recordFailure).not.toHaveBeenCalled();
  });

  it("a wrong password answers 401 'Contraseña incorrecta.', sets no cookie and counts one failure", async () => {
    const res = await login({ password: "nope" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Contraseña incorrecta." });
    expect(WRONG_PASSWORD).toBe("Contraseña incorrecta.");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(store.recordFailure).toHaveBeenCalledExactlyOnceWith("203.0.113.7");
    expect(store.clear).not.toHaveBeenCalled();
  });

  it.each([["not json"], [{}], [{ password: 42 }], [null]])("an unreadable or password-less body %j is a wrong password, not a crash", async (body) => {
    const res = await login(body);
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(store.recordFailure).toHaveBeenCalledTimes(1);
  });

  it("a locked IP is refused with the throttle message even with the correct password", async () => {
    locked = true;
    const res = await login({ password: PASSWORD });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Demasiados intentos. Probá de nuevo en unos minutos." });
    expect(THROTTLED).toBe("Demasiados intentos. Probá de nuevo en unos minutos.");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(store.clear).not.toHaveBeenCalled();
  });

  it("a locked IP with a wrong password does not extend the lock", async () => {
    locked = true;
    expect((await login({ password: "nope" })).status).toBe(429);
    expect(store.recordFailure).not.toHaveBeenCalled();
  });

  it("keys the throttle by the first x-forwarded-for hop", async () => {
    await login({ password: "nope" }, "198.51.100.9");
    expect(store.isLocked).toHaveBeenCalledWith("198.51.100.9");
    expect(store.recordFailure).toHaveBeenCalledWith("198.51.100.9");
  });

  it.each(["SUPPORT_PASSWORD", "SUPPORT_SESSION_SECRET"])("fails closed with %s unset: 503, no cookie, nothing counted", async (name) => {
    vi.stubEnv(name, "");
    const res = await login({ password: PASSWORD });
    expect(res.status).toBe(503);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(store.recordFailure).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
  });
});

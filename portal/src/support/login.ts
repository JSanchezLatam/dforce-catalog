import { THROTTLED, WRONG_PASSWORD } from "./messages";
import { passwordMatches, sessionCookie, signSession } from "./session";
import { clientIp, dbThrottleStore, type ThrottleStore } from "./throttle";

export interface LoginDeps {
  store: ThrottleStore;
  now: () => number;
}

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function handleLogin(
  request: Request,
  { store, now }: LoginDeps = { store: dbThrottleStore, now: Date.now },
): Promise<Response> {
  const expected = process.env.SUPPORT_PASSWORD;
  const secret = process.env.SUPPORT_SESSION_SECRET;
  // Not configured: nobody gets in, and nothing is counted against the caller.
  if (!expected || !secret) return reply(503, { error: "unavailable" });

  const ip = clientIp(request);
  // The lock wins over a correct password, and a locked attempt is not counted (no extension).
  if (await store.isLocked(ip)) return reply(429, { error: THROTTLED });

  const body: unknown = await request.json().catch(() => null);
  const given = typeof (body as { password?: unknown } | null)?.password === "string" ? (body as { password: string }).password : "";
  if (!passwordMatches(given, expected)) {
    await store.recordFailure(ip);
    return reply(401, { error: WRONG_PASSWORD });
  }

  await store.clear(ip);
  return reply(200, { ok: true }, { "Set-Cookie": sessionCookie(signSession(secret, Math.floor(now() / 1000))) });
}

import { rateLimited } from "../rate-limit";

const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};
const MAX_BODY = 2048;

export const reply = (status: number, body: unknown) => Response.json(body, { status, headers: HEADERS });

/** The ONE response for every bad token: no branching on why. */
export const invalid = () => reply(404, { state: "invalid" });

/**
 * Shared gate for the three /api/c routes: rate limit, then the token from the JSON
 * body (never the URL). Nothing here logs the request.
 */
export async function withToken(request: Request, run: (token: string) => Promise<Response>): Promise<Response> {
  if (rateLimited(request)) return reply(429, { error: "too many requests" });
  const raw = await request.text();
  let token: unknown;
  try {
    if (raw.length <= MAX_BODY) token = (JSON.parse(raw) as { token?: unknown } | null)?.token;
  } catch {
    // falls through to the 400 below
  }
  if (typeof token !== "string") return reply(400, { error: "invalid body" });
  return run(token);
}

import { isIP } from "node:net";

/**
 * shortcut: Next keeps a client-supplied `x-forwarded-for` on the direct LAN
 * deployment, so this address is best-effort. Trust it fully only behind a proxy
 * that overwrites the header.
 */
export function clientIp(headers: Headers): string | null {
  const first = headers.get("x-forwarded-for")?.split(",")[0].trim().replace(/^::ffff:/i, "");
  return first && isIP(first) ? first : null;
}

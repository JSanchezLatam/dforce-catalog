import { isIP } from "node:net";

/** Reads the header `installTrustedClientAddress` has already set from the connection. */
export function clientIp(headers: Headers): string | null {
  const first = headers.get("x-forwarded-for")?.split(",")[0].trim().replace(/^::ffff:/i, "");
  return first && isIP(first) ? first : null;
}

import { BlockList, isIP } from "node:net";

// Private ranges and loopback: the workshop's own network and the server itself.
const WORKSHOP = new BlockList();
WORKSHOP.addSubnet("10.0.0.0", 8);
WORKSHOP.addSubnet("172.16.0.0", 12);
WORKSHOP.addSubnet("192.168.0.0", 16);
WORKSHOP.addSubnet("127.0.0.0", 8);
WORKSHOP.addSubnet("fc00::", 7, "ipv6");
WORKSHOP.addSubnet("fe80::", 10, "ipv6");
WORKSHOP.addAddress("::1", "ipv6");

/** "Origen" in Registro de accesos. */
export function originOf(ip: string | null): string {
  const version = ip ? isIP(ip) : 0;
  if (!ip || !version) return "—";
  return `${WORKSHOP.check(ip, version === 6 ? "ipv6" : "ipv4") ? "Red del taller" : "Internet"} · ${ip}`;
}

/** Reads the header `installTrustedClientAddress` has already set from the connection. */
export function clientIp(headers: Headers): string | null {
  const first = headers.get("x-forwarded-for")?.split(",")[0].trim().replace(/^::ffff:/i, "");
  return first && isIP(first) ? first : null;
}

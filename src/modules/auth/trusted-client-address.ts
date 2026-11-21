import http from "node:http";
import { isIP } from "node:net";
import type { TLSSocket } from "node:tls";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const INSTALLED = Symbol.for("dforce.trustedClientAddress");

type TrustedServerPrototype = typeof http.Server.prototype & { [INSTALLED]?: true };

/**
 * The address the app may believe. A loopback peer can only be a proxy running
 * on the server itself (the HTTPS tunnel); any other peer is the client, whose
 * own headers prove nothing.
 *
 * From the proxy, only what the proxy itself set counts (B1, L57): Cloudflare
 * overwrites `CF-Connecting-IP` with the real client, and appends that client
 * to whatever `X-Forwarded-For` the client sent, so the FIRST element of that
 * list is the client's own choice and the LAST is the proxy's.
 */
export function trustedForwardedFor(
  socketAddress: string | undefined,
  header: string | undefined,
  cfConnectingIp?: string,
): string | undefined {
  if (!socketAddress || !LOOPBACK.has(socketAddress)) return socketAddress;
  const cloudflare = cfConnectingIp?.trim();
  if (cloudflare && isIP(cloudflare)) return cloudflare;
  return header?.split(",").at(-1)?.trim() || undefined;
}

/**
 * The protocol the app may believe, by the same rule as the address: only a
 * proxy on the server itself (the HTTPS tunnel) may say the request was https.
 */
export function trustedForwardedProto(
  socketAddress: string | undefined,
  header: string | undefined,
  encrypted: boolean,
): string {
  if (socketAddress && LOOPBACK.has(socketAddress) && header) return header;
  return encrypted ? "https" : "http";
}

/** Next keeps a client-sent `x-forwarded-for` and `x-forwarded-proto`, so both are corrected before Next reads the request. */
export function installTrustedClientAddress(): void {
  const prototype = http.Server.prototype as TrustedServerPrototype;
  if (prototype[INSTALLED]) return;
  prototype[INSTALLED] = true;

  const emit = prototype.emit;
  prototype.emit = function patchedEmit(this: http.Server, event: string | symbol, ...args: unknown[]) {
    if (event === "request") {
      const request = args[0] as http.IncomingMessage;
      const address = trustedForwardedFor(
        request.socket.remoteAddress,
        request.headers["x-forwarded-for"] as string | undefined,
        request.headers["cf-connecting-ip"] as string | undefined,
      );
      if (address) request.headers["x-forwarded-for"] = address;
      else delete request.headers["x-forwarded-for"];
      request.headers["x-forwarded-proto"] = trustedForwardedProto(
        request.socket.remoteAddress,
        request.headers["x-forwarded-proto"] as string | undefined,
        Boolean((request.socket as TLSSocket).encrypted),
      );
    }
    return Reflect.apply(emit, this, [event, ...args]) as boolean;
  } as typeof prototype.emit;
}

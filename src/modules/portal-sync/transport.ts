/**
 * portal-sync/transport.ts — the one HTTP edge to the customer portal
 * (customer-portal WU5a, spec "Signed Transport"). Signs with the same
 * `sign()` the portal's `verify()` checks, through the `@portal/contract` alias.
 *
 * Error contract for the pg-boss worker: anything thrown that is NOT a
 * `PortalRejectedError` (network error, timeout, 5xx) is retried; a
 * `PortalRejectedError` (4xx, refused URL) never succeeds by waiting.
 */
import { sign, type IngestBody } from "@portal/contract";

export class PortalRejectedError extends Error {
  /** The HTTP status; absent for a refused URL, which never reached the network. */
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "PortalRejectedError";
  }
}

/** A 5xx: retried by waiting, unlike `PortalRejectedError`. */
export class PortalServerError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "PortalServerError";
  }
}

export type PortalConfig = { url: string; secret: string };

const REQUEST_TIMEOUT_MS = 15_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** `https:` always; plain `http:` only for the local dev portal. Exact host match, never a prefix. */
function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PortalRejectedError("portal-sync: PORTAL_INGEST_URL is not a valid URL");
  }
  if (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) return url;
  throw new PortalRejectedError("portal-sync: PORTAL_INGEST_URL must be https (http is allowed only for localhost)");
}

export async function sendToPortal(
  body: IngestBody,
  config: PortalConfig,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<void> {
  const url = assertSafeUrl(config.url);
  const raw = JSON.stringify(body);
  const response = await fetchFn(url.href, {
    method: "POST",
    headers: { "content-type": "application/json", ...sign(raw, config.secret) },
    body: raw,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.ok) return; // a 2xx the portal ignored as stale is still a success
  if (response.status >= 400 && response.status < 500) {
    throw new PortalRejectedError(`portal-sync: portal answered ${response.status}`, response.status);
  }
  throw new PortalServerError(`portal-sync: portal answered ${response.status}`, response.status);
}

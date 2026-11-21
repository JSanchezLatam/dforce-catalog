/**
 * Whether a cookie may be `secure` for this request (S11): true only when it
 * arrived over HTTPS, which `installTrustedClientAddress` lets only a proxy on
 * the server itself claim. The plain-HTTP LAN stays false, or no browser there
 * would send the cookie back.
 */
export function isHttpsRequest(headers: Headers): boolean {
  return headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase() === "https";
}

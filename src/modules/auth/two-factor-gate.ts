/**
 * The second-factor gate's predicate (L28), modelled on `forced-change.ts`: it
 * lives here so it is unit-testable without booting the proxy; `src/proxy.ts`
 * holds only the interception that calls it.
 */

/** Declared once, for the proxy redirect and the page's own route (T7). */
export const TWO_FACTOR_PATH = "/two-factor";

/**
 * The only paths a session at `pending = 'verify'` may reach: the code screen,
 * its POST target, and logout as the way out. Static assets need no entry:
 * `config.matcher` in `proxy.ts` excludes them first.
 */
const EXEMPT_PATHS: readonly string[] = [TWO_FACTOR_PATH, "/api/two-factor/verify", "/api/logout"];

/** Exact match, deliberately not a prefix test, as in `isPasswordChangeExempt`. */
export function isSecondFactorExempt(pathname: string): boolean {
  return EXEMPT_PATHS.includes(pathname);
}

/**
 * design.md Decision 8 — the forced-password-change predicate. It lives here,
 * not in `src/proxy.ts`, so it is unit-testable without booting the proxy;
 * `src/proxy.ts` holds only the interception that calls it.
 */

/**
 * Declared ONCE and imported by both the proxy interception and the page's own
 * route, so renaming the route cannot desync it from its own exemption. The
 * loop protection is structural, not incidental (design.md Decision 8).
 */
export const CHANGE_PASSWORD_PATH = "/change-password";

/**
 * The only three paths a `mustChangePassword` user may still reach. Each is
 * load-bearing — dropping any one produces an infinite redirect, an
 * unsubmittable screen, or a trapped user (see the table in Decision 8).
 *
 * Static assets and `_next/*` need no entry: `config.matcher` in `proxy.ts`
 * already excludes them before this predicate ever runs.
 */
const EXEMPT_PATHS: readonly string[] = [
  CHANGE_PASSWORD_PATH,
  "/api/account/password",
  "/api/logout",
];

/**
 * Exact match, deliberately not a prefix test: `/api/account` shares a prefix
 * with the exempt `/api/account/password`, so `startsWith` would hand a flagged
 * user the whole profile route as a bonus.
 */
export function isPasswordChangeExempt(pathname: string): boolean {
  return EXEMPT_PATHS.includes(pathname);
}

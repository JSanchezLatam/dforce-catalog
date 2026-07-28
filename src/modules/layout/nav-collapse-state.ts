/**
 * Pure, dependency-free codec for the sidebar's per-group collapse state
 * cookie. No DOM, no `next/headers` — safe to unit test under vitest with
 * no jsdom, no DB, and reusable from both the server (layout.tsx via
 * `cookies()`) and the client (app-sidebar.tsx via `document.cookie`).
 */

/** Mirrors the naming style of `sidebar_state` in `components/ui/sidebar.tsx`. */
export const NAV_COLLAPSE_COOKIE_NAME = "sidebar_group_state";

/** Mirrors the existing `sidebar_state` cookie's 7-day max-age. */
export const NAV_COLLAPSE_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/**
 * Stable identity for every collapsible nav section, independent from its
 * display label — see `nav-items.ts`'s `NavGroup.id` / `NavParent.id`.
 * Labels can be renamed without invalidating a saved cookie; any id
 * removed from this list becomes a "stale key" that `decodeNavCollapseState`
 * silently ignores instead of crashing or blanking the nav.
 */
export const NAV_COLLAPSE_KEYS = ["crm", "catalogo", "configuracion", "config-catalogos"] as const;

export type NavCollapseKey = (typeof NAV_COLLAPSE_KEYS)[number];

export type NavCollapseState = Record<NavCollapseKey, boolean>;

const KEY_SET: ReadonlySet<string> = new Set(NAV_COLLAPSE_KEYS);

/** Requirement: default on first visit is "all expanded" (today's behavior). */
export const DEFAULT_NAV_COLLAPSE_STATE: NavCollapseState = {
  crm: true,
  catalogo: true,
  configuracion: true,
  "config-catalogos": true,
};

/** Guards against corrupted/oversized cookie payloads (e.g. tampering). */
const MAX_COOKIE_LENGTH = 512;

function isNavCollapseKey(key: string): key is NavCollapseKey {
  return KEY_SET.has(key);
}

/**
 * Decodes the `sidebar_group_state` cookie value into a full state map.
 *
 * Resilient by construction — never throws, never returns a partial/blank
 * result:
 * - missing/empty/null input -> default (all expanded)
 * - oversized input -> default (guards against corrupted/huge values)
 * - unknown/stale/renamed keys -> individually ignored, other keys still apply
 * - malformed pairs (no separator, bad boolean marker) -> individually ignored
 * - invalid %-escapes (decodeURIComponent would throw) -> default
 */
export function decodeNavCollapseState(raw: string | null | undefined): NavCollapseState {
  const state: NavCollapseState = { ...DEFAULT_NAV_COLLAPSE_STATE };
  if (!raw) return state;
  if (raw.length > MAX_COOKIE_LENGTH) return state;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return state;
  }

  for (const pair of decoded.split(",")) {
    if (!pair) continue;
    const separatorIndex = pair.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = pair.slice(0, separatorIndex);
    const value = pair.slice(separatorIndex + 1);
    if (!isNavCollapseKey(key)) continue; // stale/renamed/unknown group — ignore
    if (value !== "0" && value !== "1") continue;

    state[key] = value === "1";
  }

  return state;
}

/**
 * Encodes a (possibly partial) state map back into a cookie value. Only
 * keys that deviate from the default are written, keeping the cookie
 * small — `decodeNavCollapseState` tolerates either the compact or the
 * fully-explicit form.
 */
export function encodeNavCollapseState(state: Partial<NavCollapseState>): string {
  const pairs: string[] = [];
  for (const key of NAV_COLLAPSE_KEYS) {
    const open = state[key] ?? DEFAULT_NAV_COLLAPSE_STATE[key];
    if (open !== DEFAULT_NAV_COLLAPSE_STATE[key]) {
      pairs.push(`${key}:${open ? "1" : "0"}`);
    }
  }
  return encodeURIComponent(pairs.join(","));
}

/**
 * Extracts a single cookie's raw value from a full cookie-header-style
 * string (`document.cookie`, e.g. `"a=1; b=2"`). Pure so it is testable
 * without a DOM. Returns `undefined` for a missing/malformed/absent
 * cookie rather than throwing.
 */
export function extractCookieValue(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = part.slice(0, separatorIndex).trim();
    if (key === name) {
      return part.slice(separatorIndex + 1).trim();
    }
  }

  return undefined;
}

import { describe, expect, it } from "vitest";

import {
  DEFAULT_NAV_COLLAPSE_STATE,
  decodeNavCollapseState,
  encodeNavCollapseState,
  extractCookieValue,
  getGroupOpen,
  isNavCollapseKey,
  NAV_COLLAPSE_COOKIE_MAX_AGE,
  NAV_COLLAPSE_COOKIE_NAME,
} from "./nav-collapse-state";

describe("decodeNavCollapseState() — resilient cookie decode", () => {
  it("defaults to all-expanded when the cookie is missing (undefined)", () => {
    expect(decodeNavCollapseState(undefined)).toEqual(DEFAULT_NAV_COLLAPSE_STATE);
  });

  it("defaults to all-expanded when the cookie is null", () => {
    expect(decodeNavCollapseState(null)).toEqual(DEFAULT_NAV_COLLAPSE_STATE);
  });

  it("defaults to all-expanded when the cookie is an empty string", () => {
    expect(decodeNavCollapseState("")).toEqual(DEFAULT_NAV_COLLAPSE_STATE);
  });

  it("decodes a single closed key, leaving the rest at default", () => {
    const result = decodeNavCollapseState(encodeURIComponent("crm:0"));
    expect(result).toEqual({ ...DEFAULT_NAV_COLLAPSE_STATE, crm: false });
  });

  it("decodes multiple closed keys", () => {
    const result = decodeNavCollapseState(encodeURIComponent("crm:0,catalogo:0"));
    expect(result).toEqual({ ...DEFAULT_NAV_COLLAPSE_STATE, crm: false, catalogo: false });
  });

  it("decodes an explicit open (1) marker the same as default", () => {
    const result = decodeNavCollapseState(encodeURIComponent("configuracion:1"));
    expect(result).toEqual(DEFAULT_NAV_COLLAPSE_STATE);
  });

  it("ignores unknown/stale keys instead of crashing (renamed or removed group)", () => {
    const result = decodeNavCollapseState(encodeURIComponent("some-removed-group:0,crm:0"));
    expect(result).toEqual({ ...DEFAULT_NAV_COLLAPSE_STATE, crm: false });
  });

  it("ignores malformed pairs with no separator", () => {
    const result = decodeNavCollapseState(encodeURIComponent("crm,catalogo:0"));
    expect(result).toEqual({ ...DEFAULT_NAV_COLLAPSE_STATE, catalogo: false });
  });

  it("ignores pairs with an invalid boolean marker", () => {
    const result = decodeNavCollapseState(encodeURIComponent("crm:maybe"));
    expect(result).toEqual(DEFAULT_NAV_COLLAPSE_STATE);
  });

  it("tolerates empty segments from stray commas", () => {
    const result = decodeNavCollapseState(encodeURIComponent(",crm:0,,catalogo:0,"));
    expect(result).toEqual({ ...DEFAULT_NAV_COLLAPSE_STATE, crm: false, catalogo: false });
  });

  it("falls back to default when decodeURIComponent would throw on invalid %-escapes", () => {
    const result = decodeNavCollapseState("%E0%A4%A");
    expect(result).toEqual(DEFAULT_NAV_COLLAPSE_STATE);
  });

  it("falls back to default when the raw value is oversized (corrupted/attack payload)", () => {
    const oversized = "crm:0,".repeat(200);
    const result = decodeNavCollapseState(oversized);
    expect(result).toEqual(DEFAULT_NAV_COLLAPSE_STATE);
  });

  it("never throws for any malformed input", () => {
    const inputs = ["", "   ", ":::", "crm:0:1", "%", "null", "undefined", "{}"];
    for (const input of inputs) {
      expect(() => decodeNavCollapseState(input)).not.toThrow();
    }
  });
});

describe("encodeNavCollapseState() — compact cookie encode", () => {
  it("encodes an empty string when every key matches the default (all expanded)", () => {
    expect(encodeNavCollapseState(DEFAULT_NAV_COLLAPSE_STATE)).toBe("");
  });

  it("encodes only the keys that deviate from default", () => {
    const encoded = encodeNavCollapseState({ ...DEFAULT_NAV_COLLAPSE_STATE, crm: false });
    expect(decodeURIComponent(encoded)).toBe("crm:0");
  });

  it("encodes multiple deviating keys", () => {
    const encoded = encodeNavCollapseState({ ...DEFAULT_NAV_COLLAPSE_STATE, crm: false, "config-catalogos": false });
    const decoded = decodeURIComponent(encoded);
    expect(decoded).toContain("crm:0");
    expect(decoded).toContain("config-catalogos:0");
  });

  it("treats a partial state object as inheriting defaults for missing keys", () => {
    const encoded = encodeNavCollapseState({ crm: false });
    expect(decodeNavCollapseState(encoded)).toEqual({ ...DEFAULT_NAV_COLLAPSE_STATE, crm: false });
  });

  it("round-trips through decode for every key closed", () => {
    const allClosed = { crm: false, catalogo: false, configuracion: false, "config-catalogos": false } as const;
    const encoded = encodeNavCollapseState(allClosed);
    expect(decodeNavCollapseState(encoded)).toEqual(allClosed);
  });
});

describe("extractCookieValue() — pure document.cookie-style parser", () => {
  it("returns undefined for a missing/undefined header", () => {
    expect(extractCookieValue(undefined, NAV_COLLAPSE_COOKIE_NAME)).toBeUndefined();
  });

  it("returns undefined for a null header", () => {
    expect(extractCookieValue(null, NAV_COLLAPSE_COOKIE_NAME)).toBeUndefined();
  });

  it("returns undefined for an empty header", () => {
    expect(extractCookieValue("", NAV_COLLAPSE_COOKIE_NAME)).toBeUndefined();
  });

  it("finds the named cookie among several", () => {
    const header = `sidebar_state=true; ${NAV_COLLAPSE_COOKIE_NAME}=crm%3A0; other=x`;
    expect(extractCookieValue(header, NAV_COLLAPSE_COOKIE_NAME)).toBe("crm%3A0");
  });

  it("returns undefined when the named cookie is absent", () => {
    const header = "sidebar_state=true; other=x";
    expect(extractCookieValue(header, NAV_COLLAPSE_COOKIE_NAME)).toBeUndefined();
  });

  it("trims surrounding whitespace around name and value", () => {
    const header = `  sidebar_state=true ;  ${NAV_COLLAPSE_COOKIE_NAME} = crm%3A0  `;
    expect(extractCookieValue(header, NAV_COLLAPSE_COOKIE_NAME)).toBe("crm%3A0");
  });

  it("ignores malformed segments without '=' instead of crashing", () => {
    const header = `garbage-segment; ${NAV_COLLAPSE_COOKIE_NAME}=crm%3A0`;
    expect(extractCookieValue(header, NAV_COLLAPSE_COOKIE_NAME)).toBe("crm%3A0");
  });

  it("never throws for any malformed header", () => {
    const inputs = ["", ";;;", "=", "==", "a=b=c", null, undefined];
    for (const input of inputs) {
      expect(() => extractCookieValue(input, NAV_COLLAPSE_COOKIE_NAME)).not.toThrow();
    }
  });
});

describe("isNavCollapseKey() — key guard used by UI lookups", () => {
  it("returns true for every known key", () => {
    for (const key of ["crm", "catalogo", "configuracion", "config-catalogos"]) {
      expect(isNavCollapseKey(key)).toBe(true);
    }
  });

  it("returns false for an unknown/stale/renamed key", () => {
    expect(isNavCollapseKey("some-removed-group")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isNavCollapseKey("")).toBe(false);
  });
});

describe("getGroupOpen() — resilient per-id lookup for the UI layer", () => {
  it("returns the stored value for a known, closed key", () => {
    const state = { ...DEFAULT_NAV_COLLAPSE_STATE, crm: false };
    expect(getGroupOpen(state, "crm")).toBe(false);
  });

  it("returns the stored value for a known, open key", () => {
    expect(getGroupOpen(DEFAULT_NAV_COLLAPSE_STATE, "catalogo")).toBe(true);
  });

  it("falls back to open (true) for an id that is not a recognized collapse key (renamed/removed group at the UI layer)", () => {
    expect(getGroupOpen(DEFAULT_NAV_COLLAPSE_STATE, "some-future-group-id")).toBe(true);
  });
});

describe("cookie constants", () => {
  it("mirrors the existing sidebar_state cookie's 7-day max-age convention", () => {
    expect(NAV_COLLAPSE_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 7);
  });

  it("uses a sidebar_-prefixed cookie name mirroring the existing naming style", () => {
    expect(NAV_COLLAPSE_COOKIE_NAME.startsWith("sidebar_")).toBe(true);
  });
});

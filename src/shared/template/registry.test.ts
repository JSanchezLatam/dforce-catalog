import { describe, expect, it } from "vitest";

import { CATALOG_TEMPLATES, DEFAULT_TEMPLATE_ID, getTemplate } from "./registry";

describe("getTemplate (R8.4 — orphaned id falls back)", () => {
  it("returns the default template for an unknown id", () => {
    expect(getTemplate("does-not-exist").id).toBe(DEFAULT_TEMPLATE_ID);
  });

  it("returns the default template for null", () => {
    expect(getTemplate(null).id).toBe(DEFAULT_TEMPLATE_ID);
  });

  it("returns the default template for undefined", () => {
    expect(getTemplate(undefined).id).toBe(DEFAULT_TEMPLATE_ID);
  });

  it("returns the matching entry when the id exists", () => {
    expect(getTemplate(DEFAULT_TEMPLATE_ID).id).toBe(DEFAULT_TEMPLATE_ID);
  });
});

describe("CATALOG_TEMPLATES", () => {
  it("has unique ids", () => {
    const ids = CATALOG_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the default template id", () => {
    expect(CATALOG_TEMPLATES.some((template) => template.id === DEFAULT_TEMPLATE_ID)).toBe(true);
  });
});

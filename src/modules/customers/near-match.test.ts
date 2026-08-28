import { describe, expect, it } from "vitest";

import { relaxSearchTerm } from "./near-match";

describe("relaxSearchTerm", () => {
  it("collapses digits-only phone terms to the same national-number key regardless of separators or country code", () => {
    const key = relaxSearchTerm("2345678");
    expect(key).toBe("2345678");
    expect(relaxSearchTerm("234-5678")).toBe(key);
    expect(relaxSearchTerm("+507 234-5678")).toBe(key);
  });

  it("returns null for a phone-shaped term with fewer than 7 significant digits", () => {
    expect(relaxSearchTerm("123-45")).toBeNull();
  });

  it("relaxes a multi-word name term to its first word", () => {
    expect(relaxSearchTerm("Juan Alberto")).toBe("Juan");
  });

  it("relaxes a single-token name/plate term to a shorter prefix", () => {
    expect(relaxSearchTerm("ABC1234")).toBe("ABC1");
  });

  it("returns null for a name/plate term too short to relax further", () => {
    expect(relaxSearchTerm("abc")).toBeNull();
  });

  it("returns null for an empty or whitespace-only term", () => {
    expect(relaxSearchTerm("   ")).toBeNull();
  });
});

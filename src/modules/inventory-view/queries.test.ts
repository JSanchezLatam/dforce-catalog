import { describe, expect, it } from "vitest";

import { computePageWindow, normalizeFilters, PAGE_SIZE } from "./queries";

describe("normalizeFilters", () => {
  it("returns no filters when searchParams has neither category key", () => {
    expect(normalizeFilters({})).toEqual({});
  });

  it("picks categoryL1 only when only L1 is present", () => {
    expect(normalizeFilters({ categoryL1: "Motor" })).toEqual({ categoryL1: "Motor" });
  });

  it("combines categoryL1 and categoryL2 when both are present", () => {
    expect(normalizeFilters({ categoryL1: "Motor", categoryL2: "Frenos" })).toEqual({
      categoryL1: "Motor",
      categoryL2: "Frenos",
    });
  });

  it("drops empty-string values (treated as cleared filters, R3.5)", () => {
    expect(normalizeFilters({ categoryL1: "", categoryL2: "Frenos" })).toEqual({ categoryL2: "Frenos" });
  });

  it("takes the first value when Next.js gives an array (repeated query key)", () => {
    expect(normalizeFilters({ categoryL1: ["Motor", "Suspension"] })).toEqual({ categoryL1: "Motor" });
  });
});

describe("computePageWindow", () => {
  it("defaults to page 1 / offset 0 when the page param is missing", () => {
    expect(computePageWindow(undefined)).toEqual({ page: 1, offset: 0, limit: PAGE_SIZE });
  });

  it("computes the offset for page 3 at the default page size", () => {
    expect(computePageWindow("3")).toEqual({ page: 3, offset: 2 * PAGE_SIZE, limit: PAGE_SIZE });
  });

  it("clamps non-numeric page params back to page 1", () => {
    expect(computePageWindow("abc")).toEqual({ page: 1, offset: 0, limit: PAGE_SIZE });
  });

  it("clamps zero and negative page params back to page 1", () => {
    expect(computePageWindow("0")).toEqual({ page: 1, offset: 0, limit: PAGE_SIZE });
    expect(computePageWindow("-5")).toEqual({ page: 1, offset: 0, limit: PAGE_SIZE });
  });

  it("floors fractional page params", () => {
    expect(computePageWindow("2.9")).toEqual({ page: 2, offset: PAGE_SIZE, limit: PAGE_SIZE });
  });

  it("respects a custom page size", () => {
    expect(computePageWindow("2", 10)).toEqual({ page: 2, offset: 10, limit: 10 });
  });
});

import { describe, expect, it } from "vitest";

import { currentMonthKey, monthKeys, parseMes } from "./months";

const JAN_2027 = new Date("2027-01-15T12:00:00Z");

describe("monthKeys", () => {
  it("builds 6 keys oldest first across a year boundary", () => {
    expect(monthKeys(JAN_2027, 6)).toEqual(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]);
  });

  it("builds 12 keys starting in February of the previous year", () => {
    const keys = monthKeys(JAN_2027, 12);
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe("2026-02");
    expect(keys[11]).toBe("2027-01");
  });
});

describe("currentMonthKey", () => {
  it("is still September at 04:59Z on Oct 1 (Panama is UTC-5)", () => {
    expect(currentMonthKey(new Date("2026-10-01T04:59:00Z"))).toBe("2026-09");
  });

  it("is October at 05:00Z on Oct 1", () => {
    expect(currentMonthKey(new Date("2026-10-01T05:00:00Z"))).toBe("2026-10");
  });
});

describe("parseMes", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("accepts a key inside the 12-month list", () => {
    expect(parseMes("2026-08", now)).toBe("2026-08");
    expect(parseMes("2025-11", now)).toBe("2025-11");
  });

  it.each([["2019-01"], ["garbage"], ["2026-13"], ["2026-11"], [["2026-08", "2026-09"]], [undefined], [""]])(
    "falls back to the current month for %j",
    (raw) => {
      expect(parseMes(raw, now)).toBe("2026-10");
    },
  );
});

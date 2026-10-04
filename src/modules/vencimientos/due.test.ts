import { afterEach, describe, expect, it } from "vitest";

import { computeDueItems, contactKey } from "./due";

const REAL_TZ = process.env.TZ;
afterEach(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

const plate = (month: number | null) => ({ placaRenovacionMes: month, seguroVence: null });
const insurance = (expiry: string | null) => ({ placaRenovacionMes: null, seguroVence: expiry });

describe("plate window", () => {
  it("October: 10 and 11 are due, 9 and 8 are overdue, 12 and 7 are not listed", () => {
    const listed = (m: number) => computeDueItems(plate(m), "2026-10-04");

    expect(listed(10)).toEqual([{ kind: "placa", periodKey: "2026-10", state: "due", daysLeft: null }]);
    expect(listed(11)).toEqual([{ kind: "placa", periodKey: "2026-11", state: "due", daysLeft: null }]);
    expect(listed(9)).toEqual([{ kind: "placa", periodKey: "2026-09", state: "overdue", daysLeft: null }]);
    expect(listed(8)).toEqual([{ kind: "placa", periodKey: "2026-08", state: "overdue", daysLeft: null }]);
    expect(listed(12)).toEqual([]);
    expect(listed(7)).toEqual([]);
  });

  it("a month entered long after it passed waits for next year's cycle", () => {
    expect(computeDueItems(plate(3), "2026-10-04")).toEqual([]);
    expect(computeDueItems(plate(3), "2027-01-31")).toEqual([]);
    expect(computeDueItems(plate(3), "2027-02-01")).toEqual([
      { kind: "placa", periodKey: "2027-03", state: "due", daysLeft: null },
    ]);
  });

  it("January 2027: 11 and 12 are overdue as 2026 periods, 10 is not listed", () => {
    expect(computeDueItems(plate(11), "2027-01-10")).toEqual([
      { kind: "placa", periodKey: "2026-11", state: "overdue", daysLeft: null },
    ]);
    expect(computeDueItems(plate(12), "2027-01-10")).toEqual([
      { kind: "placa", periodKey: "2026-12", state: "overdue", daysLeft: null },
    ]);
    expect(computeDueItems(plate(10), "2027-01-10")).toEqual([]);
  });

  it("December: 12 and 1 are due (January as next year's period), 2 is not", () => {
    expect(computeDueItems(plate(12), "2026-12-20")).toEqual([
      { kind: "placa", periodKey: "2026-12", state: "due", daysLeft: null },
    ]);
    expect(computeDueItems(plate(1), "2026-12-20")).toEqual([
      { kind: "placa", periodKey: "2027-01", state: "due", daysLeft: null },
    ]);
    expect(computeDueItems(plate(2), "2026-12-20")).toEqual([]);
  });

  it("November: December is next month and due", () => {
    expect(computeDueItems(plate(12), "2026-11-30")).toEqual([
      { kind: "placa", periodKey: "2026-12", state: "due", daysLeft: null },
    ]);
  });

  it("reads the month from the key, not from a Date parsed in the host zone", () => {
    // `new Date("2026-10-01")` is 30 September at 19:00 in Panamá: month 9.
    process.env.TZ = "America/Panama";
    expect(computeDueItems(plate(10), "2026-10-01")).toEqual([
      { kind: "placa", periodKey: "2026-10", state: "due", daysLeft: null },
    ]);
    expect(computeDueItems(plate(7), "2026-10-01")).toEqual([]);
  });

  it("a vehicle with no renewal month is never due", () => {
    expect(computeDueItems(plate(null), "2026-10-04")).toEqual([]);
  });
});

describe("insurance window", () => {
  it("is due 30 days out inclusive and not a day later", () => {
    expect(computeDueItems(insurance("2026-11-03"), "2026-10-04")).toEqual([
      { kind: "seguro", periodKey: "2026-11-03", state: "due", daysLeft: 30 },
    ]);
    expect(computeDueItems(insurance("2026-11-04"), "2026-10-04")).toEqual([]);
  });

  it("an expiry today is due with 0 days left", () => {
    expect(computeDueItems(insurance("2026-10-04"), "2026-10-04")).toEqual([
      { kind: "seguro", periodKey: "2026-10-04", state: "due", daysLeft: 0 },
    ]);
  });

  it("a past expiry stays listed as overdue with negative days", () => {
    expect(computeDueItems(insurance("2026-09-01"), "2026-10-04")).toEqual([
      { kind: "seguro", periodKey: "2026-09-01", state: "overdue", daysLeft: -33 },
    ]);
  });

  it("counts the 30 days across a year end", () => {
    expect(computeDueItems(insurance("2027-01-02"), "2026-12-03")).toEqual([
      { kind: "seguro", periodKey: "2027-01-02", state: "due", daysLeft: 30 },
    ]);
    expect(computeDueItems(insurance("2027-01-03"), "2026-12-03")).toEqual([]);
  });

  it("a vehicle with no expiry is never due", () => {
    expect(computeDueItems(insurance(null), "2026-10-04")).toEqual([]);
  });
});

describe("contacted marks", () => {
  const both = { placaRenovacionMes: 10, seguroVence: "2026-10-20" };

  it("a contacted period key hides only its own kind", () => {
    const contacted = new Set([contactKey("placa", "2026-10")]);
    expect(computeDueItems(both, "2026-10-04", contacted).map((i) => i.kind)).toEqual(["seguro"]);
    expect(computeDueItems(both, "2026-10-04").map((i) => i.kind)).toEqual(["placa", "seguro"]);
  });

  it("a new expiry date resurfaces insurance, and so does next year's plate period", () => {
    const contacted = new Set([contactKey("seguro", "2026-10-20"), contactKey("placa", "2026-10")]);
    expect(computeDueItems({ placaRenovacionMes: null, seguroVence: "2026-10-25" }, "2026-10-04", contacted)).toHaveLength(1);
    expect(computeDueItems(plate(10), "2027-10-04", contacted)).toEqual([
      { kind: "placa", periodKey: "2027-10", state: "due", daysLeft: null },
    ]);
  });

  it("a key for the other kind with the same period text hides nothing", () => {
    expect(computeDueItems(plate(10), "2026-10-04", new Set([contactKey("seguro", "2026-10")]))).toHaveLength(1);
  });
});

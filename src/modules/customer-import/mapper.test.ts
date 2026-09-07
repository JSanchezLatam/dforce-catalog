import { describe, expect, it } from "vitest";

import { mapCustomerRow } from "./mapper";

/**
 * Field names and shapes come from a live sweep of all 370 rows, recorded in
 * `openspec/changes/archive/2026-09-06-customer-import/proposal.md` — not from the vendor docs,
 * which described a REST API that does not exist and cost this integration a
 * rewrite once already.
 */
function row(overrides: Record<string, unknown> = {}) {
  return {
    Cliente: "1042",
    Token: "",
    Tipo: "CLIENTE",
    Nombre: "Rosa Martínez",
    Contacto: "",
    Email: "rosa@example.com",
    Status: "ACTIVE",
    Telefono_1: "6123-4567",
    Telefono_2: "",
    Cellular: "",
    ...overrides,
  };
}

describe("mapCustomerRow — the identity", () => {
  it("uses `Cliente` as the external id", () => {
    expect(mapCustomerRow(row({ Cliente: "1042" }))).toMatchObject({ externalId: "1042" });
  });

  /**
   * `Token` is named like an identifier and is EMPTY on all 370 live rows.
   * This is a guard, not a coverage test: it is the field the next person will
   * reach for, and reaching for it yields an import that dedupes every
   * customer onto the same empty key.
   */
  it("never reads `Token`, even when Interfuerza starts filling it", () => {
    const mapped = mapCustomerRow(row({ Token: "tok-should-be-ignored" }));

    expect(mapped.kind).toBe("customer");
    expect(JSON.stringify(mapped)).not.toContain("tok-should-be-ignored");
  });

  it("skips a row with no `Cliente` rather than importing an unmatchable customer", () => {
    expect(mapCustomerRow(row({ Cliente: "" }))).toMatchObject({ kind: "skip", reason: "missing_external_id" });
  });
});

describe("mapCustomerRow — the name", () => {
  it("takes `Nombre`", () => {
    expect(mapCustomerRow(row({ Nombre: "Rosa Martínez" }))).toMatchObject({ name: "Rosa Martínez" });
  });

  /**
   * `Contacto` is a contact PERSON and is filled on roughly one row in twenty.
   * Used as a fallback it would silently rename a customer to their
   * receptionist.
   */
  it("never falls back to `Contacto` — a blank `Nombre` is a skip", () => {
    const mapped = mapCustomerRow(row({ Nombre: "   ", Contacto: "Recepción" }));

    expect(mapped).toMatchObject({ kind: "skip", reason: "missing_name" });
    expect(JSON.stringify(mapped)).not.toContain("Recepción");
  });

  it("trims surrounding whitespace, which the live data carries", () => {
    expect(mapCustomerRow(row({ Nombre: "  Rosa Martínez  " }))).toMatchObject({ name: "Rosa Martínez" });
  });
});

describe("mapCustomerRow — the phone (D4: verbatim, and it costs something)", () => {
  it("takes `Telefono_1`, present on 361 of 370 rows", () => {
    expect(mapCustomerRow(row({ Telefono_1: "6123-4567" }))).toMatchObject({ phone: "6123-4567" });
  });

  /**
   * VERBATIM. The owner chose raw over normalising to `+507`, knowing an
   * 8-digit Panama number is not E.164 and so cannot receive a WhatsApp
   * reminder. This test is what stops a later "helpful" normalisation from
   * changing that decision quietly — if the rule changes, it should change
   * here, deliberately.
   */
  it("does NOT normalise, prefix a country code, or strip separators", () => {
    expect(mapCustomerRow(row({ Telefono_1: "6123-4567" }))).toMatchObject({ phone: "6123-4567" });
    expect(mapCustomerRow(row({ Telefono_1: "+507 6123-4567" }))).toMatchObject({ phone: "+507 6123-4567" });
  });

  /**
   * `Telefono_1` first, though `Cellular` sounds like the WhatsApp-capable
   * one: it is present on 361/370 against `Cellular`'s 45/370. Preferring the
   * mobile-sounding field would leave 316 customers with no phone and skip
   * them.
   */
  it("falls back to `Cellular` only when `Telefono_1` is empty", () => {
    expect(mapCustomerRow(row({ Telefono_1: "", Cellular: "6999-1111" }))).toMatchObject({ phone: "6999-1111" });
    expect(mapCustomerRow(row({ Telefono_1: "6123-4567", Cellular: "6999-1111" }))).toMatchObject({ phone: "6123-4567" });
  });

  // D5 — 9 of the 370 have nothing in any field. `phone` is NOT NULL and R17
  // requires it, so the alternatives were inventing a number or writing rows
  // the app's own form would reject.
  // "both", not "three": `Telefono_2` is measured empty on all 370 rows and is
  // deliberately not read. The earlier wording named a field the code does not
  // consult, which is the kind of test description that outlives its code.
  it("skips a row with no phone in either read field, and says why", () => {
    const mapped = mapCustomerRow(row({ Telefono_1: "", Cellular: "" }));

    expect(mapped).toMatchObject({ kind: "skip", reason: "missing_phone" });
  });

  it("carries the name and external id on a skip, so the report can name them", () => {
    const mapped = mapCustomerRow(row({ Cliente: "1042", Nombre: "Rosa Martínez", Telefono_1: "", Cellular: "" }));

    expect(mapped).toMatchObject({ kind: "skip", externalId: "1042", name: "Rosa Martínez" });
  });
});

describe("mapCustomerRow — email", () => {
  it("maps `Email` when present, on 81 of 370 rows", () => {
    expect(mapCustomerRow(row({ Email: "rosa@example.com" }))).toMatchObject({ email: "rosa@example.com" });
  });

  // `cliente.email` is nullable; an empty string is not "no email", it is a
  // value that renders as an empty cell and fails an email-format check.
  it("maps an absent email to null, never to an empty string", () => {
    expect(mapCustomerRow(row({ Email: "" }))).toMatchObject({ email: null });
    expect(mapCustomerRow(row({ Email: "   " }))).toMatchObject({ email: null });
  });
});

/**
 * The mapper's whole contract is "never abort the run over one bad row", and
 * the import is all-or-nothing (D6) — so ONE throw takes all 370 customers
 * down with it.
 *
 * Every other case in this file goes through `row()`, which always spreads a
 * well-formed object, so none of them ever reached the `(raw ?? {})` guard or
 * `text()`'s `typeof` check. Task 2.7 was checked off claiming this was
 * proven; it was not. Written after GGA pointed that out.
 */
describe("mapCustomerRow — never throws, whatever arrives", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a bare string", "nonsense"],
    ["a number", 42],
    ["an array", [1, 2, 3]],
    ["an empty object", {}],
  ])("turns %s into a skip rather than throwing", (_label, input) => {
    const mapped = mapCustomerRow(input);

    expect(mapped).toMatchObject({ kind: "skip", reason: "missing_external_id" });
  });

  // A row whose fields are the right names and the wrong TYPES — the shape a
  // JSON envelope can produce and a `Record<string, unknown>` cast cannot stop.
  it("skips a row whose fields are present but not strings", () => {
    const mapped = mapCustomerRow({ Cliente: 1042, Nombre: ["Rosa"], Telefono_1: {} });

    expect(mapped).toMatchObject({ kind: "skip", reason: "missing_external_id" });
  });
});

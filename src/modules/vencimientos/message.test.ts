import { describe, expect, it } from "vitest";

import { buildContactMessage, formatBalboa, parsePrice, waMeUrl, type ContactMessageInput } from "./message";

const WORKSHOP = {
  name: "DForce Car Audio",
  phone: "203-7212",
  hours: "Lunes a Sábado 8:00 A.M - 5:00 P.M.",
  address: "Rio Abajo, Calle 14",
};

function input(over: Partial<ContactMessageInput> = {}): ContactMessageInput {
  return {
    workshop: WORKSHOP,
    customerName: "Transportes Chiriquí S.A.",
    vehicle: { label: "Nissan Frontier", plate: "BF0921" },
    item: { kind: "placa", periodKey: "2026-11", overdue: false },
    price: 45,
    ...over,
  };
}

describe("buildContactMessage()", () => {
  it("builds the full plate message with the price in balboas", () => {
    expect(buildContactMessage(input())).toBe(
      "Hola Transportes Chiriquí S.A., le saludamos de DForce Car Audio. " +
        "La renovación de la placa de su Nissan Frontier (BF0921) corresponde en noviembre de 2026. " +
        "Le ofrecemos el servicio de renovación por B/. 45.00. " +
        "Si le interesa, responda este mensaje o llámenos al 203-7212. " +
        // The stored hours already end in a period: the sentence must not double it.
        "Horario: Lunes a Sábado 8:00 A.M - 5:00 P.M. Dirección: Rio Abajo, Calle 14.",
    );
  });

  it("omits the price fragment entirely when the price is null or NaN", () => {
    for (const price of [null, Number.NaN]) {
      const message = buildContactMessage(input({ price }));
      expect(message).toContain("Le ofrecemos el servicio de renovación.");
      expect(message).not.toContain("B/.");
    }
  });

  it("says 'correspondía' for an overdue plate and 'corresponde' for one that is not", () => {
    const overdue = buildContactMessage(input({ item: { kind: "placa", periodKey: "2026-09", overdue: true } }));
    expect(overdue).toContain("correspondía en septiembre de 2026");
    expect(overdue).not.toContain("corresponde en");
    expect(buildContactMessage(input())).toContain("corresponde en noviembre de 2026");
  });

  it("words insurance with the expiry date and 'venció' only when overdue", () => {
    const overdue = buildContactMessage(input({ item: { kind: "seguro", periodKey: "2026-09-01", overdue: true } }));
    expect(overdue).toContain("le saludamos de DForce Car Audio. El seguro de su Nissan Frontier (BF0921) venció el 01/09/2026");
    const due = buildContactMessage(input({ item: { kind: "seguro", periodKey: "2026-10-20", overdue: false } }));
    expect(due).toContain("le saludamos de DForce Car Audio. El seguro de su Nissan Frontier (BF0921) vence el 20/10/2026");
    expect(due).toContain("Le ofrecemos el servicio de renovación por B/. 45.00.");
  });

  it("drops every fragment of a null workshop field, never printing 'null'", () => {
    const message = buildContactMessage(input({ workshop: { name: "DForce Car Audio", phone: null, hours: null, address: null } }));
    expect(message).toBe(
      "Hola Transportes Chiriquí S.A., le saludamos de DForce Car Audio. " +
        "La renovación de la placa de su Nissan Frontier (BF0921) corresponde en noviembre de 2026. " +
        "Le ofrecemos el servicio de renovación por B/. 45.00. " +
        "Si le interesa, responda este mensaje.",
    );
    expect(message).not.toMatch(/llámenos|Horario:|Dirección:|null/);
  });

  it("drops the greeting's workshop clause when the workshop has no name", () => {
    const message = buildContactMessage(input({ workshop: { ...WORKSHOP, name: null } }));
    expect(message.startsWith("Hola Transportes Chiriquí S.A. La renovación")).toBe(true);
    expect(message).not.toContain("le saludamos");
  });

  it("does not double the period of a customer name like 'S.A.'", () => {
    expect(buildContactMessage(input({ workshop: { ...WORKSHOP, name: "DForce Car Audio." } }))).toContain(
      "le saludamos de DForce Car Audio. La renovación",
    );
    expect(buildContactMessage(input({ workshop: { ...WORKSHOP, name: null } }))).toContain("Hola Transportes Chiriquí S.A. La");
  });

  it("reads 'su vehículo (ABC123)' when there is no make and model", () => {
    const message = buildContactMessage(input({ vehicle: { label: null, plate: "ABC123" } }));
    expect(message).toContain("de su vehículo (ABC123)");
  });
});

describe("formatBalboa() and parsePrice()", () => {
  it("formats two decimals under the B/. prefix", () => {
    expect(formatBalboa(45)).toBe("B/. 45.00");
    expect(formatBalboa(7.5)).toBe("B/. 7.50");
  });

  it("parses what the operator types, with a dot or a comma, and gives null for nothing usable", () => {
    expect(parsePrice("45")).toBe(45);
    expect(parsePrice(" 45,50 ")).toBe(45.5);
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice("-3")).toBeNull();
  });
});

describe("waMeUrl()", () => {
  it("encodes spaces, accents, slashes and dots so the text survives the query string", () => {
    const text = "Hola María, B/. 45.00 ok";
    const url = waMeUrl("50761111111", text);

    expect(url).toBe("https://wa.me/50761111111?text=Hola%20Mar%C3%ADa%2C%20B%2F.%2045.00%20ok");
    expect(new URL(url).searchParams.get("text")).toBe(text);
  });
});

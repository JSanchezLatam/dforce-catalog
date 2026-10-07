import { describe, expect, it } from "vitest";

import { CONSENT_CLAUSE_BANNER, CONSENT_CLAUSE_PARAGRAPHS } from "./consent-clause";
import { CONSENT_CLAUSE_VERSION, decideConsent, decideRotation } from "./consent";

const active = { deactivatedAt: null };

describe("decideConsent", () => {
  it("answers not_found before anything else when there is no customer", () => {
    expect(decideConsent(undefined, undefined, true)).toBe("not_found");
  });

  it("refuses a deactivated customer, even for a change that would otherwise append", () => {
    expect(decideConsent({ deactivatedAt: new Date() }, undefined, true)).toBe("deactivated");
    expect(decideConsent({ deactivatedAt: new Date() }, true, false)).toBe("deactivated");
  });

  it("appends a grant when there is no row, and when the latest row is revoked", () => {
    expect(decideConsent(active, undefined, true)).toBe("append");
    expect(decideConsent(active, false, true)).toBe("append");
  });

  it("appends a revoke only when the latest row is granted", () => {
    expect(decideConsent(active, true, false)).toBe("append");
  });

  it("appends nothing when the requested state is the one already current", () => {
    expect(decideConsent(active, true, true)).toBe("unchanged");
    expect(decideConsent(active, false, false)).toBe("unchanged");
    // No row means no consent, so a revoke of "nothing" has nothing to record.
    expect(decideConsent(active, undefined, false)).toBe("unchanged");
  });
});

describe("the provisional clause", () => {
  it("opens with the legal-review banner, verbatim", () => {
    expect(CONSENT_CLAUSE_BANNER).toBe("Texto provisorio — pendiente de revisión legal");
  });

  it("states what the portal shows, the storage outside Panama, and withdrawal at the workshop", () => {
    const text = CONSENT_CLAUSE_PARAGRAPHS.join(" ");
    expect(text).toMatch(/historial de órdenes/);
    expect(text).toMatch(/fuera de Panamá/);
    expect(text).toMatch(/retirar mi consentimiento en el taller/);
  });

  it("carries a version id that rows can pin", () => {
    expect(CONSENT_CLAUSE_VERSION).toMatch(/^\S+$/);
  });
});

describe("decideRotation", () => {
  it("answers not_found before anything else when there is no customer", () => {
    expect(decideRotation(undefined, true)).toBe("not_found");
  });

  it("refuses a deactivated customer even with current consent", () => {
    expect(decideRotation({ deactivatedAt: new Date() }, true)).toBe("deactivated");
  });

  it("refuses without current consent: no row, or a latest row that is a revoke", () => {
    expect(decideRotation(active, undefined)).toBe("no_consent");
    expect(decideRotation(active, false)).toBe("no_consent");
  });

  it("rotates only for an active customer whose latest consent is granted", () => {
    expect(decideRotation(active, true)).toBe("rotate");
  });
});

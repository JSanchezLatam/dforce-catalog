import { describe, expect, it } from "vitest";

import type { Cliente } from "@/shared/db/schema";
import { generatePortalToken, toPublicCliente, tokenAfterConsent } from "./portal-token";

describe("generatePortalToken", () => {
  it("is at least 43 base64url characters (256 bits)", () => {
    expect(generatePortalToken()).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });

  it("differs on every call", () => {
    const tokens = new Set(Array.from({ length: 50 }, generatePortalToken));
    expect(tokens.size).toBe(50);
  });

  it("takes no input, so nothing about the customer can be derived into it", () => {
    expect(generatePortalToken.length).toBe(0);
  });
});

describe("tokenAfterConsent", () => {
  it("issues a token on grant when the customer has none", () => {
    const token = tokenAfterConsent(true, null, () => "fresh");
    expect(token).toBe("fresh");
  });

  it("keeps the existing token on a grant", () => {
    expect(tokenAfterConsent(true, "existing", () => "fresh")).toBe("existing");
  });

  it("is null on revoke, whatever the customer held", () => {
    expect(tokenAfterConsent(false, "existing", () => "fresh")).toBeNull();
    expect(tokenAfterConsent(false, null, () => "fresh")).toBeNull();
  });

  it("gives a re-grant a NEW token: revoke nulls it, so the next grant generates", () => {
    const afterRevoke = tokenAfterConsent(false, "first", () => "unused");
    expect(tokenAfterConsent(true, afterRevoke, () => "second")).toBe("second");
  });
});

describe("toPublicCliente", () => {
  it("drops the portal token and keeps every other column", () => {
    const row = {
      id: "c1", name: "Ana", phone: "61234567", email: null, documentoIdentidad: null,
      externalId: null, whatsappOptOut: false, emailOptOut: false, deactivatedAt: null,
      createdAt: new Date(0), updatedAt: new Date(0), portalToken: "SECRET-TOKEN",
    } satisfies Cliente;
    const pub = toPublicCliente(row);
    expect(pub).not.toHaveProperty("portalToken");
    expect(JSON.stringify(pub)).not.toContain("SECRET-TOKEN");
    expect(pub.name).toBe("Ana");
  });
});

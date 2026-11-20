import { describe, expect, it } from "vitest";

import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUri, totpAt, verifyTotp } from "./totp";

// RFC 4226 Appendix D and RFC 6238 Appendix B share this secret: ASCII "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));
const at = (seconds: number) => new Date(seconds * 1000);

describe("base32", () => {
  it("encodes the RFC secret without padding and decodes it back", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(RFC_SECRET).toString("ascii")).toBe("12345678901234567890");
  });

  it("accepts lowercase, spaces and padding, as authenticator apps show them", () => {
    expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq==").toString("ascii")).toBe("12345678901234567890");
  });

  it("refuses characters outside the alphabet", () => {
    expect(() => base32Decode("GEZD1NBV")).toThrow();
  });
});

describe("hotp (RFC 4226 Appendix D)", () => {
  it.each([
    [0, "755224"],
    [1, "287082"],
    [2, "359152"],
    [3, "969429"],
    [4, "338314"],
    [5, "254676"],
    [6, "287922"],
    [7, "162583"],
    [8, "399871"],
    [9, "520489"],
  ])("count %i gives %s", (count, code) => {
    expect(hotp(base32Decode(RFC_SECRET), count)).toBe(code);
  });
});

describe("totpAt (RFC 6238 Appendix B, SHA1, last six digits)", () => {
  it.each([
    [59, "287082"],
    // Leading zeros survive: 07081804 and 89005924.
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("at %i s gives %s", (seconds, code) => {
    expect(totpAt(RFC_SECRET, at(seconds))).toBe(code);
  });
});

describe("verifyTotp", () => {
  const now = at(1111111111); // step 37037037

  it("returns the matched time step for the current code", () => {
    expect(verifyTotp(RFC_SECRET, "050471", now)).toBe(37037037);
  });

  it("accepts the previous and next step, for a phone clock a little off", () => {
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, at(1111111111 - 30)), now)).toBe(37037036);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, at(1111111111 + 30)), now)).toBe(37037038);
  });

  it("refuses a code two steps away", () => {
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, at(1111111111 - 60)), now)).toBeNull();
  });

  it("refuses a code already used: a step at or before the last accepted one", () => {
    expect(verifyTotp(RFC_SECRET, "050471", now, 37037037)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, at(1111111111 + 30)), now, 37037037)).toBe(37037038);
  });

  it.each(["", "05047", "0504711", "05047a", " 050471"])("refuses anything but six digits: %j", (code) => {
    expect(verifyTotp(RFC_SECRET, code, now)).toBeNull();
  });
});

describe("generateTotpSecret", () => {
  it("makes a fresh 160-bit secret each time", () => {
    const a = generateTotpSecret();

    expect(base32Decode(a)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(a);
  });
});

describe("otpauthUri", () => {
  it("names the issuer and the account, so the app labels the entry", () => {
    expect(otpauthUri({ secret: RFC_SECRET, issuer: "DForce Car Audio", account: "jsanchez" })).toBe(
      "otpauth://totp/DForce%20Car%20Audio:jsanchez?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=DForce%20Car%20Audio&algorithm=SHA1&digits=6&period=30",
    );
  });
});

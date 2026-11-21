import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { generateRecoveryCodes, hashRecoveryCode, matchRecoveryCode } from "./recovery-codes";

const key = randomBytes(32);

describe("generateRecoveryCodes", () => {
  it("makes 10 distinct codes in the format 7KQM-2XPA (S4, A6)", () => {
    const codes = generateRecoveryCodes();

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it("never uses I, L, O or U, which read as other characters", () => {
    expect(generateRecoveryCodes(200).join("")).not.toMatch(/[ILOU]/);
  });
});

describe("matchRecoveryCode", () => {
  const codes = ["7KQM-2XPA", "R9TD-4HWN", "C3VX-8JQE"];
  const hashes = codes.map((code) => hashRecoveryCode(code, key));

  it("returns which code was used", () => {
    expect(matchRecoveryCode("R9TD-4HWN", hashes, key)).toBe(1);
  });

  it.each(["r9td-4hwn", "R9TD4HWN", " r9td 4hwn ", "R9TD–4HWN"])("forgives case, spaces and the hyphen: %j", (typed) => {
    expect(matchRecoveryCode(typed, hashes, key)).toBe(1);
  });

  it("reads O as 0 and I or L as 1, as the alphabet never prints them", () => {
    const hash = [hashRecoveryCode("10Q0-2XPA", key)];

    expect(matchRecoveryCode("lOQo-2xpa", hash, key)).toBe(0);
    expect(matchRecoveryCode("IOQO-2XPA", hash, key)).toBe(0);
  });

  it("refuses a code that is not there", () => {
    expect(matchRecoveryCode("ZZZZ-ZZZZ", hashes, key)).toBeNull();
    expect(matchRecoveryCode("", hashes, key)).toBeNull();
  });

  it("refuses a hash made with another key, so the database alone proves nothing", () => {
    expect(matchRecoveryCode("7KQM-2XPA", [hashRecoveryCode("7KQM-2XPA", randomBytes(32))], key)).toBeNull();
  });

  it("stores neither the code nor its plain digest", () => {
    expect(hashes[0]).not.toContain("7KQM");
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});

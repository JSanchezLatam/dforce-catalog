import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("password (R9.5 — bcrypt cost >= 12, unique salt per hash)", () => {
  it("hashes with the bcrypt cost-12 prefix", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$2b\$12\$/);
  });

  it("produces a different hash for the same password on each call (unique salt)", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same-password"),
      hashPassword("same-password"),
    ]);
    expect(a).not.toBe(b);
  });

  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });
});

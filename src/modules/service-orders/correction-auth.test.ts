import { describe, expect, it, vi } from "vitest";

import { authorizeCorrection, CorrectionRefusedError } from "./correction-auth";

const MINUTE = 60_000;

type Row = { role: string; deactivatedAt: Date | null; passwordHash: string };

/**
 * The throttle is module state keyed by user id, so every test uses ids of its
 * own instead of a test-only reset hook in production code. `verify` compares
 * plain to hash literally, so "whose hash was read" is observable.
 */
function setup(users: Record<string, Row>, startAt = 1_000_000) {
  let clock = startAt;
  const verify = vi.fn(async (plain: string, hash: string) => plain === hash);
  const findUser = vi.fn(async (id: string) => users[id] ?? null);
  const deps = { now: () => clock, findUser, verifyPassword: verify };
  return {
    verify,
    findUser,
    advance: (ms: number) => (clock += ms),
    run: (id: string, password: string) => authorizeCorrection(id, password, deps),
  };
}

const admin = (passwordHash: string): Row => ({ role: "administrador", deactivatedAt: null, passwordHash });

const refusal = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(CorrectionRefusedError);
  return (err as CorrectionRefusedError).reason;
};

describe("authorizeCorrection", () => {
  it("grants the corrector id on the right password", async () => {
    const t = setup({ "grant-a": admin("pw") });
    await expect(t.run("grant-a", "pw")).resolves.toEqual({ correctorId: "grant-a" });
  });

  it("refuses a técnico as not_admin and never calls bcrypt", async () => {
    const t = setup({ "tec-a": { role: "tecnico", deactivatedAt: null, passwordHash: "pw" } });
    expect(await refusal(t.run("tec-a", "pw"))).toBe("not_admin");
    expect(t.verify).not.toHaveBeenCalled();
  });

  it("refuses a deactivated administrator and never calls bcrypt", async () => {
    const t = setup({ "deact-a": { ...admin("pw"), deactivatedAt: new Date(0) } });
    expect(await refusal(t.run("deact-a", "pw"))).toBe("not_admin");
    expect(t.verify).not.toHaveBeenCalled();
  });

  it("refuses an unknown user as not_admin", async () => {
    const t = setup({});
    expect(await refusal(t.run("ghost-a", "pw"))).toBe("not_admin");
  });

  it("refuses a wrong password as wrong_password", async () => {
    const t = setup({ "wrong-a": admin("pw") });
    expect(await refusal(t.run("wrong-a", "nope"))).toBe("wrong_password");
  });

  it("verifies against the session user's own hash, never another administrator's", async () => {
    const t = setup({ "own-a": admin("mine"), "own-b": admin("theirs") });
    expect(await refusal(t.run("own-a", "theirs"))).toBe("wrong_password");
  });

  it("answers the 5th failure as wrong, then throttles even the correct password without verifying", async () => {
    const t = setup({ "thr-a": admin("pw") });
    for (let i = 0; i < 5; i++) expect(await refusal(t.run("thr-a", "nope"))).toBe("wrong_password");
    t.verify.mockClear();
    expect(await refusal(t.run("thr-a", "pw"))).toBe("throttled");
    expect(t.verify).not.toHaveBeenCalled();
  });

  it("accepts again once the oldest failure leaves the 15-minute window", async () => {
    const t = setup({ "win-a": admin("pw") });
    for (let i = 0; i < 5; i++) await refusal(t.run("win-a", "nope"));
    t.advance(15 * MINUTE + 1);
    await expect(t.run("win-a", "pw")).resolves.toEqual({ correctorId: "win-a" });
  });

  it("stays throttled just inside the window", async () => {
    const t = setup({ "edge-a": admin("pw") });
    for (let i = 0; i < 5; i++) await refusal(t.run("edge-a", "nope"));
    t.advance(15 * MINUTE - 1);
    expect(await refusal(t.run("edge-a", "pw"))).toBe("throttled");
  });

  it("clears the failures on success", async () => {
    const t = setup({ "clr-a": admin("pw") });
    for (let i = 0; i < 4; i++) await refusal(t.run("clr-a", "nope"));
    await t.run("clr-a", "pw");
    for (let i = 0; i < 4; i++) expect(await refusal(t.run("clr-a", "nope"))).toBe("wrong_password");
  });

  it("throttles per user", async () => {
    const t = setup({ "iso-a": admin("pw"), "iso-b": admin("pw") });
    for (let i = 0; i < 5; i++) await refusal(t.run("iso-a", "nope"));
    await expect(t.run("iso-b", "pw")).resolves.toEqual({ correctorId: "iso-b" });
  });

  it("checks the throttle before it looks the user up or hashes", async () => {
    const t = setup({ "ord-a": admin("pw") });
    for (let i = 0; i < 5; i++) await refusal(t.run("ord-a", "nope"));
    t.findUser.mockClear();
    t.verify.mockClear();
    await refusal(t.run("ord-a", "pw"));
    expect(t.findUser).not.toHaveBeenCalled();
    expect(t.verify).not.toHaveBeenCalled();
  });

  it("counts concurrent guesses: 6 parallel wrong passwords cannot all reach bcrypt", async () => {
    const t = setup({ "race-a": admin("pw") });
    t.verify.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return false;
    });
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => t.run("race-a", "nope")));
    const reasons = outcomes.map((o) => (o.status === "rejected" ? (o.reason as CorrectionRefusedError).reason : "granted"));
    expect(reasons).toContain("throttled");
    expect(t.verify.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("a not_admin refusal leaves no reservation behind", async () => {
    const users = { "rel-a": { role: "tecnico", deactivatedAt: null, passwordHash: "pw" } as Row };
    const t = setup(users);
    for (let i = 0; i < 6; i++) expect(await refusal(t.run("rel-a", "pw"))).toBe("not_admin");
  });
});

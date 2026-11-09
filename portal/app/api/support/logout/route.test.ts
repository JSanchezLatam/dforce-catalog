import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

let authed: boolean;
vi.mock("../../../../src/support/session", async (original) => ({
  ...(await original<typeof import("../../../../src/support/session")>()),
  requireSupport: async () => authed,
}));

beforeEach(() => {
  authed = true;
});

describe("POST /api/support/logout", () => {
  it("clears the cookie for a valid session", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^support_session=; Max-Age=0; /);
  });

  it("answers 401 and sets nothing without a session", async () => {
    authed = false;
    const res = await POST();
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

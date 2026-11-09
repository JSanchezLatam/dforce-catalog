import { describe, expect, it } from "vitest";

import { clientIp } from "./throttle";

const req = (headers: Record<string, string>) => new Request("http://portal.test/api/support/login", { headers });

describe("clientIp", () => {
  it("is the first x-forwarded-for hop, trimmed", () => {
    expect(clientIp(req({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("falls back to one shared bucket when the header is missing or empty", () => {
    expect(clientIp(req({}))).toBe("unknown");
    expect(clientIp(req({ "x-forwarded-for": "" }))).toBe("unknown");
  });
});

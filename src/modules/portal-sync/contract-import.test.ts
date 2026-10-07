import { describe, expect, it } from "vitest";

import { sign, verify, type IngestBody } from "@portal/contract";

// The workshop signs with the portal's own code through the `@portal/contract`
// alias (tsconfig `paths` + vitest `resolve.alias`). If either side of the
// alias breaks, this file stops resolving, under tsc or under vitest.
describe("@portal/contract from the workshop", () => {
  it("signs a body that the same module verifies", () => {
    const body: IngestBody = { kind: "delete", clienteId: "c1", version: 1 };
    const raw = JSON.stringify(body);
    expect(verify(raw, new Headers(sign(raw, "s")), "s")).toBe(true);
  });
});

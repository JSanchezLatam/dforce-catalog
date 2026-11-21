import { describe, expect, it } from "vitest";

import { userAccessFacts } from "./access-facts";

// The SQL is pinned in `src/e2e/two-factor-reset.e2e.test.ts`; `DATABASE_URL` points nowhere here, so this proves no query runs.
describe("userAccessFacts", () => {
  it("answers an empty list with an empty map, without querying", async () => {
    expect(await userAccessFacts([])).toEqual(new Map());
  });
});

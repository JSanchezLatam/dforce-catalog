import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("No customer data - kanban/queries.ts", () => {
  const source = readFileSync(join(__dirname, "queries.ts"), "utf8");

  it("never mentions the cliente table, its schema export or its columns", () => {
    expect(source).not.toMatch(/\bcliente\b/);
    expect(source).not.toMatch(/\bclienteId\b/);
    expect(source).not.toMatch(/portalToken/);
  });
});

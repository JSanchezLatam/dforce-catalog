import { describe, expect, it } from "vitest";

import { fold } from "./text";

describe("fold()", () => {
  it("lowercases and strips accents", () => {
    expect(fold("Órdenes")).toBe("ordenes");
    expect(fold("Sofía")).toBe("sofia");
  });
});

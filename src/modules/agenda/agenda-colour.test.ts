/**
 * Text guard over `globals.css`: jsdom loads no stylesheet, so the colour hooks the cards rely on can only
 * be pinned by reading the source. A hook that vanished would leave every card grey with a green suite.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.resolve(import.meta.dirname, "../../app/globals.css"), "utf8");

const HUES = { instalacion: 262, mant_preventivo: 205, mant_correctivo: 35, reparacion: 350, revisado: 152, none: 240 } as const;

describe("agenda colour hooks", () => {
  it("defines the card, the time strip and the dot", () => {
    for (const hook of [".agenda-ev", ".agenda-ev-strip", ".agenda-dot"]) expect(css).toContain(`${hook} {`);
  });

  it.each(Object.entries(HUES))("Colour follows the type: [data-categoria=%s] sets hue %i", (key, hue) => {
    expect(css).toMatch(new RegExp(`\\[data-categoria="${key}"\\]\\s*\\{[^}]*--h:\\s*${hue};`));
  });

  it("the untyped hue is desaturated, so a null type reads neutral", () => {
    expect(css).toMatch(/\[data-categoria="none"\]\s*\{[^}]*--s:\s*6%/);
  });

  it("has a dark variant of the card and of its strip", () => {
    expect(css).toContain(".dark .agenda-ev {");
    expect(css).toContain(".dark .agenda-ev-strip {");
  });
});

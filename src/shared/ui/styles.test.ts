import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FIELD_ERROR, SUCCESS_TEXT } from "./styles";

/**
 * Audit #21: "Configuración guardada." and the other four saved messages were
 * `text-green-600` (about 3.3:1 on white, no dark counterpart). Field errors
 * were `text-destructive`: 3.60:1 on white in light and a near-maroon
 * background tone in dark (see `badge.test.tsx`). Both now carry a theme pair,
 * `text-red-700 dark:text-red-400` being the pair measured in `badge.test.tsx`.
 * jsdom computes no colour: class strings only.
 */
describe("styles — theme-paired text colours (audit #7, #21)", () => {
  it("FIELD_ERROR is a red pair, not `--destructive`", () => {
    expect(FIELD_ERROR).toBe("text-sm text-red-700 dark:text-red-400");
    expect(FIELD_ERROR).not.toContain("text-destructive");
  });

  it("SUCCESS_TEXT is a green pair, not the unpaired green-600", () => {
    expect(SUCCESS_TEXT).toBe("text-green-700 dark:text-green-400");
    expect(SUCCESS_TEXT).not.toContain("green-600");
  });

  /**
   * The five "saved" messages live in forms whose server-action plumbing is not
   * worth mocking just to read one class. A source scan is the honest, cheap
   * guard: it fails if a copy goes back to the unpaired green.
   */
  it.each([
    "src/modules/account/PasswordForm.tsx",
    "src/modules/account/ProfileForm.tsx",
    "src/modules/workshop-config/WorkshopConfigForm.tsx",
    "src/modules/template-config/TemplateConfigForm.tsx",
    "src/modules/catalog-builder/CatalogBuilderForm.tsx",
  ])("%s uses SUCCESS_TEXT and no raw green-600", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");

    expect(source).toContain("SUCCESS_TEXT");
    expect(source).not.toContain("text-green-600");
  });
});

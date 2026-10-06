import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CARD_MUTED, PLATE_BADGE_MUTED, DEACTIVATED_CHIP, FIELD_ERROR, PAGE_HEADING, SUCCESS_TEXT } from "./styles";

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

/**
 * Audit #1/#11: a fixed 32px title wrapped "Órdenes de servicio" onto two lines
 * at 390px. 24px on phones, 32px from `sm`. The bottom margin moved to
 * `PageHeader`, which owns the spacing under the whole header.
 */
describe("styles — PAGE_HEADING (audit #1, #11)", () => {
  // Tight leading is for a phone, where the 24px title can wrap to two lines.
  // From `sm` it returns to `leading-normal` (1.5, what Tailwind's preflight
  // gave the old `text-[32px]` title), so a one-line desktop title keeps the
  // 48px box it always had. `leading-tight` at 32px would be 40px: 8px of
  // vertical drift on every page, which no screenshot would have flagged.
  it("is 24px on phones and 32px from sm, tight leading on phones only, no margin of its own", () => {
    expect(PAGE_HEADING).toBe("text-2xl sm:text-[32px] font-bold leading-tight sm:leading-normal text-foreground");
  });
});

/**
 * The Desactivado chip was copied into `customers/page.tsx` and
 * `UsersTable.tsx` (a page file cannot export it). One constant now, so a
 * retired customer and a retired user cannot drift apart.
 */
describe("styles — DEACTIVATED_CHIP (mobile-responsive-pass 9.v)", () => {
  it("is the red pair, tinted, never `--destructive` as text", () => {
    expect(DEACTIVATED_CHIP).toBe(
      "rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400",
    );
    expect(DEACTIVATED_CHIP).not.toMatch(/(^|\s)text-destructive(\s|$)/);
  });

  it.each(["src/app/(app)/customers/page.tsx", "src/modules/account/UsersTable.tsx"])(
    "%s imports it instead of keeping its own copy",
    (file) => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).toMatch(/import \{[^}]*\bDEACTIVATED_CHIP\b[^}]*\} from "@\/shared\/ui\/styles"/);
      expect(source).not.toMatch(/const DEACTIVATED_CHIP\b/);
    },
  );
});

/**
 * Audit-final N5: `text-muted-foreground` on `bg-muted` is 4.40:1 in light
 * (min 4.5), which is what the deactivated vehicle card's plate and "Vehículo
 * desactivado" read at. `text-foreground/70` is 7.4:1 on the same surface; dark
 * keeps the token it was already measured with.
 */
describe("styles — CARD_MUTED contrast (audit-final N5)", () => {
  it("is a darker text in light and the muted token in dark", () => {
    expect(CARD_MUTED.split(" ")).toEqual(
      expect.arrayContaining(["bg-muted", "text-foreground/70", "dark:text-muted-foreground"]),
    );
    expect(CARD_MUTED.split(" ")).not.toContain("text-muted-foreground");
  });

  // The plate badge sits on the same `bg-muted` and set its own colour, so
  // fixing the card alone left the plate at 4.40:1.
  it("PLATE_BADGE_MUTED gets the same pair", () => {
    expect(PLATE_BADGE_MUTED.split(" ")).toEqual(
      expect.arrayContaining(["bg-muted", "text-foreground/70", "dark:text-muted-foreground"]),
    );
    expect(PLATE_BADGE_MUTED.split(" ")).not.toContain("text-muted-foreground");
  });
});

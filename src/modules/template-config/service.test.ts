import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { templateConfig } from "@/shared/db/schema";
import {
  getTemplateConfig,
  saveTemplateConfig,
  TemplateConfigValidationError,
  validateTemplateConfigInput,
} from "./service";

/**
 * catalog-templates-and-workshop-info WU3 (design D2, task 3.12) —
 * `template_config.logo_url/primary_colors/font/cover_text` are dropped by
 * migration `0009`. Font/colours are now template-fixed (the registry, see
 * `registry.test.ts`); logo/cover-text are workshop-owned
 * (`workshop-config/service.test.ts`). This module's input shrinks to only
 * what still lives in `template_config`: `selectedTemplateId` and
 * `defaultImageHandling`.
 */
describe("validateTemplateConfigInput — post-migration-0009 shape", () => {
  it("returns no keys for an empty input — absent means untouched, not cleared", () => {
    expect(validateTemplateConfigInput({})).toEqual({});
  });

  it("accepts a known selectedTemplateId", () => {
    expect(validateTemplateConfigInput({ selectedTemplateId: "dforce-classic" }).selectedTemplateId).toBe(
      "dforce-classic",
    );
  });

  it("keeps an explicit null — clearing the selection is a real intent, distinct from omitting it", () => {
    const parsed = validateTemplateConfigInput({ selectedTemplateId: null });
    expect("selectedTemplateId" in parsed).toBe(true);
    expect(parsed.selectedTemplateId).toBeNull();
  });

  it("rejects an id not in the registry instead of silently clearing the selection", () => {
    expect(() => validateTemplateConfigInput({ selectedTemplateId: "not-a-real-template" })).toThrow(
      TemplateConfigValidationError,
    );
  });

  it("rejects a non-string selectedTemplateId", () => {
    expect(() => validateTemplateConfigInput({ selectedTemplateId: 42 })).toThrow(TemplateConfigValidationError);
  });

  it("accepts strict/adaptive defaultImageHandling and rejects anything else", () => {
    expect(validateTemplateConfigInput({ defaultImageHandling: "strict" }).defaultImageHandling).toBe("strict");
    expect(validateTemplateConfigInput({ defaultImageHandling: "adaptive" }).defaultImageHandling).toBe("adaptive");
    expect(() => validateTemplateConfigInput({ defaultImageHandling: "bogus" })).toThrow(
      TemplateConfigValidationError,
    );
  });
});

/**
 * The partial-touch guard, mirroring `workshop-config/service.ts`'s
 * `"field" in parsed` discipline. Without it the upsert's `set:` clause
 * writes every key on every POST, so a caller that omits
 * `selectedTemplateId` silently clears a selection R8.4 requires to survive.
 */
describe("saveTemplateConfig — partial touch", () => {
  function stubDb() {
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "singleton" }]) });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    return { db: { insert: vi.fn().mockReturnValue({ values }) }, values, onConflictDoUpdate };
  }

  it("does not touch selectedTemplateId when the caller omits it", async () => {
    const { db, values, onConflictDoUpdate } = stubDb();

    await saveTemplateConfig({ defaultImageHandling: "strict" }, db as never);

    expect(values.mock.calls[0][0]).not.toHaveProperty("selectedTemplateId");
    const { set } = onConflictDoUpdate.mock.calls[0][0] as { set: Record<string, unknown> };
    expect(set).not.toHaveProperty("selectedTemplateId");
  });

  it("does not touch defaultImageHandling when the caller omits it", async () => {
    const { db, values, onConflictDoUpdate } = stubDb();

    await saveTemplateConfig({ selectedTemplateId: "dforce-classic" }, db as never);

    expect(values.mock.calls[0][0]).not.toHaveProperty("defaultImageHandling");
    const { set } = onConflictDoUpdate.mock.calls[0][0] as { set: Record<string, unknown> };
    expect(set).not.toHaveProperty("defaultImageHandling");
  });
});

/**
 * Injected-dep unit tests, not proof of real persistence (AGENTS.md's
 * coverage-limit rule) — same pattern as WU2's persistence tests.
 */
describe("selectedTemplateId persistence (R8.4)", () => {
  it("passes selectedTemplateId to both the insert values and the onConflictDoUpdate set clause", async () => {
    const row = { id: "singleton", selectedTemplateId: "dforce-classic" };
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([row]) });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const db = { insert: vi.fn().mockReturnValue({ values }) };

    await saveTemplateConfig({ selectedTemplateId: "dforce-classic" }, db as never);

    expect(values.mock.calls[0][0]).toEqual(expect.objectContaining({ selectedTemplateId: "dforce-classic" }));
    const onConflictArg = onConflictDoUpdate.mock.calls[0][0] as { set: Record<string, unknown> };
    expect(onConflictArg.set).toEqual(expect.objectContaining({ selectedTemplateId: "dforce-classic" }));
  });

  it("getTemplateConfig queries the template_config table with limit 1 and returns its row", async () => {
    const row = { id: "singleton", selectedTemplateId: "dforce-classic" };
    const limit = vi.fn().mockResolvedValue([row]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const db = { select: vi.fn().mockReturnValue({ from }) };

    const result = await getTemplateConfig(db as never);

    expect(from).toHaveBeenCalledWith(templateConfig);
    expect(where).toHaveBeenCalledWith(eq(templateConfig.id, "singleton"));
    expect(limit).toHaveBeenCalledWith(1);
    expect(result).toEqual(row);
  });
});

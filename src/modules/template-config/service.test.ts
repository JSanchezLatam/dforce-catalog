import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { templateConfig } from "@/shared/db/schema";
import { getTemplateConfig, saveTemplateConfig, validateTemplateConfigInput } from "./service";

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
  it("accepts an empty input — neither remaining field is required", () => {
    expect(validateTemplateConfigInput({})).toEqual({ defaultImageHandling: null, selectedTemplateId: null });
  });

  it("accepts a known selectedTemplateId", () => {
    expect(validateTemplateConfigInput({ selectedTemplateId: "dforce-classic" }).selectedTemplateId).toBe(
      "dforce-classic",
    );
  });

  it("falls back to null for an id not in the registry (R8.4)", () => {
    expect(validateTemplateConfigInput({ selectedTemplateId: "not-a-real-template" }).selectedTemplateId).toBeNull();
  });

  it("falls back to null for a non-string selectedTemplateId", () => {
    expect(validateTemplateConfigInput({ selectedTemplateId: 42 }).selectedTemplateId).toBeNull();
  });

  it("accepts strict/adaptive defaultImageHandling and defaults invalid values to null", () => {
    expect(validateTemplateConfigInput({ defaultImageHandling: "strict" }).defaultImageHandling).toBe("strict");
    expect(validateTemplateConfigInput({ defaultImageHandling: "adaptive" }).defaultImageHandling).toBe("adaptive");
    expect(validateTemplateConfigInput({ defaultImageHandling: "bogus" }).defaultImageHandling).toBeNull();
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

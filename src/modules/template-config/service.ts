/**
 * template-config — persisted template selection (R8.1,8.2,8.4).
 *
 * catalog-templates-and-workshop-info WU3 (task 3.12, migration `0009`):
 * font/colours/logo/cover-text are no longer validated or persisted here —
 * font and colours are template-fixed (the registry); logo and cover-text
 * are workshop-owned (`workshop-config/service.ts`). This module now only
 * validates the two fields `template_config` still has.
 *
 * ponytail: singleton-row-no-history (see schema.ts comment on
 * `templateConfig`) — one row, keyed by `SINGLETON_ID`, upserted in place.
 */
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/shared/db/client";
import { templateConfig, type TemplateConfig } from "@/shared/db/schema";
import { KNOWN_TEMPLATE_IDS } from "@/shared/template/template-ids";

const SINGLETON_ID = "singleton";

export type TemplateConfigInput = {
  defaultImageHandling?: "strict" | "adaptive" | null;
  /** Registry template id — NULL/unknown falls back to the default (R8.4). */
  selectedTemplateId?: string | null;
};

export class TemplateConfigValidationError extends Error {
  constructor(public readonly errors: Record<string, string>) {
    super("Invalid template config");
  }
}

/** Pure — no DB access. Neither remaining field can fail validation; an invalid value falls back to null rather than erroring. */
export function validateTemplateConfigInput(input: unknown): TemplateConfigInput {
  const value = (input ?? {}) as Partial<Record<string, unknown>>;

  const rawHandling = value.defaultImageHandling;
  const defaultImageHandling = rawHandling === "strict" || rawHandling === "adaptive" ? rawHandling : null;

  // Unknown-but-valid-shape ids fall back to null (→ getTemplate(null) →
  // the default) rather than an error: R8.4's "orphaned id falls back"
  // scenario also covers a stale client posting an id a registry edit
  // removed, not just a corrupted DB row.
  const rawTemplateId = value.selectedTemplateId;
  const selectedTemplateId =
    typeof rawTemplateId === "string" && (KNOWN_TEMPLATE_IDS as readonly string[]).includes(rawTemplateId)
      ? rawTemplateId
      : null;

  return { defaultImageHandling, selectedTemplateId };
}

/** Returns null when the admin has never saved a config yet (page renders a blank form). */
export async function getTemplateConfig(
  db: { select: typeof defaultDb.select } = defaultDb,
): Promise<TemplateConfig | null> {
  const rows = await db.select().from(templateConfig).where(eq(templateConfig.id, SINGLETON_ID)).limit(1);
  return rows[0] ?? null;
}

/** Validates then upserts the singleton row (R8.2 — applies to catalogs generated from now on). */
export async function saveTemplateConfig(
  input: unknown,
  db: { insert: typeof defaultDb.insert } = defaultDb,
): Promise<TemplateConfig> {
  const value = validateTemplateConfigInput(input);
  const updatedAt = new Date();
  const [row] = await db
    .insert(templateConfig)
    .values({ id: SINGLETON_ID, ...value, updatedAt })
    .onConflictDoUpdate({ target: templateConfig.id, set: { ...value, updatedAt } })
    .returning();
  return row;
}

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

/**
 * Pure — no DB access. Returns ONLY the keys the caller actually sent, the
 * same partial-touch discipline as `workshop-config/service.ts`: an absent
 * key means "leave it alone", an explicit `null` means "clear it". Returning
 * both keys unconditionally would make the upsert's `set:` clause below
 * overwrite a stored `selectedTemplateId` with null on any POST that omits
 * it — silently losing the selection R8.4 requires to survive.
 *
 * R8.4's "unknown id falls back to the default" is a READ rule and lives in
 * `getTemplate` (proved by `registry.test.ts`). On WRITE this is a trust
 * boundary — `route.ts` hands us the raw request body — so an id the registry
 * does not know is rejected, not coerced. Coercing here would answer 200 to a
 * client whose selection we just threw away.
 */
export function validateTemplateConfigInput(input: unknown): TemplateConfigInput {
  const value = (input ?? {}) as Partial<Record<string, unknown>>;
  const errors: Record<string, string> = {};
  const parsed: TemplateConfigInput = {};

  if ("defaultImageHandling" in value) {
    const raw = value.defaultImageHandling;
    if (raw === "strict" || raw === "adaptive" || raw === null) {
      parsed.defaultImageHandling = raw;
    } else {
      errors.defaultImageHandling = "Debe ser 'strict' o 'adaptive'.";
    }
  }

  if ("selectedTemplateId" in value) {
    const raw = value.selectedTemplateId;
    if (raw === null) {
      parsed.selectedTemplateId = null;
    } else if (typeof raw === "string" && (KNOWN_TEMPLATE_IDS as readonly string[]).includes(raw)) {
      parsed.selectedTemplateId = raw;
    } else {
      errors.selectedTemplateId = "No existe una plantilla con ese identificador.";
    }
  }

  if (Object.keys(errors).length > 0) throw new TemplateConfigValidationError(errors);
  return parsed;
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

/**
 * template-config — persisted catalog branding (R8.1,8.2,8.4).
 *
 * ponytail: singleton-row-no-history (see schema.ts comment on
 * `templateConfig`) — one row, keyed by `SINGLETON_ID`, upserted in place.
 */
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/shared/db/client";
import { templateConfig, type TemplateConfig } from "@/shared/db/schema";

const SINGLETON_ID = "singleton";

export type TemplateConfigInput = {
  logoUrl: string;
  primaryColors: { primary: string; secondary: string };
  font: string;
  coverText: string;
  defaultImageHandling?: "strict" | "adaptive" | null;
  /**
   * Registry template id (catalog-templates-and-workshop-info WU2) — additive
   * and unwired: nothing reads it yet (WU3 wires `getTemplate()` into the
   * renderer). The four legacy branding fields above stay required here
   * because `template_config`'s columns are still `NOT NULL` until
   * migration `0009` — see design.md Risk #3.
   */
  selectedTemplateId?: string | null;
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_FONT_LENGTH = 100;
const MAX_COVER_TEXT_LENGTH = 300;

export class TemplateConfigValidationError extends Error {
  constructor(public readonly errors: Record<string, string>) {
    super("Invalid template config");
  }
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Pure — no DB access — R8.1's "at least logo, primary colors, typography, cover text". */
export function validateTemplateConfigInput(input: unknown): TemplateConfigInput {
  const errors: Record<string, string> = {};
  const value = (input ?? {}) as Partial<Record<string, unknown>>;

  const logoUrl = typeof value.logoUrl === "string" ? value.logoUrl : "";
  if (!logoUrl || !isValidUrl(logoUrl)) {
    errors.logoUrl = "Logo must be a valid URL";
  }

  const colors = (value.primaryColors ?? {}) as Partial<Record<string, unknown>>;
  const primary = typeof colors.primary === "string" ? colors.primary : "";
  const secondary = typeof colors.secondary === "string" ? colors.secondary : "";
  if (!HEX_COLOR.test(primary)) {
    errors.primaryColor = "Primary color must be a hex value like #1a2b3c";
  }
  if (!HEX_COLOR.test(secondary)) {
    errors.secondaryColor = "Secondary color must be a hex value like #1a2b3c";
  }

  const font = typeof value.font === "string" ? value.font.trim() : "";
  if (!font || font.length > MAX_FONT_LENGTH) {
    errors.font = `Font must be 1-${MAX_FONT_LENGTH} characters`;
  }

  const coverText = typeof value.coverText === "string" ? value.coverText.trim() : "";
  if (!coverText || coverText.length > MAX_COVER_TEXT_LENGTH) {
    errors.coverText = `Cover text must be 1-${MAX_COVER_TEXT_LENGTH} characters`;
  }

  const rawHandling = (value as Record<string, unknown>).defaultImageHandling;
  const defaultImageHandling = rawHandling === "strict" || rawHandling === "adaptive" ? rawHandling : null;

  const rawTemplateId = value.selectedTemplateId;
  const selectedTemplateId = typeof rawTemplateId === "string" ? rawTemplateId : null;

  if (Object.keys(errors).length > 0) {
    throw new TemplateConfigValidationError(errors);
  }

  return { logoUrl, primaryColors: { primary, secondary }, font, coverText, defaultImageHandling, selectedTemplateId };
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

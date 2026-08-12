import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/shared/db/client";
import { workshopConfig, type WorkshopConfig } from "@/shared/db/schema";

const SINGLETON_ID = "singleton";
const MAX_NAME_LENGTH = 100;

/** Plain-string contact fields, stored verbatim (no trimming) — "hours" must never be reshaped per the free-text spec. */
const TEXT_FIELDS = ["phone", "whatsapp", "email", "address", "hours", "website", "coverText"] as const;

export type WorkshopConfigInput = {
  name: string | null;
  // `undefined` (key absent) means "leave untouched" — a name-only save must
  // NOT clobber an existing logo. `null` means "explicitly clear" (DELETE
  // flow). Only fields present on `input` are ever written to the update
  // `set` clause — see saveWorkshopConfig below.
  logoR2Key?: string | null;
  logoContentType?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  /** Free-text, e.g. "Lun-Vie 9-18, Sáb 9-13" — stored verbatim, no per-day parsing. */
  hours?: string | null;
  website?: string | null;
  coverText?: string | null;
  /** Open-ended platform → handle map — a new platform needs no schema change. */
  socialHandles?: Record<string, string> | null;
};

export class WorkshopConfigValidationError extends Error {
  constructor(public readonly errors: Record<string, string>) {
    super("Invalid workshop config");
  }
}

export function validateWorkshopConfigInput(input: unknown): WorkshopConfigInput {
  const errors: Record<string, string> = {};
  const value = (input ?? {}) as Record<string, unknown>;

  const name = typeof value.name === "string" ? value.name.trim() : null;
  if (name !== null && name.length > MAX_NAME_LENGTH) {
    errors.name = `Name must be ${MAX_NAME_LENGTH} characters or less`;
  }

  if (Object.keys(errors).length > 0) {
    throw new WorkshopConfigValidationError(errors);
  }

  const result: WorkshopConfigInput = { name };
  if ("logoR2Key" in value) {
    result.logoR2Key = value.logoR2Key === null ? null : String(value.logoR2Key);
  }
  if ("logoContentType" in value) {
    result.logoContentType = value.logoContentType === null ? null : String(value.logoContentType);
  }
  for (const field of TEXT_FIELDS) {
    if (field in value) {
      result[field] = value[field] === null ? null : String(value[field]);
    }
  }
  if ("socialHandles" in value) {
    result.socialHandles = value.socialHandles === null ? null : (value.socialHandles as Record<string, string>);
  }
  return result;
}

export async function getWorkshopConfig(
  db: { select: typeof defaultDb.select } = defaultDb,
): Promise<WorkshopConfig | null> {
  const rows = await db.select().from(workshopConfig).where(eq(workshopConfig.id, SINGLETON_ID)).limit(1);
  return rows[0] ?? null;
}

export async function saveWorkshopConfig(
  input: unknown,
  db: { insert: typeof defaultDb.insert } = defaultDb,
): Promise<WorkshopConfig> {
  const parsed = validateWorkshopConfigInput(input);
  const updatedAt = new Date();

  const insertValues: typeof workshopConfig.$inferInsert = { id: SINGLETON_ID, name: parsed.name, updatedAt };
  const updateSet: Partial<typeof workshopConfig.$inferInsert> = { name: parsed.name, updatedAt };

  // Only touch logoR2Key/logoContentType when the caller explicitly provided
  // them — a name-only save (e.g. the workshop-settings form) must not send
  // a NULL that wipes out a logo uploaded through the separate logo route.
  if ("logoR2Key" in parsed) {
    insertValues.logoR2Key = parsed.logoR2Key ?? null;
    updateSet.logoR2Key = parsed.logoR2Key ?? null;
  }
  if ("logoContentType" in parsed) {
    insertValues.logoContentType = parsed.logoContentType ?? null;
    updateSet.logoContentType = parsed.logoContentType ?? null;
  }
  for (const field of TEXT_FIELDS) {
    if (field in parsed) {
      insertValues[field] = parsed[field] ?? null;
      updateSet[field] = parsed[field] ?? null;
    }
  }
  if ("socialHandles" in parsed) {
    insertValues.socialHandles = parsed.socialHandles ?? null;
    updateSet.socialHandles = parsed.socialHandles ?? null;
  }

  const [row] = await db
    .insert(workshopConfig)
    .values(insertValues)
    .onConflictDoUpdate({ target: workshopConfig.id, set: updateSet })
    .returning();
  return row;
}

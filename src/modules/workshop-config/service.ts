import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/shared/db/client";
import { workshopConfig, type WorkshopConfig } from "@/shared/db/schema";

const SINGLETON_ID = "singleton";
const MAX_NAME_LENGTH = 100;
const MAX_COVER_TEXT_LENGTH = 500;

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

/**
 * Reads one optional text field off the raw request body. Returns `undefined`
 * when the key is absent OR its value is neither a string nor `null` — a
 * malformed field (e.g. an object where the route.ts trust boundary expects
 * a string) is silently treated as "not provided", never coerced via
 * `String()` (that turned `{}` into the literal text `"[object Object]"`).
 * An empty/whitespace-only string collapses to `null` so an untouched field
 * persists as NULL, not `""` — the catalog render must be able to tell
 * "not set" from "set to nothing" (spec: fields left unset are omitted, not
 * rendered blank). Non-empty values are returned verbatim, unmodified —
 * `hours` in particular must never be reshaped.
 */
function readTextField(value: Record<string, unknown>, field: string): string | null | undefined {
  if (!(field in value)) return undefined;
  const raw = value[field];
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  return raw.trim() === "" ? null : raw;
}

export function validateWorkshopConfigInput(input: unknown): WorkshopConfigInput {
  const errors: Record<string, string> = {};
  const value = (input ?? {}) as Record<string, unknown>;

  const name = typeof value.name === "string" ? value.name.trim() : null;
  if (name !== null && name.length > MAX_NAME_LENGTH) {
    errors.name = `Name must be ${MAX_NAME_LENGTH} characters or less`;
  }

  const coverText = readTextField(value, "coverText");
  if (coverText !== undefined && coverText !== null && coverText.length > MAX_COVER_TEXT_LENGTH) {
    errors.coverText = `Cover text must be ${MAX_COVER_TEXT_LENGTH} characters or less`;
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
  const phone = readTextField(value, "phone");
  if (phone !== undefined) result.phone = phone;
  const whatsapp = readTextField(value, "whatsapp");
  if (whatsapp !== undefined) result.whatsapp = whatsapp;
  const email = readTextField(value, "email");
  if (email !== undefined) result.email = email;
  const address = readTextField(value, "address");
  if (address !== undefined) result.address = address;
  const hours = readTextField(value, "hours");
  if (hours !== undefined) result.hours = hours;
  const website = readTextField(value, "website");
  if (website !== undefined) result.website = website;
  if (coverText !== undefined) result.coverText = coverText;
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
  if ("phone" in parsed) {
    insertValues.phone = parsed.phone ?? null;
    updateSet.phone = parsed.phone ?? null;
  }
  if ("whatsapp" in parsed) {
    insertValues.whatsapp = parsed.whatsapp ?? null;
    updateSet.whatsapp = parsed.whatsapp ?? null;
  }
  if ("email" in parsed) {
    insertValues.email = parsed.email ?? null;
    updateSet.email = parsed.email ?? null;
  }
  if ("address" in parsed) {
    insertValues.address = parsed.address ?? null;
    updateSet.address = parsed.address ?? null;
  }
  if ("hours" in parsed) {
    insertValues.hours = parsed.hours ?? null;
    updateSet.hours = parsed.hours ?? null;
  }
  if ("website" in parsed) {
    insertValues.website = parsed.website ?? null;
    updateSet.website = parsed.website ?? null;
  }
  if ("coverText" in parsed) {
    insertValues.coverText = parsed.coverText ?? null;
    updateSet.coverText = parsed.coverText ?? null;
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

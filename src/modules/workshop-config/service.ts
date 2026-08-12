import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/shared/db/client";
import { workshopConfig, type WorkshopConfig } from "@/shared/db/schema";
import {
  MAX_NAME_LENGTH,
  MAX_CONTACT_FIELD_LENGTH,
  MAX_COVER_TEXT_LENGTH,
  MAX_HANDLE_LENGTH,
  MAX_HANDLE_ENTRIES,
} from "./limits";

const SINGLETON_ID = "singleton";

const CONTACT_FIELD_LABELS: Record<string, string> = {
  phone: "El teléfono",
  whatsapp: "El WhatsApp",
  email: "El email",
  address: "La dirección",
  hours: "El horario",
  website: "El sitio web",
};

export type WorkshopConfigInput = {
  // `undefined` (key absent) means "leave untouched" — a partial save must
  // NOT clobber an existing name/logo/contact field. `null` means
  // "explicitly clear" (DELETE flow). Only fields present on `input` are
  // ever written to the update `set` clause — see saveWorkshopConfig below.
  name?: string | null;
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
 * rendered blank). Non-empty values are returned verbatim by default —
 * `hours` in particular must never be reshaped — except `{ trim: true }`
 * (used only by `name`, which has always trimmed surrounding whitespace).
 */
function readTextField(
  value: Record<string, unknown>,
  field: string,
  options: { trim?: boolean } = {},
): string | null | undefined {
  if (!(field in value)) return undefined;
  const raw = value[field];
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  if (raw.trim() === "") return null;
  return options.trim ? raw.trim() : raw;
}

/**
 * Same trust-boundary discipline as readTextField, for the one open-ended
 * jsonb field: reject anything that is not a plain object (a bare string or
 * an array would otherwise sail through `Object.entries()` in the form and
 * render bogus rows), then drop individual entries that are malformed in a
 * way no legitimate form submission produces — a non-string value, or a
 * blank/whitespace-only key or handle (the same "leave it out" collapse
 * `readTextField` applies to an empty top-level contact field, not data
 * loss). Length/count limits are a DIFFERENT case: the form's "Agregar red
 * social" button can reach them through ordinary use, so those are
 * validated separately (see validateHandleMapLimits) and reported as an
 * error, never silently dropped or truncated — a save that reports success
 * while quietly discarding entries is worse than one that refuses to save.
 */
function readHandleMap(value: Record<string, unknown>): Record<string, string> | null | undefined {
  if (!("socialHandles" in value)) return undefined;
  const raw = value.socialHandles;
  if (raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[0].trim() !== "" && entry[1].trim() !== "",
    )
    // Both trimmed the same way — a handle is a short value like "@usuario",
    // not free text like `hours`, and validateHandleMapLimits' length cap
    // must measure the same string that gets persisted, not the raw input.
    .map(([platform, handle]): [string, string] => [platform.trim(), handle.trim()]);
  return Object.fromEntries(entries);
}

/** Mutates `errors.socialHandles` when the parsed map exceeds the entry-count or per-entry length cap. */
function validateHandleMapLimits(
  handles: Record<string, string> | null | undefined,
  errors: Record<string, string>,
): void {
  if (!handles) return;
  const entries = Object.entries(handles);
  if (entries.length > MAX_HANDLE_ENTRIES) {
    errors.socialHandles = `Puedes guardar hasta ${MAX_HANDLE_ENTRIES} redes sociales`;
    return;
  }
  const tooLong = entries.some(([platform, handle]) => platform.length > MAX_HANDLE_LENGTH || handle.length > MAX_HANDLE_LENGTH);
  if (tooLong) {
    errors.socialHandles = `Cada red social debe tener ${MAX_HANDLE_LENGTH} caracteres o menos`;
  }
}

export function validateWorkshopConfigInput(input: unknown): WorkshopConfigInput {
  const errors: Record<string, string> = {};
  const value = (input ?? {}) as Record<string, unknown>;

  const name = readTextField(value, "name", { trim: true });
  if (name !== undefined && name !== null && name.length > MAX_NAME_LENGTH) {
    errors.name = `El nombre debe tener ${MAX_NAME_LENGTH} caracteres o menos`;
  }

  const phone = readTextField(value, "phone");
  const whatsapp = readTextField(value, "whatsapp");
  const email = readTextField(value, "email");
  const address = readTextField(value, "address");
  const hours = readTextField(value, "hours");
  const website = readTextField(value, "website");
  const coverText = readTextField(value, "coverText");

  for (const [field, parsedValue] of Object.entries({ phone, whatsapp, email, address, hours, website })) {
    if (parsedValue !== undefined && parsedValue !== null && parsedValue.length > MAX_CONTACT_FIELD_LENGTH) {
      errors[field] = `${CONTACT_FIELD_LABELS[field]} debe tener ${MAX_CONTACT_FIELD_LENGTH} caracteres o menos`;
    }
  }
  if (coverText !== undefined && coverText !== null && coverText.length > MAX_COVER_TEXT_LENGTH) {
    errors.coverText = `El texto de portada debe tener ${MAX_COVER_TEXT_LENGTH} caracteres o menos`;
  }

  const socialHandles = readHandleMap(value);
  validateHandleMapLimits(socialHandles, errors);

  if (Object.keys(errors).length > 0) {
    throw new WorkshopConfigValidationError(errors);
  }

  const result: WorkshopConfigInput = {};
  if (name !== undefined) result.name = name;
  if ("logoR2Key" in value) {
    result.logoR2Key = value.logoR2Key === null ? null : String(value.logoR2Key);
  }
  if ("logoContentType" in value) {
    result.logoContentType = value.logoContentType === null ? null : String(value.logoContentType);
  }
  if (phone !== undefined) result.phone = phone;
  if (whatsapp !== undefined) result.whatsapp = whatsapp;
  if (email !== undefined) result.email = email;
  if (address !== undefined) result.address = address;
  if (hours !== undefined) result.hours = hours;
  if (website !== undefined) result.website = website;
  if (coverText !== undefined) result.coverText = coverText;
  if (socialHandles !== undefined) result.socialHandles = socialHandles;
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

  const insertValues: typeof workshopConfig.$inferInsert = { id: SINGLETON_ID, updatedAt };
  const updateSet: Partial<typeof workshopConfig.$inferInsert> = { updatedAt };

  // Only touch fields the caller explicitly provided — e.g. a phone-only
  // save (a partial POST) must not send a NULL that wipes out the name, or
  // a logo uploaded through the separate logo route.
  if ("name" in parsed) {
    insertValues.name = parsed.name ?? null;
    updateSet.name = parsed.name ?? null;
  }
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

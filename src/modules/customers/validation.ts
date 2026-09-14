/**
 * customers/validation.ts — pure, DB-free validation for `cliente` (R17) and,
 * since vehicles-one-to-many (C3, design.md D6), for each `vehiculo` in a
 * customer's collection independently. Migration `0014` (slice 3) dropped
 * `cliente`'s four inline vehicle columns, so `ClienteInput` no longer has
 * flat vehicle fields — `validateVehiculoInput`/`validateVehiculosInput` are
 * the only vehicle validation now.
 *
 * Mirrors template-config/service.ts's `validateTemplateConfigInput`: a
 * single validate function that either returns a fully-typed, normalized
 * input or throws `ClienteValidationError` with ALL field errors collected
 * (not just the first).
 */
import type { VehiculoInput } from "./vehicles";

export type ClienteInput = {
  name: string;
  phone: string;
  email?: string;
  whatsappOptOut?: boolean;
  emailOptOut?: boolean;
};

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** R17 — optional leading `+`, digits, and spaces/dashes/parentheses as separators only. */
const PHONE_ALLOWED_CHARS = /^\+?[0-9\s\-()]+$/;
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

export class ClienteValidationError extends Error {
  constructor(public readonly errors: Record<string, string>) {
    super("Invalid cliente input");
  }
}

/** R17 — loose international format: optional leading `+`, 7-15 digits once separators are stripped. */
export function isValidPhoneFormat(raw: string): boolean {
  if (!PHONE_ALLOWED_CHARS.test(raw)) return false;
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
}

/**
 * Strips separators and preserves a leading `+` when present. That is ALL it
 * does — it is NOT E.164 normalization, whatever a caller might assume from
 * the name.
 *
 * E.164 is a wire format and belongs to the provider: `reminders/providers/
 * whatsapp.ts`'s `toE164` converts there, and refuses what it cannot place
 * rather than guessing. What lives here is storage — the shape the phone
 * search, duplicate detection and migration `0016` all read.
 */
export function normalizePhone(raw: string): string {
  const hasPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/[^0-9]/g, "");
  return hasPlus ? `+${digits}` : digits;
}

function trimmedOrUndefined(value: unknown): string | undefined {
  const str = typeof value === "string" ? value.trim() : "";
  return str.length > 0 ? str : undefined;
}

/** Pure — no DB access — R17's required/format/vehicle-plate rules. */
export function validateClienteInput(input: unknown): ClienteInput {
  const errors: Record<string, string> = {};
  const value = (input ?? {}) as Partial<Record<string, unknown>>;

  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) {
    errors.name = "El nombre es obligatorio";
  }

  const rawPhone = typeof value.phone === "string" ? value.phone.trim() : "";
  if (!rawPhone) {
    errors.phone = "El teléfono es obligatorio";
  } else if (!isValidPhoneFormat(rawPhone)) {
    errors.phone = "El teléfono tiene que tener entre 7 y 15 dígitos, y puede empezar con +";
  }

  const email = trimmedOrUndefined(value.email);
  if (email !== undefined && !EMAIL_FORMAT.test(email)) {
    errors.email = "El email no es válido";
  }

  const whatsappOptOut = typeof value.whatsappOptOut === "boolean" ? value.whatsappOptOut : undefined;
  const emailOptOut = typeof value.emailOptOut === "boolean" ? value.emailOptOut : undefined;

  if (Object.keys(errors).length > 0) {
    throw new ClienteValidationError(errors);
  }

  return {
    name,
    phone: normalizePhone(rawPhone),
    ...(email !== undefined ? { email } : {}),
    ...(whatsappOptOut !== undefined ? { whatsappOptOut } : {}),
    ...(emailOptOut !== undefined ? { emailOptOut } : {}),
  };
}

/**
 * D6 — R17 relocated: `plate` is required per vehicle; make/model/year stay
 * optional.
 *
 * One exception: an element asking for permanent deletion (`deleted: true`).
 * It addresses a row by `id` and every other column is about to stop
 * existing, so requiring a plate would only mean a staff member who blanked
 * the plate field and THEN removed the row got "La placa es obligatoria" for
 * a card no longer on screen. `planVehiculoReconcile` reads nothing but the
 * `id` off a deletion, so the `""` below is never persisted anywhere.
 */
export function validateVehiculoInput(input: unknown): VehiculoInput {
  const errors: Record<string, string> = {};
  const value = (input ?? {}) as Partial<Record<string, unknown>>;

  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : undefined;
  const deleted = typeof value.deleted === "boolean" ? value.deleted : undefined;
  const plate = trimmedOrUndefined(value.plate);
  if (!plate && deleted !== true) {
    errors.plate = "La placa es obligatoria";
  }

  const make = trimmedOrUndefined(value.make);
  const model = trimmedOrUndefined(value.model);
  const year = typeof value.year === "number" && Number.isFinite(value.year) ? value.year : undefined;
  // Never defaulted: an absent `deactivated` means "leave this vehicle's
  // activation state alone", which is what makes resending an unchanged
  // collection a no-op instead of a mass restore (see `VehiculoInput`).
  const deactivated = typeof value.deactivated === "boolean" ? value.deactivated : undefined;

  if (Object.keys(errors).length > 0) {
    throw new ClienteValidationError(errors);
  }

  return {
    ...(id !== undefined ? { id } : {}),
    plate: plate ?? "",
    ...(make !== undefined ? { make } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(deactivated !== undefined ? { deactivated } : {}),
    ...(deleted !== undefined ? { deleted } : {}),
  };
}

/**
 * Validates a customer's whole vehicle payload — each element independently
 * (R17: "never across the customer's whole collection"), so one invalid
 * vehicle never changes how a valid sibling's fields are treated. `undefined`
 * means "vehicles omitted" (collection untouched, R16) and is passed through
 * unchanged; an explicit `[]` validates to an empty array.
 */
export function validateVehiculosInput(input: unknown): VehiculoInput[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) {
    throw new ClienteValidationError({ vehicles: "Vehículos debe ser una lista" });
  }

  const errors: Record<string, string> = {};
  const results: VehiculoInput[] = [];

  input.forEach((item, index) => {
    try {
      results.push(validateVehiculoInput(item));
    } catch (err) {
      if (!(err instanceof ClienteValidationError)) throw err;
      for (const [field, message] of Object.entries(err.errors)) {
        errors[`vehicles.${index}.${field}`] = message;
      }
    }
  });

  if (Object.keys(errors).length > 0) {
    throw new ClienteValidationError(errors);
  }

  return results;
}

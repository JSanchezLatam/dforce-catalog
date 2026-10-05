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
import { ESTILO_OPTIONS, MOTOR_VALUES, type VehiculoMotor } from "./vehicle-options";
import type { VehiculoInput } from "./vehicles";

export type ClienteInput = {
  name: string;
  phone: string;
  email?: string;
  whatsappOptOut?: boolean;
  emailOptOut?: boolean;
  /** Cédula / RUC — free text. `undefined` = not sent (leave alone), `null` = cleared. */
  documentoIdentidad?: string | null;
};

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** R17 — optional leading `+`, digits, and spaces/dashes/parentheses as separators only. */
const PHONE_ALLOWED_CHARS = /^\+?[0-9\s\-()]+$/;
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;
const DOCUMENTO_MAX_LENGTH = 30;

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

/**
 * Cédula / RUC: free text, trimmed, `""` becomes `null`, capped at
 * `DOCUMENTO_MAX_LENGTH`. No format check and no uniqueness — cédulas, RUCs
 * and passports vary and relatives share documents.
 */
export function normalizeDocumento(raw: unknown): string | null {
  if (raw !== null && raw !== undefined && typeof raw !== "string") {
    throw new ClienteValidationError({ documentoIdentidad: "La cédula / RUC tiene que ser texto" });
  }
  const str = typeof raw === "string" ? raw.trim() : "";
  if (str.length > DOCUMENTO_MAX_LENGTH) {
    throw new ClienteValidationError({
      documentoIdentidad: `La cédula / RUC no puede superar ${DOCUMENTO_MAX_LENGTH} caracteres`,
    });
  }
  return str.length > 0 ? str : null;
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

  let documentoIdentidad: string | null | undefined;
  if (value.documentoIdentidad !== undefined) {
    try {
      documentoIdentidad = normalizeDocumento(value.documentoIdentidad);
    } catch (err) {
      if (!(err instanceof ClienteValidationError)) throw err;
      Object.assign(errors, err.errors);
    }
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
    ...(documentoIdentidad !== undefined ? { documentoIdentidad } : {}),
    ...(whatsappOptOut !== undefined ? { whatsappOptOut } : {}),
    ...(emailOptOut !== undefined ? { emailOptOut } : {}),
  };
}

/** `YYYY-MM-DD` that is a real calendar day. Checked as strings and UTC parts: a local-time `Date` shifts a date-only string by a day. */
function isRealIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
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
  const chasis = trimmedOrUndefined(value.chasis);
  const colorPrimario = trimmedOrUndefined(value.colorPrimario);
  const colorSecundario = trimmedOrUndefined(value.colorSecundario);
  const numeroUnidad = trimmedOrUndefined(value.numeroUnidad);

  const estilo = trimmedOrUndefined(value.estilo);
  if (estilo !== undefined && !(ESTILO_OPTIONS as readonly string[]).includes(estilo)) {
    errors.estilo = "El estilo no es válido";
  }
  const motor = trimmedOrUndefined(value.motor);
  if (motor !== undefined && !(MOTOR_VALUES as readonly string[]).includes(motor)) {
    errors.motor = "El motor no es válido";
  }

  // Internal fields stay tri-state (see `VehiculoInput`): `undefined` is
  // "not sent", `null` is an explicit clear. Anything else that is not a valid
  // value is rejected, never coerced to one of those two.
  const rawMes = value.placaRenovacionMes;
  if (rawMes !== undefined && rawMes !== null && !(Number.isInteger(rawMes) && (rawMes as number) >= 1 && (rawMes as number) <= 12)) {
    errors.placaRenovacionMes = "El mes de renovación tiene que ser un número entre 1 y 12";
  }
  const rawSeguro = value.seguroVence;
  if (rawSeguro !== undefined && rawSeguro !== null && !isRealIsoDate(rawSeguro)) {
    errors.seguroVence = "La fecha de vencimiento del seguro no es válida";
  }

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
    ...(chasis !== undefined ? { chasis } : {}),
    ...(colorPrimario !== undefined ? { colorPrimario } : {}),
    ...(colorSecundario !== undefined ? { colorSecundario } : {}),
    ...(estilo !== undefined ? { estilo } : {}),
    ...(motor !== undefined ? { motor: motor as VehiculoMotor } : {}),
    ...(numeroUnidad !== undefined ? { numeroUnidad } : {}),
    ...(rawMes !== undefined ? { placaRenovacionMes: rawMes as number | null } : {}),
    ...(rawSeguro !== undefined ? { seguroVence: rawSeguro as string | null } : {}),
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

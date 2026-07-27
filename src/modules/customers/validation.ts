/**
 * customers/validation.ts — pure, DB-free validation for `cliente` (R17).
 *
 * Mirrors template-config/service.ts's `validateTemplateConfigInput`: a
 * single validate function that either returns a fully-typed, normalized
 * input or throws `ClienteValidationError` with ALL field errors collected
 * (not just the first).
 */

export type ClienteInput = {
  name: string;
  phone: string;
  email?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  vehiclePlate?: string;
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
 * E.164-ish normalization — strips separators, preserves a leading `+` when
 * present. Needed for Kapso (Phase 7's WhatsApp templates require E.164 `to`)
 * but lives here because it's part of validating/persisting a customer's
 * phone, not a provider concern.
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
    errors.name = "Name is required";
  }

  const rawPhone = typeof value.phone === "string" ? value.phone.trim() : "";
  if (!rawPhone) {
    errors.phone = "Phone is required";
  } else if (!isValidPhoneFormat(rawPhone)) {
    errors.phone = "Phone must be a valid international format (7-15 digits, optional leading +)";
  }

  const email = trimmedOrUndefined(value.email);
  if (email !== undefined && !EMAIL_FORMAT.test(email)) {
    errors.email = "Email must be a valid email address";
  }

  const vehicleMake = trimmedOrUndefined(value.vehicleMake);
  const vehicleModel = trimmedOrUndefined(value.vehicleModel);
  const vehiclePlate = trimmedOrUndefined(value.vehiclePlate);
  const vehicleYear =
    typeof value.vehicleYear === "number" && Number.isFinite(value.vehicleYear) ? value.vehicleYear : undefined;

  // R17 — "IF any inline vehicle field other than plate is provided, THEN
  // plate MUST also be provided".
  const hasOtherVehicleField = vehicleMake !== undefined || vehicleModel !== undefined || vehicleYear !== undefined;
  if (hasOtherVehicleField && vehiclePlate === undefined) {
    errors.vehiclePlate = "Plate is required whenever any other vehicle field is present";
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
    ...(vehicleMake !== undefined ? { vehicleMake } : {}),
    ...(vehicleModel !== undefined ? { vehicleModel } : {}),
    ...(vehicleYear !== undefined ? { vehicleYear } : {}),
    ...(vehiclePlate !== undefined ? { vehiclePlate } : {}),
    ...(whatsappOptOut !== undefined ? { whatsappOptOut } : {}),
    ...(emailOptOut !== undefined ? { emailOptOut } : {}),
  };
}

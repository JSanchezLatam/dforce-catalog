/**
 * Vehicle intake fields (service-order-reception). Client-safe: no DB or
 * server imports, so the form and the routes share one definition.
 */
import type { VehiculoMotor } from "@/modules/customers/vehicle-options";

/** Index = `nivel_combustible` (0..4). */
export const FUEL_LABEL = ["Vacío", "1/4", "1/2", "3/4", "Lleno"] as const;

export const KILOMETRAJE_MAX = 2_000_000;

export type IntakeValues = {
  kilometraje?: number | null;
  nivelCombustible?: number | null;
  bateriaPct?: number | null;
};

export type IntakeResult = { ok: true; value: IntakeValues } | { ok: false; errors: Record<string, string> };

const FIELDS = [
  ["kilometraje", KILOMETRAJE_MAX, "El kilometraje tiene que ser un número entero entre 0 y 2.000.000"],
  ["nivelCombustible", FUEL_LABEL.length - 1, "El nivel de combustible tiene que ser un valor entre 0 y 4"],
  ["bateriaPct", 100, "La batería tiene que ser un número entero entre 0 y 100"],
] as const;

/**
 * Validates the intake keys of a request body. An omitted key stays omitted
 * (leave the column alone); `null` is an explicit clear. Anything else must be
 * a JSON number that is an integer in range — a numeric string is refused, as
 * the DB would coerce it silently.
 */
export function parseIntake(body: Record<string, unknown>): IntakeResult {
  const value: IntakeValues = {};
  const errors: Record<string, string> = {};
  for (const [key, max, message] of FIELDS) {
    const raw = body[key];
    if (raw === undefined) continue;
    if (raw === null) {
      value[key] = null;
    } else if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= max) {
      value[key] = raw;
    } else {
      errors[key] = message;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** An unset motor shows both, so nothing is hidden from a vehicle nobody classified. */
export function intakeInputsFor(motor: VehiculoMotor | null | undefined): { fuel: boolean; battery: boolean } {
  return { fuel: motor !== "electrico", battery: motor !== "combustion" };
}

/**
 * Client-safe vehicle option lists. No server imports: `CustomerForm` (a
 * `"use client"` file) and `validation.ts` both read the same values.
 */
export const ESTILO_OPTIONS = ["Sedán", "Hatchback", "SUV", "Pick-up", "Van/Panel", "Coupé", "Moto", "Otro"] as const;

export const MOTOR_VALUES = ["combustion", "electrico", "hibrido"] as const;
export type VehiculoMotor = (typeof MOTOR_VALUES)[number];

export const MOTOR_LABEL: Record<VehiculoMotor, string> = {
  combustion: "Combustión",
  electrico: "Eléctrico",
  hibrido: "Híbrido",
};

/** Index 0 is January: `MONTH_NAMES[placaRenovacionMes - 1]`. */
export const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

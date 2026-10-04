import { MOTOR_LABEL } from "@/modules/customers/vehicle-options";
import type { Vehiculo } from "@/shared/db/schema";

/**
 * The descriptive vehicle rows an order shows (detail page and print sheet),
 * as a NAMED-field allowlist: `placaRenovacionMes` and `seguroVence` are
 * internal and must never be reachable from here, so nothing spreads or
 * iterates the row. `value` is `null` when unset and the caller picks the
 * empty-state; `Nº de unidad` is omitted entirely unless filled.
 */
export function vehicleDescriptiveRows(
  v: Pick<Vehiculo, "chasis" | "colorPrimario" | "colorSecundario" | "estilo" | "motor" | "numeroUnidad">,
): { label: string; value: string | null }[] {
  const color = [v.colorPrimario, v.colorSecundario].filter((c) => c != null && c !== "").join(" / ");
  const rows = [
    { label: "Chasis", value: v.chasis || null },
    { label: "Color", value: color || null },
    { label: "Estilo", value: v.estilo || null },
    { label: "Motor", value: v.motor ? MOTOR_LABEL[v.motor] : null },
  ];
  return v.numeroUnidad ? [...rows, { label: "Nº de unidad", value: v.numeroUnidad }] : rows;
}

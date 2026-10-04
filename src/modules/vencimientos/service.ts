/**
 * vencimientos/service.ts — the due list and the "Contactado" mark.
 *
 * `getDueVencimientos` is the ONE source for both the page's rows and the
 * sidebar badge: `count` is `rows.length`, never a second query, so the two
 * cannot disagree.
 *
 * `DueVencimiento` carries SERVER-ONLY fields (`customerPhone`,
 * `whatsappOptOut`). The page must not hand a row to a client component whole:
 * it passes only the allowlist in design.md "Dialog props" (opt-out resolved to
 * a blocked reason, phone resolved to `wa.me` digits by `toE164`).
 */
import { toWorkshopDateKey } from "@/shared/datetime";
import { computeDueItems, contactKey, type DueItem, type VencimientoKind } from "./due";
import {
  insertContacto,
  listContacts as listContactsQuery,
  listDueCandidates as listDueCandidatesQuery,
  vehiculoExists as vehiculoExistsQuery,
  type DueCandidate,
  type NewContacto,
} from "./queries";

export type DueVencimiento = DueItem & {
  vehiculoId: string;
  clienteId: string;
  customerName: string;
  /** SERVER-ONLY: raw stored phone. */
  customerPhone: string;
  /** SERVER-ONLY: resolve to a blocked reason before it reaches a client. */
  whatsappOptOut: boolean;
  make: string | null;
  model: string | null;
  plate: string;
  numeroUnidad: string | null;
};

export type DueVencimientosResult = {
  /** Overdue first, then by customer name, plate and kind. */
  rows: DueVencimiento[];
  /** The badge number; always `rows.length`. */
  count: number;
};

export type GetDueDeps = {
  listCandidates?: () => Promise<DueCandidate[]>;
  listContacts?: typeof listContactsQuery;
};

function compareRows(a: DueVencimiento, b: DueVencimiento): number {
  if (a.state !== b.state) return a.state === "overdue" ? -1 : 1;
  return (
    a.customerName.localeCompare(b.customerName, "es") ||
    a.plate.localeCompare(b.plate, "es") ||
    a.kind.localeCompare(b.kind)
  );
}

export async function getDueVencimientos(now: Date, deps: GetDueDeps = {}): Promise<DueVencimientosResult> {
  const [candidates, contacts] = await Promise.all([
    (deps.listCandidates ?? listDueCandidatesQuery)(),
    (deps.listContacts ?? listContactsQuery)(),
  ]);
  const todayKey = toWorkshopDateKey(now);

  const contactedByVehicle = new Map<string, Set<string>>();
  for (const mark of contacts) {
    const keys = contactedByVehicle.get(mark.vehiculoId) ?? new Set<string>();
    keys.add(contactKey(mark.kind, mark.periodKey));
    contactedByVehicle.set(mark.vehiculoId, keys);
  }

  const rows = candidates
    .flatMap((c) =>
      computeDueItems(c, todayKey, contactedByVehicle.get(c.vehiculoId)).map((item) => ({
        vehiculoId: c.vehiculoId,
        clienteId: c.clienteId,
        customerName: c.customerName,
        customerPhone: c.customerPhone,
        whatsappOptOut: c.whatsappOptOut,
        make: c.make,
        model: c.model,
        plate: c.plate,
        numeroUnidad: c.numeroUnidad,
        ...item,
      })),
    )
    .sort(compareRows);

  return { rows, count: rows.length };
}

export class VencimientoValidationError extends Error {
  constructor(public readonly errors: Record<string, string>) {
    super("Invalid vencimiento contact");
  }
}

export class VehiculoNotFoundError extends Error {
  constructor(public readonly vehiculoId: string) {
    super(`Vehiculo not found: ${vehiculoId}`);
  }
}

const PLATE_PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PERIOD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date: `2026-02-30` matches the shape but is not one. */
function isRealDateKey(key: string): boolean {
  const match = DATE_PERIOD.exec(key);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
}

export type MarkContactadoInput = { vehiculoId: unknown; kind: unknown; periodKey: unknown };

export type MarkContactadoDeps = {
  vehiculoExists?: (id: string) => Promise<boolean>;
  insert?: (row: NewContacto) => Promise<void>;
};

/** Records one "Contactado" mark. Idempotent: a repeat resolves without a second row. */
export async function markContactado(
  input: MarkContactadoInput,
  contactedBy: string | null,
  deps: MarkContactadoDeps = {},
): Promise<void> {
  const { vehiculoId, kind, periodKey } = input;
  if (typeof vehiculoId !== "string" || vehiculoId === "") {
    throw new VencimientoValidationError({ vehiculoId: "El vehículo es obligatorio" });
  }
  if (kind !== "placa" && kind !== "seguro") {
    throw new VencimientoValidationError({ kind: "El tipo de vencimiento no es válido" });
  }
  const periodOk = typeof periodKey === "string" && (kind === "placa" ? PLATE_PERIOD.test(periodKey) : isRealDateKey(periodKey));
  if (!periodOk) {
    throw new VencimientoValidationError({ periodKey: "El período no es válido para este tipo de vencimiento" });
  }

  if (!(await (deps.vehiculoExists ?? vehiculoExistsQuery)(vehiculoId))) {
    throw new VehiculoNotFoundError(vehiculoId);
  }
  await (deps.insert ?? ((row: NewContacto) => insertContacto(row)))({
    vehiculoId,
    kind: kind as VencimientoKind,
    periodKey: periodKey as string,
    contactedBy,
  });
}

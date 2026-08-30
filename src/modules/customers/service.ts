/**
 * customers/service.ts — validation + DB-write orchestration for `cliente`
 * (R16-R18) and, since vehicles-one-to-many (C3), its `vehiculo` collection
 * (design.md D5). Mirrors template-config/service.ts's shape (validate, then
 * write) with the DI-`deps` seam from inventory-sync/job.ts for testability.
 *
 * Note: the `cliente` table (Phase 1) does NOT have a DB-level unique
 * constraint on `phone` — R18's duplicate block is enforced entirely here,
 * at the application layer, via `findClienteByPhone` before every
 * create/update. See apply-progress for this deviation from the original
 * assumption that a DB constraint existed.
 */
import { eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { cliente, type Cliente, type Vehiculo } from "@/shared/db/schema";
import { findClienteByPhone, getClienteById } from "./queries";
import {
  ClienteValidationError,
  normalizePhone,
  validateClienteInput,
  validateVehiculosInput,
  type ClienteInput,
} from "./validation";
import { applyVehiculoPlan, planVehiculoReconcile, type TxLike, type VehiculoInput } from "./vehicles";

/** R18 — a phone that already belongs to another cliente; `existingClienteId` lets the caller link to it. */
export class DuplicatePhoneError extends Error {
  constructor(public readonly existingClienteId: string) {
    super("A customer with this phone number already exists");
  }
}

export class ClienteNotFoundError extends Error {
  constructor(id: string) {
    super(`Cliente ${id} not found`);
  }
}

export type DatabaseDep = { transaction: <T>(fn: (tx: TxLike) => Promise<T>) => Promise<T> };

function extractVehiclesRaw(input: unknown): unknown {
  return (input as Record<string, unknown> | null | undefined)?.vehicles;
}

/**
 * Runs BOTH validators and merges their errors into one throw. Sequential
 * throws would leak validation.ts's "ALL field errors collected (not just the
 * first)" contract across the scalar/collection boundary: a submission with a
 * bad name AND a plate-less vehicle would make the user fix the name,
 * resubmit, and only then learn about the plate.
 */
function validateClienteAndVehicles(
  scalarInput: unknown,
  vehiclesRaw: unknown,
): { value: ClienteInput; vehicles: VehiculoInput[] | undefined } {
  const errors: Record<string, string> = {};
  let value: ClienteInput | undefined;
  let vehicles: VehiculoInput[] | undefined;

  const collect = (run: () => void) => {
    try {
      run();
    } catch (err) {
      if (!(err instanceof ClienteValidationError)) throw err;
      Object.assign(errors, err.errors);
    }
  };

  collect(() => {
    value = validateClienteInput(scalarInput);
  });
  collect(() => {
    vehicles = validateVehiculosInput(vehiclesRaw);
  });

  if (Object.keys(errors).length > 0) {
    throw new ClienteValidationError(errors);
  }
  return { value: value!, vehicles };
}

export type CreateClienteDeps = {
  findByPhone?: (phone: string) => Promise<Cliente | null>;
  insert?: (value: ClienteInput) => Promise<Cliente>;
  /** Only opened when the input carries a `vehicles` key — see design.md D5. */
  database?: DatabaseDep;
};

/**
 * R16/R18 — create; blocks on a duplicate phone with a link to the existing
 * record. When `vehicles` is present in the input, the cliente row and its
 * vehicle collection are written in one transaction (D5) — both succeed or
 * both roll back. `vehicles` omitted behaves exactly as before (scalar-only,
 * no transaction).
 */
export async function createCliente(input: unknown, deps: CreateClienteDeps = {}): Promise<Cliente> {
  const { value, vehicles: vehiclesInput } = validateClienteAndVehicles(input, extractVehiclesRaw(input));

  const findByPhone = deps.findByPhone ?? findClienteByPhone;
  const existing = await findByPhone(value.phone);
  if (existing) {
    throw new DuplicatePhoneError(existing.id);
  }

  if (vehiclesInput === undefined) {
    const insert =
      deps.insert ??
      (async (v: ClienteInput) => {
        const [row] = await db.insert(cliente).values(v).returning();
        return row;
      });
    return insert(value);
  }

  const database = deps.database ?? { transaction: (fn: (tx: TxLike) => Promise<Cliente>) => db.transaction(fn) };
  return database.transaction(async (tx) => {
    const [row] = await tx.insert(cliente).values(value).returning();
    const plan = planVehiculoReconcile([], vehiclesInput);
    await applyVehiculoPlan(tx, row.id, plan);
    return row;
  });
}

export type UpdateClienteDeps = {
  /**
   * `vehicles` is REQUIRED, not optional: the reconcile below treats the
   * returned set as the customer's complete active collection, so an omitted
   * one would read as "this customer has none" — never deactivating a real
   * vehicle and inserting duplicates for every id-less entry. The type is what
   * rules that out; a `?? []` here would just make it fail silently.
   */
  getById?: (id: string) => Promise<{ cliente: Cliente; vehicles: Vehiculo[] } | null>;
  findByPhone?: (phone: string) => Promise<Cliente | null>;
  update?: (id: string, patch: Partial<ClienteInput>) => Promise<Cliente>;
  /** Only opened when the patch carries a `vehicles` key — see design.md D5. */
  database?: DatabaseDep;
};

export type ClientePatch = Partial<ClienteInput> & { vehicles?: unknown };

/**
 * R16 — edit; persists only the changed field(s). R18 — duplicate check is
 * skipped when `phone` isn't part of the patch, and excludes the record's
 * own id so a no-op phone edit never flags itself as a duplicate.
 *
 * A `vehicles` key in the patch (design.md D5) sits BESIDE the scalars, never
 * inside the merge below — so it never affects R16's "persist only the
 * changed field" for the scalar columns. Omitted `vehicles` leaves the whole
 * collection untouched; `vehicles: []` deactivates every active vehicle.
 */
export async function updateCliente(
  id: string,
  patch: ClientePatch,
  deps: UpdateClienteDeps = {},
): Promise<Cliente> {
  const getById = deps.getById ?? getClienteById;
  const current = await getById(id);
  if (!current) {
    throw new ClienteNotFoundError(id);
  }

  // Validate the MERGED scalar record so cross-field rules see the full
  // picture — but only the patch's own keys get persisted below (R16).
  const { vehicles: vehiclesInput } = validateClienteAndVehicles({ ...current.cliente, ...patch }, patch.vehicles);

  const persistedPatch: Partial<ClienteInput> = Object.fromEntries(
    Object.entries(patch).filter(([key]) => key !== "vehicles"),
  );

  if (patch.phone !== undefined) {
    const normalizedPhone = normalizePhone(patch.phone);
    persistedPatch.phone = normalizedPhone;

    if (normalizedPhone !== current.cliente.phone) {
      const findByPhone = deps.findByPhone ?? findClienteByPhone;
      const existing = await findByPhone(normalizedPhone);
      if (existing && existing.id !== id) {
        throw new DuplicatePhoneError(existing.id);
      }
    }
  }

  if (vehiclesInput === undefined) {
    const update =
      deps.update ??
      (async (targetId: string, p: Partial<ClienteInput>) => {
        const [row] = await db.update(cliente).set(p).where(eq(cliente.id, targetId)).returning();
        return row;
      });
    return update(id, persistedPatch);
  }

  const database = deps.database ?? { transaction: (fn: (tx: TxLike) => Promise<Cliente>) => db.transaction(fn) };
  return database.transaction(async (tx) => {
    const row =
      Object.keys(persistedPatch).length > 0
        ? (await tx.update(cliente).set(persistedPatch).where(eq(cliente.id, id)).returning())[0]
        : current.cliente;
    const plan = planVehiculoReconcile(current.vehicles, vehiclesInput);
    await applyVehiculoPlan(tx, id, plan);
    return row;
  });
}

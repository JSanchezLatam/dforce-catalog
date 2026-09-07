/**
 * customers/service.ts — validation + DB-write orchestration for `cliente`
 * (R16-R18) and, since vehicles-one-to-many (C3), its `vehiculo` collection
 * (design.md D5). Mirrors template-config/service.ts's shape (validate, then
 * write) with the DI-`deps` seam from inventory-sync/job.ts for testability.
 *
 * Note: `cliente.phone` carries NO DB-level unique constraint, and that is a
 * DECISION, not an accident — the delta spec makes it a MUST NOT, design.md D3
 * records the owner's trade behind it (real customers legitimately share a
 * number: a spouse, a company line), and `schema.test.ts` guards its absence
 * across all three Drizzle spellings. Do not "fix" it by adding an index.
 *
 * R18 is therefore not a block but refuse-then-confirm, enforced entirely
 * here via `findClienteByPhone` before every create/update: the first attempt
 * is refused with the existing customer's id, and only an explicit
 * `allowDuplicatePhone` from the operator gets past it.
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
 * R18 (rewritten) — the operator's confirmation that a phone really does
 * belong to two people. Strictly `=== true`: this overrides a deliberate
 * refusal, so a truthy `"false"` arriving from a form or a query string must
 * not carry it.
 *
 * NOT a `cliente` column and never persisted — see the two "does not persist
 * the shared-phone confirmation" tests. It rides the same raw body the
 * validated scalars are read from, so no route needs to know about it.
 */
function confirmsSharedPhone(input: unknown): boolean {
  return (input as Record<string, unknown> | null | undefined)?.allowDuplicatePhone === true;
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
 * R16/R18 — create; refuses a duplicate phone with a link to the existing
 * record, unless the caller carries the operator's `allowDuplicatePhone`
 * confirmation that the number is genuinely shared. When `vehicles` is
 * present in the input, the cliente row and its vehicle collection are
 * written in one transaction (D5) — both succeed or both roll back.
 * `vehicles` omitted behaves exactly as before (scalar-only, no
 * transaction).
 */
export async function createCliente(input: unknown, deps: CreateClienteDeps = {}): Promise<Cliente> {
  const { value, vehicles: vehiclesInput } = validateClienteAndVehicles(input, extractVehiclesRaw(input));

  const findByPhone = deps.findByPhone ?? findClienteByPhone;
  const existing = await findByPhone(value.phone);
  if (existing && !confirmsSharedPhone(input)) {
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

  // Planned BEFORE the transaction opens. `planVehiculoReconcile` throws when an
  // incoming vehicle carries an id this customer does not own — a trust-boundary
  // rejection that is decidable with no database contact at all (on create,
  // `existing` is always empty). Left inside the transaction it inserted the
  // cliente, threw, and rolled back, spending a write to produce a 400.
  const plan = planVehiculoReconcile([], vehiclesInput);

  const database = deps.database ?? { transaction: (fn: (tx: TxLike) => Promise<Cliente>) => db.transaction(fn) };
  return database.transaction(async (tx) => {
    const [row] = await tx.insert(cliente).values(value).returning();
    await applyVehiculoPlan(tx, row.id, plan);
    return row;
  });
}

export type UpdateClienteDeps = {
  /**
   * `vehicles` is REQUIRED, not optional: the reconcile below treats the
   * returned set as the customer's WHOLE collection (active AND inactive,
   * since `getClienteById` now fetches both — restore needs an inactive
   * vehicle's id to be recognized as this customer's own), so an omitted one
   * would read as "this customer has none" — never deactivating a real
   * vehicle and inserting duplicates for every id-less entry. The type is what
   * rules that out; a `?? []` here would just make it fail silently.
   */
  getById?: (id: string) => Promise<{ cliente: Cliente; vehicles: Vehiculo[] } | null>;
  findByPhone?: (phone: string) => Promise<Cliente | null>;
  update?: (id: string, patch: Partial<ClienteInput>) => Promise<Cliente>;
  /** Only opened when the patch carries a `vehicles` key — see design.md D5. */
  database?: DatabaseDep;
};

export type ClientePatch = Partial<ClienteInput> & { vehicles?: unknown; allowDuplicatePhone?: unknown };

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

  // Rest destructuring, NOT `Object.fromEntries(Object.entries(...).filter(...))`:
  // that returns `{ [k: string]: any }`, which assigns to `Partial<ClienteInput>`
  // without checking anything, so a typo'd key or a renamed field would compile
  // clean and land in `db.update(cliente).set(...)`. This keeps the write path
  // type-checked, which the pre-change `{ ...patch }` spread already was.
  const { vehicles: strippedVehicles, allowDuplicatePhone: strippedConfirmation, ...persistedPatch } = patch;
  // Both bindings exist only to keep their key out of `persistedPatch`, which
  // is what reaches `db.update(cliente).set(...)`. `vehicles` is already
  // validated above as `vehiclesInput`; `allowDuplicatePhone` is an override
  // read by `confirmsSharedPhone`, not a column — left in, it would SET a
  // column that does not exist. `void` marks them used rather than relaxing
  // `no-unused-vars` repo-wide for one line.
  void strippedVehicles;
  void strippedConfirmation;

  if (patch.phone !== undefined) {
    const normalizedPhone = normalizePhone(patch.phone);
    persistedPatch.phone = normalizedPhone;

    if (normalizedPhone !== current.cliente.phone) {
      const findByPhone = deps.findByPhone ?? findClienteByPhone;
      const existing = await findByPhone(normalizedPhone);
      if (existing && existing.id !== id && !confirmsSharedPhone(patch)) {
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

  // Same reasoning as `createCliente`: both inputs are in hand before any write,
  // so the ownership rejection belongs with the rest of validation, not inside a
  // transaction it would have to roll back.
  const plan = planVehiculoReconcile(current.vehicles, vehiclesInput);

  const database = deps.database ?? { transaction: (fn: (tx: TxLike) => Promise<Cliente>) => db.transaction(fn) };
  return database.transaction(async (tx) => {
    const row =
      Object.keys(persistedPatch).length > 0
        ? (await tx.update(cliente).set(persistedPatch).where(eq(cliente.id, id)).returning())[0]
        : current.cliente;
    await applyVehiculoPlan(tx, id, plan);
    return row;
  });
}

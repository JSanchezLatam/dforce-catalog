/**
 * customers/service.ts — validation + DB-write orchestration for `cliente`
 * (R16-R18). Mirrors template-config/service.ts's shape (validate, then
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
import { cliente, type Cliente } from "@/shared/db/schema";
import { findClienteByPhone, getClienteById } from "./queries";
import { normalizePhone, validateClienteInput, type ClienteInput } from "./validation";

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

export type CreateClienteDeps = {
  findByPhone?: (phone: string) => Promise<Cliente | null>;
  insert?: (value: ClienteInput) => Promise<Cliente>;
};

/** R16/R18 — create; blocks on a duplicate phone with a link to the existing record. */
export async function createCliente(input: unknown, deps: CreateClienteDeps = {}): Promise<Cliente> {
  const value = validateClienteInput(input);

  const findByPhone = deps.findByPhone ?? findClienteByPhone;
  const existing = await findByPhone(value.phone);
  if (existing) {
    throw new DuplicatePhoneError(existing.id);
  }

  const insert =
    deps.insert ??
    (async (v: ClienteInput) => {
      const [row] = await db.insert(cliente).values(v).returning();
      return row;
    });
  return insert(value);
}

export type UpdateClienteDeps = {
  getById?: (id: string) => Promise<{ cliente: Cliente } | null>;
  findByPhone?: (phone: string) => Promise<Cliente | null>;
  update?: (id: string, patch: Partial<ClienteInput>) => Promise<Cliente>;
};

/**
 * R16 — edit; persists only the changed field(s). R18 — duplicate check is
 * skipped when `phone` isn't part of the patch, and excludes the record's
 * own id so a no-op phone edit never flags itself as a duplicate.
 */
export async function updateCliente(
  id: string,
  patch: Partial<ClienteInput>,
  deps: UpdateClienteDeps = {},
): Promise<Cliente> {
  const getById = deps.getById ?? getClienteById;
  const current = await getById(id);
  if (!current) {
    throw new ClienteNotFoundError(id);
  }

  // Validate the MERGED record so cross-field rules (vehicle-requires-plate,
  // R17) see the full picture — but only the patch's own keys get persisted
  // below (R16: "persist only the changed field").
  validateClienteInput({ ...current.cliente, ...patch });

  const persistedPatch: Partial<ClienteInput> = { ...patch };

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

  const update =
    deps.update ??
    (async (targetId: string, p: Partial<ClienteInput>) => {
      const [row] = await db.update(cliente).set(p).where(eq(cliente.id, targetId)).returning();
      return row;
    });
  return update(id, persistedPatch);
}

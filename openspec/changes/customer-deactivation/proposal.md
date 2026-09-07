# Proposal: enable and disable a customer

Roadmap change **C2**.

## Why

A customer leaves — sells the car, moves away, stops coming. Today the only
thing staff can do is nothing: the record stays in the list, stays in the
service-order customer picker, and keeps receiving reminders. The workshop has
no way to say "not a customer any more" short of asking someone to delete the
row, which would take the service history with it.

## What changes

`cliente` gains a `deactivatedAt` timestamp, the same soft-delete shape
`vehiculo` and `users` already use. A deactivated customer:

- disappears from the customer list by default, behind a "ver desactivados"
  toggle;
- disappears from the service-order customer picker, so no new order can be
  opened for them;
- stops receiving reminders;
- keeps every service order and every vehicle, untouched;
- can be reactivated, putting all of the above back.

## The part that is easy to get wrong

**Deactivation that only hides a row is decorative.** If the picker still
offers them, staff open orders for a customer they disabled. If reminders
still fire, the workshop keeps WhatsApping someone they marked as gone — and
that one is not merely untidy, it is a message sent to a real person on the
strength of a record the workshop has explicitly retired.

Both are fixed at the shared read path rather than per caller:
`listClientes`/`countClientes` exclude deactivated rows by default, which the
picker inherits for free, and `runReminder` gains one guard beside the
cancelled-order check it already runs at fire time.

## What deliberately does NOT change

**No new policy action.** Deactivating stays with `customers.write`. The
precedent is already in this codebase and the reasoning is written down in
`api/customers/[id]/route.ts`: deactivating a vehicle is reversible and stays
with `customers.write`, while `customers.deleteVehicle` exists as a separate
administrador-only grant *because destroying a row is not reversible*.
Deactivating a customer is reversible. Consistency wins over a fourth grant
nobody asked for.

**Nothing is deleted, ever.** There is no hard-delete counterpart for
customers in this change, and none is planned. `customers.deleteVehicle` has
no customer-level twin.

## Impact

- `openspec/specs/customer-management/spec.md` — R16 amended, one new requirement
- `cliente.deactivated_at` — migration `0017`
- `queries.ts`, `service.ts`, both customer routes, `CustomerFilters`,
  `CustomerForm`, the customers list and detail pages, `reminders/job.ts`

## Branching

Chained off `feat/customer-shared-phones` (PR #68), not off `main`. That
branch adds migration `0016`; generating this one from `main` would produce a
second `0016` and collide on merge. This PR targets #68's branch and merges
after it.

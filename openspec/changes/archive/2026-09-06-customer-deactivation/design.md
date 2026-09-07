# Design: enable and disable a customer

## D1 — `deactivatedAt`, a nullable timestamp

`cliente.deactivatedAt timestamptz null`, migration `0017`. Not a boolean.

This repo already spells soft delete exactly once, in two places:
`vehiculo.deactivatedAt` and `users.deactivatedAt`. A timestamp answers "is it
off?" *and* "since when?"; a boolean answers only the first and then someone
adds `deactivatedOn` beside it a year later.

## D2 — `customers.write`, no new policy action

`api/customers/[id]/route.ts` already carries the rule this follows:
deactivating a vehicle is reversible and stays with `customers.write`, and
`customers.deleteVehicle` exists as a separate administrador grant *because
destroying a row is not reversible*.

Deactivating a customer is reversible. Rejected: a `customers.deactivate`
action. It would be the only grant in `MATRIX` whose two roles both hold it,
i.e. a column that never decides anything.

## D3 — exclude at the shared read path, not per caller

`listClientes` and `countClientes` filter `deactivated_at is null` unless the
caller opts in. This is the load-bearing decision, and it is a root-cause fix
rather than a per-screen one: `CustomerPicker` reads `GET /api/customers`, so
excluding there means no new service order can name a deactivated customer,
with no change to the picker at all.

The alternative — filtering in the list page and again in the picker — leaves
every future caller of `listClientes` to remember, and the third one will not.

Signature mirrors `listVehiculosByCliente(id, { includeInactive })`, already
in `vehicles.ts`. Same word, same meaning, same default.

`getClienteById` is the deliberate exception: it returns a deactivated
customer. You cannot reactivate a record you cannot open — the same reason
`getClienteById` already fetches inactive VEHICLES (`queries.ts:105-108`).

## D4 — reminders skip a deactivated customer

`runReminder` already re-checks state at fire time (ADR-8) and already has
`markSkipped()` for operational reasons — a cancelled order, a stale
appointment. A deactivated customer is one more, and the guard goes beside
those.

`skipped`, NOT `opted_out`. R26's `opted_out` means the customer exercised a
consent choice per channel; this is the workshop retiring a record. Collapsing
them would corrupt the one status that carries legal meaning, and
[[AGENTS.md]] already forbids conflating the two opt-out regimes for the same
reason.

Checked at FIRE time, not schedule time, so a customer deactivated after a
reminder was queued still gets nothing — which is the case that actually
matters, since deactivation almost always happens after the orders exist.

## D5 — a deactivated customer is read-only until reactivated

Mirrors the deactivated-vehicle row in `CustomerForm`: it collapses to its
identity, a state label, and the way back. The detail page shows a banner and
a "Reactivar" button; "Editar" is not offered.

Rejected: allowing edits while deactivated. It invites the question of what a
phone-number change means for a customer the workshop says it no longer has,
and answering that question buys nothing anyone asked for.

## D6 — the list toggle is URL state

`?includeInactive=1`, read by the page and rendered by `CustomerFilters`,
matching how `search` and `pageSize` already work there (debounced
`router.push`, no client state). A filter that does not survive a refresh or a
shared link is a filter staff will not trust.

## Testing strategy

| Surface | How |
|---|---|
| `deactivateCliente`/`reactivateCliente` | unit, injected `deps` seam like the rest of `service.ts` |
| the default exclusion | unit on `buildClienteSearchWhere`'s output, plus one e2e against real Postgres — the injected-seam limit in AGENTS.md means a green unit run proves nothing about the actual SQL |
| picker inherits the exclusion | e2e, through `GET /api/customers` |
| reminder skip | unit on `runReminder` with an injected deactivated cliente |
| detail read-only | component test on the page |

The e2e rows are the important ones. This change's whole value is a `WHERE`
clause, and `vitest.config.ts` points `DATABASE_URL` at a nonexistent database
precisely so unit tests cannot reach one.

## Migration risk

`0017` is additive and nullable — every existing row is active, which is the
correct reading of "nobody has deactivated anyone yet". Reverting is a code
revert plus one `DROP COLUMN`.

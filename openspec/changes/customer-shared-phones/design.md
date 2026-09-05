# Design: shared phone numbers, and `phone NOT NULL`

## D1 — the override is a request flag, not a column

`allowDuplicatePhone: true` rides the raw request body and is read by
`confirmsSharedPhone()` in `service.ts`. It is never persisted.

Rejected: a `shared_phone` boolean on `cliente`. It is the shape that would let
a partial UNIQUE index close the race, and it was rejected with the race
itself — the owner chose the warning over any constraint. Adding the column
without the index buys a field nothing reads.

**Strictly `=== true`.** This overrides a deliberate refusal, so a truthy
`"false"` arriving from a form encoding or a query string must not carry it.

Two places must strip it before a write:

- `createCliente` — the flag lives on `input`, and only the validated `value`
  reaches the insert, so nothing extra is needed there.
- `updateCliente` — **this is the trap.** `persistedPatch` is built from the
  patch and goes straight to `db.update(cliente).set(...)`, so a leaked key
  becomes a `SET` on a column that does not exist. Stripped by rest-
  destructuring beside `vehicles`, which is stripped for the same reason.

Neither route needed a change: both forward the raw body whole
(`createCliente(body, deps)`, `updateCliente(id, body, deps)`). A test on each
pins that, mutation-verified — a refactor that starts picking named fields off
the body would otherwise silently re-block the shared-phone case.

## D2 — the confirmation's lifetime IS the guarantee

The spec requires the confirmation to be "an explicit act by the operator on
that attempt — never a default, never remembered". That is a lifetime
property, so it is enforced structurally rather than by discipline:

- `submit(confirmSharedPhone)` takes it as a **parameter**, never reading it
  from state. Only a save started from the confirmation button itself can
  carry it.
- `sharedPhoneWith` (the 409's `existingClienteId`) is cleared when the phone
  is edited — a confirmation armed for the old number must not apply to
  whatever is typed next — and cleared when the dialog reopens.

A leaked confirmation would disable the refusal for the rest of the form's
life, silently. Three tests cover it.

## D3 — no UNIQUE index; the race is accepted

`findClienteByPhone` reads, then `createCliente` writes. Nothing between those
two steps stops a second writer, so two operators creating the same customer
at the same moment produce two records.

Every constraint shape that closes the window also rejects one of the three
legitimately shared numbers, or needs D1's rejected column to carve them out.
The owner was shown that trade and chose the warning.

Recorded as **accepted, not overlooked**, in both `proposal.md` and the R18
delta — a `MUST NOT` clause, so it survives into the main spec at archive.
Revisit only on evidence: two records, same phone, `created_at` seconds apart,
rather than the weeks apart every existing pair shows.

`schema.test.ts` guards it. Drizzle spells uniqueness three ways landing in
three different places on `getTableConfig`, and the first version of that test
checked two — a table-level `unique().on(table.phone)` passed it 44/44. All
three are now asserted, scoped to `phone`.

## D4 — `NOT NULL` forbids a null, not an empty string

This is why migration `0016` deleted nothing.

`validation.ts` has always rejected an empty phone, so the nullable column
permitted only states nothing produces. Making it `NOT NULL` surfaced five
test fixtures built with `phone: null`, each covering real behaviour: R19's
"a customer with neither phone nor plate still renders as an identifiable
row", and `planReminders` skipping the WhatsApp channel.

Both guards are truthiness checks (`schedule.ts:51`, `CustomerPicker.tsx:25`),
so `''` hits exactly the branch `null` used to. The fixtures moved to
`phone: ""` and every branch stays live.

Deliberately NOT added: a `CHECK (phone <> '')`. It would make R19's clause
unsatisfiable, which is the opposite of what this change is for.

## Migration risk

`0016` is a bare `SET NOT NULL`. It hard-fails on the first null row rather
than coercing one, which is the correct failure: a customer's phone number is
the owner's data, not something to invent to satisfy a constraint.

The pre-check (`tasks.md` 2.3) runs BEFORE the migration wherever real data
lives. It has been run against the dev database only — the owner's 364-record
dataset is in no local database and remains unchecked.

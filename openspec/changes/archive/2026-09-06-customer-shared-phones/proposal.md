# Proposal: shared phone numbers, and `phone NOT NULL`

Roadmap change **C1**. Two pieces that both live on `cliente.phone`.

## Why

R18 shipped as an absolute block: `findClienteByPhone` finds a match,
`createCliente` throws `DuplicatePhoneError`, the route answers `409`, and
`CustomerForm` renders it as a phone error the operator cannot get past.

That was the right call against the problem R18 was written for — staff
re-creating a customer they could not find, which PR #44's search fixed at the
root. It is the wrong call against a case R18 did not consider: **a phone
number that legitimately belongs to two people.** A house line, a couple
sharing a handset, a parent who owns the phone their kid's car is registered
under.

The dataset has both kinds. Of nine repeated phones across 364 records, six are
the fragmentation R18 was aimed at; **three are different people**. Those three
are not a hypothetical — the second person in each pair cannot be entered into
the system at all today.

## What changes

1. **The duplicate becomes a warning the operator can override.** The `409`
   still fires on the first attempt, still names the existing customer, still
   links to them. What is new is a second path: confirm that the number really
   is shared, and the record saves.

2. **`cliente.phone` becomes `NOT NULL`.** `validation.ts` has always required
   it (`"Phone is required"`); the column never agreed. This is alignment, not
   new policy.

## What deliberately does NOT change

**No UNIQUE index, so the race stays open.** Two operators creating the same
customer at the same moment both read "no match" before either inserts, and two
records appear. Only a database constraint closes that, and every constraint
shape that closes it also rejects one of the three legitimate pairs — or costs
a `shared_phone` column to carve them out.

The owner was shown that trade directly and chose the warning. Recorded here so
the next change does not re-derive it as a discovery: **the residual race is
known and accepted**, not overlooked. Revisit only if duplicates actually
appear from concurrent entry, which is measurable — two records, same phone,
`created_at` seconds apart, rather than the weeks apart every existing pair
shows.

## Impact

- `openspec/specs/customer-management/spec.md` — R18 is rewritten, not extended
- `cliente.phone` — migration `0016`, `NOT NULL`
- `createCliente` / `updateCliente`, both customer routes, `CustomerForm`

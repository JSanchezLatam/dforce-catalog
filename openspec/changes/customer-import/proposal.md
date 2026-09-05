# Proposal: import customers from Interfuerza

Roadmap change **C6**. Chained off `feat/customer-deactivation` (#69) — see
*Branching*.

## Why

The workshop's customers already exist in Interfuerza: **370 of them**, with
names, phones, emails and addresses that staff would otherwise re-type. Today
this app starts empty and every customer has to be created by hand.

## The contract, verified live before any of this was designed

`openspec/changes/archive/.../il-api-contract-fix` exists because the vendor
docs and the original requirements both described a REST API that does not
exist, and nobody checked until deep into implementation. That cost a rewrite.

So this change starts from a live sweep of all 370 rows, not from documentation:

- `action: "customers"` on the same single POST endpoint as products.
  `clients`/`client` return **401**; `contacts` returns an empty list;
  `customer` (singular) returns no list at all.
- `count` is the stable grand total, so the `page * 25 >= count` rule carries
  over unchanged.
- **`Cliente` is the external id** — 370/370 present, 370/370 unique.
- **`Token` is empty on every row**, despite the name. Unusable.
- `Nombre` is the name, never blank. `Contacto` is a contact PERSON, filled on
  roughly one row in twenty — not a fallback.
- `Status` is `ACTIVE` on all 370. Nothing maps onto `deactivatedAt`, and
  nothing could be tested against it if it did.
- `Tipo` is `CLIENTE` (341) or `ALIANZA` (29).

## What changes

A manual, re-runnable import: fetch every page, map each row, insert what is
new and update what already exists, matched on the external id. It reports
what it did — created, updated, skipped, and why.

## The decisions that are not ours to infer

**Phones are imported RAW, exactly as Interfuerza holds them.** The owner was
shown the consequence and chose it: Panama numbers are 8 digits with no country
code, WhatsApp needs E.164, so **353 of these customers will not be able to
receive a WhatsApp reminder**, and nothing on screen will say so. Recorded here
as accepted, not overlooked. Revisit by normalising to `+507` — a data
migration, not a code change, once the owner wants it.

**The 9 customers with no phone in any field are SKIPPED and reported.**
`cliente.phone` is `NOT NULL` (migration `0016`) and R17 requires it, so the
alternatives were to invent a number or to write rows this app's own form would
reject. Neither is acceptable silently. They are named in the result so the
owner can add them with the real number.

**9 phone values are shared by 18 of these customers.** They import cleanly
only because `customer-shared-phones` (#68) removed the hard duplicate block.
Before it, this import would have refused them.

## Impact

- `src/shared/interfuerza/` — the paginated, rate-limited fetch extracted from
  `inventory-sync/client.ts` so both callers share one implementation of the
  retry and abort semantics rather than two
- `src/modules/customer-import/` — client, mapper, job
- `cliente.externalId` — migration `0018`, the dedupe key
- `openspec/specs/customer-management/spec.md` — one new requirement

## Branching

Targets `feat/customer-deactivation` (#69). That branch adds migration `0017`;
generating this one from `main` or from #68 would produce a colliding number.
**#68 → #69 → this**, in that order.

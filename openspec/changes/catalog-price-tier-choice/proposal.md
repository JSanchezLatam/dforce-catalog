# Proposal: choose which price lists a catalog prints

## Why

The workshop asked, from the beginning, to choose which price lists a catalog
shows. That requirement was never written down — `.kiro/specs/dforce-catalog/
requirements.md` does not contain the word "precio" — and losing it cost the
feature twice over:

1. `574ad97` built it: a "Lista de precios" `Select` in the review step. One
   tier was chosen and only that tier reached the PDF.
2. `2e317f4` removed it. The proposal behind it read the single tier as a
   REGRESSION — *"PR #27/#28 dropped two of the three tiers the ERP already
   returns... this change restores all three"* — rather than as a deliberate
   choice, and corrected to the opposite extreme.
3. R13 then froze that reading into a spec: *"MUST NOT offer a price-tier
   selector"*, with a scenario and a test asserting the control's absence.

Nothing here was careless. Each step was locally reasonable; the requirement
simply did not exist in writing, so there was nothing for step 2 to contradict.
Writing it down IS the fix — restoring the UI without amending R13 would leave
the same trap for the next change to fall into.

## What changes

The review step offers the three ERP lists as a checkbox group. **One or two**
may be chosen; every card prints one row per chosen list.

This is not the retired single-select restored. That control collapsed the
PAYLOAD to one tier before generation, so reprinting the same catalog against a
different list meant re-reading the ERP. The choice here is a RENDER
instruction: all three resolved tiers still travel to the worker, and only the
printed rows change.

## Scope

### In scope

- `tiers` on the generate payload and the `pdf-generate` job.
- A shared tier vocabulary (`shared/template/price-tiers.ts`): canonical print
  order, the labels both the checkbox and the printed card use, and the
  fallback for payloads that name no tiers.
- The 1..2 rule in `validateCatalogSelection`, re-run server-side.
- `AdaptiveCards` renders the chosen rows; the top row keeps the headline tint.

### Out of scope

- Persisting a default choice per workshop or per template. Every generation
  chooses; a remembered default is additive and nothing asked for it.
- Choosing tiers per product or per category.
- Any change to `queries.ts`' price SQL or to `resolveAllPrices` — both already
  return all three tiers and stay untouched.

## Decisions

**Cap of two, not three.** Explicitly requested. A catalog can no longer print
all three lists at once; that is the intended change, not a side effect.

**The default is Venta + Taller.** It applies only where a payload names no
tiers — a job enqueued before this change shipped. A worker that threw on those
would turn a queued catalog into a dead job nobody can retry.

**The cap is enforced by disabling, not by validating.** Once two boxes are
ticked the third is unreachable, and the last ticked box cannot be unticked. A
control that cannot express the invalid state beats an error explaining it
after the fact. `validateCatalogSelection` still re-checks on both sides —
the UI is convenience, not the boundary.

**Print order is fixed, not click order.** Ticking Socio first does not mean
"print Socio first". Renderers filter the canonical order rather than mapping
the caller's array, so two catalogs built from the same pair cannot disagree
about which row comes first.

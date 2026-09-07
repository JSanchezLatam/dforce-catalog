# Design: choose which price lists a catalog prints

The tier choice is a **render instruction**, not a payload filter. Everything
below follows from that one decision.

## D1 — `tiers` travels beside the products, never inside them

`ProductPrintRef.prices` keeps all three resolved tiers. The choice rides on
the payload as a sibling field (`GenerateBody.tiers`, `PdfGeneratePayload
.tiers`, `CatalogTemplateProps.tiers`).

**Why not filter the products.** The retired single-select collapsed the
payload before generation, so reprinting the same catalog against a different
list meant re-reading the ERP. Keeping the values whole makes a reprint a
render-time decision. It also means `queries.ts`, `resolveAllPrices` and the
`isValidPrices` guard are untouched by this change.

## D2 — the vocabulary lives in `shared/template/price-tiers.ts`, not in `CatalogTemplate.tsx`

`PriceTier`, `PRICE_TIER_ORDER`, `PRICE_TIER_LABELS` and `DEFAULT_PRICE_TIERS`
are a new module even though `ProductPrices` — the type `PriceTier` is derived
from — lives in `CatalogTemplate.tsx`.

**Why.** `registry-types.ts` documents the type-only cycle `CatalogTemplate →
registry → registry-types → CatalogTemplate` and warns in writing that it
survives only while nothing on that path needs a RUNTIME value from
`CatalogTemplate.tsx`. `AdaptiveCards` is on that path (via
`templates/dforce-classic.tsx`) and needs the order array at runtime. The new
module imports `ProductPrices` as `import type`, which is erased, so it adds
no runtime edge of its own.

## D3 — one default, resolved at the top

`CatalogTemplate` resolves `tiers?.length ? tiers : DEFAULT_PRICE_TIERS` once.
Below that point `tiers` is required and undefaulted — in `CardProps`, in the
registry's `Card` seam, in `ProductPrices`.

**Why required below.** Same reasoning `AdaptiveCards` already applies to
`colors`: a card that falls back on its own when a caller forgets is the
silently half-configured failure the registry exists to prevent. A second
fallback is the one that drifts.

**Why a default at all.** Exactly one case: a `pdf-generate` job enqueued
before this change carries no `tiers`. A worker that threw on those would turn
a queued catalog into a dead job nobody can retry. `buildTemplateProps`
deliberately does NOT default — it passes `payload.tiers` through, including
`undefined`, so the fallback stays in one place.

## D4 — canonical print order, never click order

Renderers filter `PRICE_TIER_ORDER` rather than mapping the caller's array.

**Why.** Ticking Socio before Venta does not mean "print Socio first", and a
printed page that shuffles its price rows between catalogs is a defect. The
filter also makes a duplicate entry unable to produce a duplicate row and an
unknown entry unable to produce an empty one.

## D5 — the headline tint follows position, not the name `venta`

The first PRINTED row gets the tint and the primary colour.

**Why.** That was Venta by construction while all three always printed. With a
choice, a Taller-only catalog would otherwise print its single price in the
muted trade colour and read like a footnote.

## D6 — an unchosen tier is omitted, not blanked

No row at all, rather than a row with an em-dash.

**Why.** The em-dash already means something specific: "this catalog quotes
that list, this product has no price". Reusing it for "this catalog does not
quote that list" makes the one symbol say two contradictory things on the same
page.

## D7 — the cap is enforced by disabling, validated anyway

With two ticked the third checkbox is disabled; with one ticked, that one is.
`validateCatalogSelection` re-checks 1..2, unknown names and duplicates, and
the route re-runs it.

**Why both.** A control that cannot express the invalid state beats an error
explaining it afterwards — but the UI is convenience, the route is the trust
boundary. `isGenerateBody` additionally rejects a wrong-TYPED `tiers` before
the validator sees it, because `validateCatalogSelection` calls `.filter` on
it and a string would surface as a 500 rather than a 400.

## Risks

**R1 — page packing.** Cards are paginated by heights MEASURED in the browser,
so a shorter card propagates on its own and no geometry constant changes.
The real hazard is the measurement pass and the print pass disagreeing:
`buildTemplateProps` exists so both are built from one object, and is tested,
because the mutation that removed `tiers` from the worker's props survived
every other test in the suite.

**R2 — the footer.** Two hardcoded strings named all three lists on the index
and product pages. They are derived now, from the same filter the card uses.

**R3 — the spec.** R13 forbade this control and R6 required all three tiers.
Amending only R13 would leave R6 asserting the opposite of the code — the same
shape of failure that lost this requirement the first time.

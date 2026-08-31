# Delta Spec: catalog-generation (catalog-price-tier-choice)

Modifies `openspec/specs/catalog-generation/spec.md`.

## MODIFIED Requirements

### Requirement: PDF Catalog Generation (R6)

Amended for one sentence only; every other clause of R6 (the `ProductPrintRef`
extension, template/workshop branding, image-type card selection, and the
`productsPerPage`-is-a-maximum rule) stands unchanged.

Every product card SHALL show one price row per tier CHOSEN for that catalog —
between one and two of `venta`, `taller`, `socio` — in bold, in the canonical
order `venta, taller, socio`. A chosen tier with no usable price (absent from
the payload, or an ERP value `<= 0.00`) SHALL render an em-dash (`—`), never
`$0.00` and never a blank line. A tier that was NOT chosen SHALL be absent from
the card entirely, with no row and no em-dash: an em-dash states "this catalog
quotes that list and this product has no price", which is a different and
false claim.

The page footer SHALL name exactly the chosen tiers, derived from the same
selection the cards render. A footer naming a list the cards do not carry is
the one error a customer reads directly off the page.

(Previously: "Every product card SHALL show all three price tiers (Venta,
Taller, Socio) in bold". This sentence is the reason this entry exists at all —
amending only R13 would leave R6 asserting the opposite of the shipped code,
which is precisely how the requirement this change restores was lost.)

#### Scenario: Only the chosen tiers appear

- GIVEN a product with venta=120.00, taller=100.00, socio=90.00
- AND the catalog chose Venta and Socio
- WHEN its card renders
- THEN the Venta and Socio prices MUST appear, each bold and labeled
- AND no Taller row MUST be present, neither priced nor em-dashed

(Replaces the scenario "All three tiers present", which asserted that all
three MUST appear.)

#### Scenario: Footer names the chosen lists

- GIVEN the catalog chose Venta and Socio
- WHEN any index or product page renders
- THEN its footer MUST read "Venta · Socio" and MUST NOT name Taller

### Requirement: Review Step (R13)

`CatalogBuilderForm`'s review step MUST offer a price-list control: a checkbox
group over the three ERP tiers (`venta`, `taller`, `socio`), of which the user
MUST choose at least one and at most two. Every card in the generated catalog
MUST print exactly one price row per chosen tier, in the canonical order
`venta, taller, socio` regardless of the order chosen.

Every reviewed product MUST still carry all three resolved tiers through to
generation. The choice is a RENDER instruction, not a payload filter: the
unchosen tiers' values MUST reach the worker, so the same catalog can be
regenerated against a different pair without re-reading the ERP.

(Previously: R13 required that the review step MUST NOT offer a price-tier
selector and that all three tiers always print. That requirement was itself a
correction of an earlier single-select that collapsed the payload to one tier —
see this change's proposal. Both extremes are superseded: the choice returns,
the payload stays whole.)

#### Scenario: Tier control shown with two pre-chosen

- GIVEN the review step renders with candidates selected
- WHEN the Usuario views it
- THEN a checkbox MUST be present for each of Venta, Taller and Socio
- AND Venta and Taller MUST be checked, Socio unchecked

#### Scenario: A third choice is unreachable

- GIVEN two tiers are chosen
- WHEN the Usuario views the remaining checkbox
- THEN that checkbox MUST be disabled rather than accepting the click and
  reporting an error afterwards

#### Scenario: The last choice cannot be removed

- GIVEN exactly one tier is chosen
- WHEN the Usuario views that checkbox
- THEN it MUST be disabled — a card with no price row is not a catalog

#### Scenario: Only the chosen tiers print

- GIVEN Venta and Socio are chosen
- WHEN the catalog renders
- THEN each card MUST show a Venta row and a Socio row and no Taller row at all
- AND the omitted row MUST NOT appear as an em-dash, which states the opposite
  ("we quote that list; this product has no price")

#### Scenario: Chosen tier with no usable price

- GIVEN Taller is chosen and a product's `taller` is `null` or `<= 0`
- WHEN the catalog renders
- THEN that product's Taller row MUST print an em-dash, never `$0.00`

#### Scenario: The first printed row is the headline

- GIVEN Taller and Socio are chosen
- WHEN the catalog renders
- THEN the Taller amount MUST be tinted in the template's primary colour, as
  Venta was when it was always first

#### Scenario: A payload naming no tiers still renders

- GIVEN a `pdf-generate` job enqueued before this change, carrying no `tiers`
- WHEN the worker renders it
- THEN the catalog MUST print Venta and Taller rather than failing the job

#### Scenario: Rejected selections

- GIVEN a generate request whose `tiers` is empty, names three, repeats a tier,
  or names an unknown list
- WHEN the route validates it
- THEN it MUST respond 400 with a `tiers` field error, having re-run the same
  pure validator the client ran

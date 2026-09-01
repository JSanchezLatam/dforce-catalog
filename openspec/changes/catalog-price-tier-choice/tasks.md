# Tasks: choose which price lists a catalog prints

All work units below are complete (commits `02442f2`, `820b25d`, `d4dd770`,
`bcaf83a`, `ee0176d`).

## WU1 — the shared vocabulary

- [x] 1.1 `shared/template/price-tiers.ts`: `PriceTier`, `PRICE_TIER_ORDER`,
  `PRICE_TIER_LABELS`, `DEFAULT_PRICE_TIERS` (design D2)
- [x] 1.2 `AdaptiveCards` drops its local `TIER_LABELS` copy and imports the
  shared one — the checkbox and the printed card now read the same string

## WU2 — rendering

- [x] 2.1 `CardProps.tiers`, required and undefaulted (D3)
- [x] 2.2 `ProductPrices` filters `PRICE_TIER_ORDER` (D4); headline tint by
  position (D5); unchosen tiers omitted, not em-dashed (D6)
- [x] 2.3 Thread through `registry-types`' `Card` seam and `dforce-classic`
- [x] 2.4 `CatalogTemplateProps.tiers`; the single default resolution (D3)
- [x] 2.5 Both page footers derived from the resolved selection (R2)

## WU3 — the contract

- [x] 3.1 `MIN_PRICE_TIERS`/`MAX_PRICE_TIERS` and the 1..2 / unknown /
  duplicate rules in `validateCatalogSelection` (D7)
- [x] 3.2 `GenerateBody.tiers` + `isGenerateBody` type rejection (D7)
- [x] 3.3 `PdfGeneratePayload.tiers`; `buildTemplateProps` extracted so the
  measurement pass is testable (R1)

## WU4 — the review step

- [x] 4.1 Checkbox group over the three tiers, Venta+Taller pre-chosen
- [x] 4.2 Cap enforced by disabling (D7)
- [x] 4.3 `tiers` in the POST body, held in canonical order
- [x] 4.4 `errors.tiers` rendered beside the control

## WU5 — the writing-down

- [x] 5.1 Delta MODIFIES R13 (the selector returns) **and** R6 (cards print
  the chosen tiers, footer names them) — R3
- [x] 5.2 `proposal.md` records the three-step history that lost the
  requirement, so the next change has something to contradict

## WU6 — the two surfaces the first pass missed

- [x] 6.1 The builder's LIVE PREVIEW takes `tiers`. It renders no product
  cards, which is the wrong reason to skip it: it renders the index page, and
  that page carries the same footer. Without the prop it named the default two
  lists directly under the checkbox group that sets them, while the PDF printed
  what was ticked — the R2 failure on the one screen showing both at once
  (`bcaf83a`)
- [x] 6.2 `scripts/preview-catalog.ts` takes `TIERS=venta,socio`, validated by
  `validateCatalogSelection` rather than a hand-rolled check, first thing in
  `main()` so a bad flag costs no DB work. design.md R1 makes card height the
  packing hazard, and the one-row card — the new MINIMUM height — could not be
  previewed at all before this (`d4dd770`, `ee0176d`)
- [x] 6.3 Two assertions that could not fail on what they named: the
  product-page footer (satisfied by the index footer's superstring) and the
  `errors.tiers` test's name (`ee0176d`)

## Follow-ups (raised in review, out of scope here)

- [ ] **The tiers error renders behind the modal.** On a 400,
  `handleConfirmGenerate` sets `errors` and returns without closing the confirm
  dialog, and `ConfirmGenerateDialog` has no error surface — so the message
  lands in the review card *behind* the overlay. The jsdom test passes because
  jsdom does no layering. Pre-existing: `errors.total` and `errors.form` have
  the same problem. Fix is an error surface on the dialog itself, for all three.
- [ ] **`npm test` is not reliably clean.** A review of this branch got 6, 11
  and 10 failures across three runs, a different set each time, in files this
  branch never touches (`app-sidebar`, `UserForm`, `ForcedPasswordChangeForm`,
  `CustomerForm`, `WorkshopConfigForm`). One showed interleaved keystrokes
  (`'lLeurn.-cVoime 9-'` for `'Lun-Vie 9-18, Sáb 9-13'`) — `userEvent` starving
  under parallel load against a 5s timeout. AGENTS.md's code-quality gate
  requires a clean `npm test` before a PR; right now nobody can meet it, so
  nobody is really checking it. Needs its own change (pool/timeout tuning).
- [ ] **`selection.ts` error messages are half-migrated.** The new `tiers`
  messages are Spanish per the language rule; `categories`/`total`/
  `productsPerPage` are still English and render in the same form.

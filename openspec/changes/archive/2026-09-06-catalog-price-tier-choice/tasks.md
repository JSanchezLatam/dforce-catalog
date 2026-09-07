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

- [x] ~~**The tiers error renders behind the modal.**~~ **CLOSED 2026-09-06**,
  branch `fix/tiers-error-behind-modal`. `ConfirmGenerateDialog` has its own
  error surface now, covering all three paths below plus a fourth this entry
  did not know about: `handleConfirmGenerate` had no `catch` at all. Tests
  assert CONTAINMENT (`within(dialog)`), which jsdom can prove, rather than
  visibility, which it cannot. Original text: On a 400,
  `handleConfirmGenerate` sets `errors` and returns without closing the confirm
  dialog, and `ConfirmGenerateDialog` has no error surface — so the message
  lands in the review card *behind* the overlay. The jsdom test passes because
  jsdom does no layering. Pre-existing: `errors.total` and `errors.form` have
  the same problem. Fix is an error surface on the dialog itself, for all three.
- [x] ~~**`npm test` is not reliably clean.**~~ **CLOSED — fixed by the
  `maxWorkers: 2` cap on the jsdom project** (`vitest.config.ts`, whose own
  comment records the measurement: the same files run 89/89 isolated, and the
  whole suite green at `--maxWorkers=2`). The trigger was worker contention
  starving `userEvent`, not anything in this branch. Verified closed on
  2026-09-06: `npm test` is 1242/1242 and was run repeatedly through the
  C1/C2/C6 work without a flake. Original text: a review of this branch got 6,
  11 and 10 failures across three runs, a different set each time, in files it
  never touches — one showing interleaved keystrokes (`'lLeurn.-cVoime 9-'` for
  `'Lun-Vie 9-18, Sáb 9-13'`).

- [x] ~~**`selection.ts` error messages are half-migrated.**~~ **CLOSED
  2026-09-06**, branch `fix/tiers-error-behind-modal` — all four English
  strings translated, forced by that change giving them a second surface in the
  confirm dialog. Original text:
  **`selection.ts` error messages are half-migrated.** The new `tiers`
  messages are Spanish per the language rule; `categories`/`total`/
  `productsPerPage` are still English and render in the same form.

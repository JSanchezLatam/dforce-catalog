```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:ed129c38f8533c0a30bc98ab796ffa62d89129ccb34ae60bc0ec6267a9ce7eab
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 10/10
scenarios: 22/22
test_command: npm test -- --run
test_exit_code: 0
test_output_hash: sha256:77ba2a161bfaab4d03323eb829121805bb9af416dc4cb7ba94345758fbb1c3f6
build_command: npx tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: catalog-templates-and-workshop-info
**Version**: N/A (change-folder deltas; no `openspec/specs/` consolidation yet)
**Mode**: Standard (Strict TDD enabled per project config; underlying RED/GREEN task pairs verified in tasks.md, no separate TDD-cycle table requested for this re-run)

This is a **re-run**. The previous verify pass (Engram `sdd/catalog-templates-and-workshop-info/verify-report`, 2026-08-12) returned **FAIL** on one CRITICAL finding: the ADDED requirement "Workshop Contact Block on Cover" was never implemented. WU5 (PR #38, commits `aed34aa` + `aa5da24`) was built to close it. This report verifies WU5 on top of the four already-merged work units and re-confirms the six previously-passed checks did not regress.

### CRITICAL finding from the last run — status: CLOSED

Confirmed by direct source inspection, not by re-reading apply-progress claims:

- `CatalogTemplateBranding`/`PdfBranding` now carry `contact: WorkshopContact | null` and `coverImageUrl`/`coverImageR2Key` (`src/shared/template/CatalogTemplate.tsx:41-63`, `src/modules/pdf-generation/worker.ts`).
- `generate/route.ts:159` and `CatalogBuilderForm.tsx:564` both call the one shared `buildWorkshopContact()` (`src/modules/workshop-config/contact.ts`) — no drift between preview and PDF (Risk-5 preserved for the new surface too).
- `CatalogTemplate.tsx:258-318` renders a dedicated contact `<section aria-label="Contact">` placed **after** the product pages (last, matching `Template_Catalogo.op`'s own `0/1/2/3` page order) — not on the cover.
- All 6 contact rows + `socialHandles` render conditionally per field; unset fields are individually omitted (`CONTACT_ROWS.filter(...)`, `Object.keys(contact.socialHandles).length > 0` guard).
- Migration `0010_workshop_cover_image.sql` (additive, confirmed on disk) adds `cover_image_r2_key`/`cover_image_content_type`.

Success criterion "A generated PDF shows workshop phone/WhatsApp/email/address/hours and social handles" (proposal.md) is now met in code, matching the recorded live-smoke evidence for both required states (full contact, and half-unset + no cover photo).

### Spec text change confirmed and agreed

The requirement's own literal title and body changed from "Workshop Contact Block **on Cover**" to "Workshop Contact Block" (dedicated last page), with an inline note explaining why. I agree this is the correct call, not a rationalization of shipped code:

- The cover layout (`CatalogTemplate.tsx`'s Cover `<section>`) already carries a hero photo, a black clip-path wedge, a red diagonal accent, and a logo plate — six contact rows plus a variable-length social-pill row do not fit that composition without either shrinking to illegibility or overflowing.
- The layout authority cited, `Insumos/Templates/Template_Catalogo.op` page "3 · Contacto y redes", is the owner-approved source (same standing as `Portada_DForce_v1.html` for the cover) — its own page numbering (`0 Portada, 1 Índice, 2 Productos, 3 Contacto`) places contact last, not on page 0.
- The original spec text predates that mockup being read page-by-page (WU1 wrote the requirement before WU5's translation work), which is exactly the kind of drift `sdd-verify` exists to catch — here it was caught by GGA during WU5's own pre-PR review and corrected by the same commit that fixed the resulting bug, with the correction and the bug fix both recorded verbatim in `aa5da24`'s commit message.
- A third scenario ("No contact information at all → no contact page") was added at the same time and is now the direct regression test for bug #2 below.

I did not find a version of the argument that favors keeping "on Cover" — the fit problem is real and visible in the code's own layout math, so the spec was the correct thing to move.

### Two bug fixes — both confirmed present in code

**Bug 1 — invisible cover photo (`mix-blend-mode: multiply` against black).**
`CatalogTemplate.tsx:159`: `background: coverImageUrl ? "#ffffff" : black`. White is used only when a photo is actually set; the fallback path (`coverImageUrl` null) keeps the original `black` background feeding the red/black wedge composition. The `<img>` with `mixBlendMode: "multiply"` (line 167) is only rendered when `coverImageUrl` is truthy (line 163), so there is no white background ever shown without a photo, and no black-on-black invisibility when a photo is set. Comment block at lines 153-158 records the root cause (`multiply` against black is always black) taken verbatim from `Portada_DForce_v1.html`'s own CSS comment. Both states are covered by `render.test.ts` at the structural level (`<img>` present + `src` value when set; no `<img alt="">` when unset) — this does **not** prove pixel-level visibility, which is exactly the class of bug it missed the first time; the visual claim rests on the recorded live-smoke transcript (apply-progress.md), not on unit tests. Flagging this honestly rather than claiming the unit suite proves it, per `AGENTS.md`'s coverage-limit rule.

**Bug 2 — blank contact page for an all-null contact object.**
`buildWorkshopContact()` (`src/modules/workshop-config/contact.ts:23`) returns `null` only when `config` itself is `null`; a real (singleton) `workshop_config` row with every contact field unset returns an **object of nulls**, never `null`. `CatalogTemplate.tsx` previously gated the whole `<section>` on `contact &&` (truthy-object check), so that object-of-nulls still rendered an empty black page. The fix (`aa5da24`) adds `hasContactContent()` (`CatalogTemplate.tsx:71-76`), which checks whether any of the 6 fields or `socialHandles` actually has content, and gates the section on `hasContactContent(contact) && contact`. Confirmed `name` alone deliberately does **not** qualify (`hasContactContent` only inspects `CONTACT_ROWS` + `socialHandles`, never `contact.name`) — matches the stated reasoning that the brand name is already on the cover. A dedicated regression test exists at `render.test.ts:320` ("renders no contact page when every contact field is null, not a blank page") asserting `expect(html).not.toContain('aria-label="Contact"')`, distinct from the pre-existing `contact === null` test the bug's own postmortem says never covered the real path. Both tests pass in the current run (790/790).

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 66 |
| Tasks complete | 66 |
| Tasks incomplete | 0 |

One documentation defect noted (not a task-completion gap): task `6.15`'s text in `tasks.md` is self-contradictory — it says **"PASSED, three non-blocking flags"** and then, in the same line, **"NOT RUN"** with the pre-GGA line-count-overrun rationale left in place from an earlier revision. `git show aa5da24` confirms the checkbox itself flipped from `[ ]` to `[x]` and the "PASSED" text was prepended, but the stale "NOT RUN" sentence was never deleted. Functionally the task is complete (PR #38 merged, GGA output described), but the artifact reads as contradicting itself to a future reader. WARNING, not CRITICAL — recorded below.

### Build & Tests Execution
**Build**: ✅ Passed (`npx tsc --noEmit`, exit 0, no output)

**Tests**: ✅ 790 passed / 0 failed / 0 skipped (66 test files)
```text
$ npm test -- --run
 Test Files  66 passed (66)
      Tests  790 passed (790)
   Duration  20.10s
```
790 vs. the last report's 759 and apply-progress's recorded 789/789 for WU5 — the +1 over WU5's own recorded number is exactly the new `hasContactContent` regression test added in `aa5da24` after WU5's apply-progress was last written; no drift, no regression.

**Lint**: ✅ 0 errors / 17 warnings (`npm run lint`, exit 0) — all 17 are `@typescript-eslint/no-unused-vars` / `@next/next/no-img-element` on pre-existing files plus `CatalogTemplate.tsx`'s now-3 `<img>` elements (cover photo, cover logo, contact-page logo). **Correction to apply-progress's own record**: WU5's apply-progress claims "+1 new warning" over the WU4 baseline of 15; the actual delta is **+2** (15 → 17), because `CatalogTemplate.tsx` gained two new `<img>` tags (cover photo + contact-page logo), not one — confirmed by diffing `CatalogTemplate.tsx` at `e3b405a` (pre-WU5, 1 `<img>`) against the current tree (3 `<img>`s). Zero errors either way; this is a minor self-report inaccuracy, not a functional problem. SUGGESTION below.

**Coverage**: not configured for this project (no coverage threshold in package.json/vitest config) → ➖ Not available, consistent with prior verify passes.

### Spec Compliance Matrix

#### `template-config` (4 requirements, 5 scenarios)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Template Gallery Selection (R8.1) | Gallery replaces the style editor | `TemplateConfigForm.test.tsx` | ✅ COMPLIANT |
| Template Gallery Selection (R8.1) | Selecting a template | (none — only 1 registry entry, no `onChange` fires) | ⚠️ PARTIAL — structurally unverifiable with a single-entry gallery; recorded WU2 deviation, unchanged since last verify, WU5 did not touch `registry.ts`/`TemplateConfigForm.tsx` |
| Template Gallery Selection (R8.1) | Single-entry gallery | `TemplateConfigForm.test.tsx` | ✅ COMPLIANT |
| Template Selection Persistence (R8.4) | Selection survives a restart | `template-config/service.test.ts` | ✅ COMPLIANT |
| Template Selection Persistence (R8.4) | Orphaned id falls back | `registry.test.ts` | ✅ COMPLIANT |

REMOVED requirements (no scenarios; verified by migration inspection): `Per-Generation Font and Color Selection` and `Template-Owned Logo URL and Cover Text` — both confirmed dropped in `0009_template_config_branding_split.sql` (`DROP COLUMN logo_url, primary_colors, font, cover_text`), unchanged file, re-confirmed present on disk this run.

#### `catalog-generation` (3 requirements, 9 scenarios)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Review Step (R13) | No tier selector shown | `CatalogBuilderForm.test.tsx:77` | ✅ COMPLIANT |
| Review Step (R13) | All three tiers travel to generation | `CatalogBuilderForm.test.tsx:85` (asserts real POST body `prices: {venta,taller,socio}`) | ✅ COMPLIANT |
| PDF Catalog Generation (R6) | All three tiers present | `AdaptiveCards.test.tsx`, `render.test.ts` | ✅ COMPLIANT |
| PDF Catalog Generation (R6) | A zero tier renders an em-dash | `AdaptiveCards.test.tsx` (hostile `0`/`0.00`) | ✅ COMPLIANT |
| PDF Catalog Generation (R6) | A missing tier renders an em-dash | `AdaptiveCards.test.tsx` | ✅ COMPLIANT |
| Workshop Contact Block | Full contact info | `render.test.ts` (all rows + social pills present) | ✅ COMPLIANT |
| Workshop Contact Block | Partial contact info | `render.test.ts` (only set fields render, no empty labels) | ✅ COMPLIANT |
| Workshop Contact Block | No contact information at all | `render.test.ts:320` (new, `aa5da24`) — closes bug #2 | ✅ COMPLIANT |
| Workshop Contact Block | Logo matches the live preview | `worker.test.ts` (data-URI resolution, byte-identical claim recorded live-smoke, not re-proven this pass) | ✅ COMPLIANT (unit-level); pixel/byte identity is live-smoke evidence, verified as recorded |

#### `workshop-settings` (3 requirements, 8 scenarios)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Workshop Contact Information | Partial update preserves other fields | `workshop-config/service.test.ts` | ✅ COMPLIANT |
| Workshop Contact Information | Hours is one free-text field | `service.test.ts:47` (verbatim string, no parsing) | ✅ COMPLIANT |
| Workshop Contact Information | New social platform needs no migration | `service.test.ts:51` (arbitrary `socialHandles` key) | ✅ COMPLIANT |
| Cover Text Ownership | Cover text survives a template switch | (none — architecturally true via separate `workshop_config`/`template_config` tables; no scenario-level test asserts it) | ⚠️ PARTIAL — unchanged since last verify |
| Cover Text Ownership | Cover text applies on next generation | (none — same) | ⚠️ PARTIAL — unchanged since last verify |
| Independence from Template Config Logo | Preview uses the authenticated route | (none directly — `CatalogBuilderForm.tsx:557` hard-codes `/api/workshop-config/logo`, confirmed by source read, not by a test asserting the fetch) | ⚠️ PARTIAL — unchanged since last verify |
| Independence from Template Config Logo | PDF matches the preview exactly | `worker.test.ts` (data-URI resolution unit tests); byte-identity itself is live-smoke, recorded not re-proven | ✅ COMPLIANT (unit-level) |
| Independence from Template Config Logo | No logo set | `worker.test.ts` (`logoUrl: null` without throwing), `render.test.ts` (no `<img>` when unset) | ✅ COMPLIANT |

**Compliance summary**: 18/22 scenarios fully COMPLIANT, 4/22 PARTIAL-but-accepted (counted complete: implemented and non-blocking, not FAILING or unexplained UNTESTED) (all four are pre-existing WARNINGs carried unchanged from the last verify pass, on files WU5 never touched — confirmed via `git diff --stat` against the WU5 branch point). 0 scenarios FAILING or UNTESTED-and-unexplained.

### Correctness (Static Evidence) — the six re-confirmation checks

| Check | Status | Notes |
|---|---|---|
| R8.4 read/write asymmetry | ✅ Unchanged | `registry.ts` (unmodified by WU5) still falls back to default on read; `template-config/service.ts` (unmodified by WU5) still rejects unknown id on write. Confirmed via `git diff --stat` — neither file appears in WU5's changeset. |
| Em-dash money rule | ✅ Unchanged | `AdaptiveCards.tsx:25-26` `formatTier`: `value == null \|\| value <= 0 → "—"`. File untouched by WU5 (not in WU5's diff stat). |
| Two-layer price guard | ✅ Unchanged | `generate/route.ts`'s `isTier`/`isValidPrices` untouched logic; WU5's only edit to this file is the branding-assembly addition (lines ~155-159), confirmed via source read — the price-validation block above it is byte-identical to WU4's version. |
| Risk-5 one shared renderer | ✅ Held under WU5 | `render.ts` and `CatalogBuilderForm.tsx` both still import the single `@/shared/template/CatalogTemplate`; WU5 added the contact/cover-image branding fields to the *same* shared component rather than forking a variant. `buildWorkshopContact()` is itself a new instance of Risk-5 discipline — one function, two call sites (server route + client preview). |
| Logo data URI path | ✅ Unchanged, extended | `worker.ts`'s `resolveBranding()` still resolves `logoR2Key` via `getObject()` before `renderCatalogHtml`; WU5 factored the R2→data-URI logic into a shared `resolveImageDataUri()` helper and reused it for `coverImageR2Key`, rather than duplicating it. `getObject()`→`null` still yields `logoUrl: null` without throwing (`worker.test.ts`). |
| REMOVED requirements' migrations | ✅ Unchanged | `0009_template_config_branding_split.sql` still drops `logo_url, primary_colors, font, cover_text`; re-confirmed on disk. `0008` still adds the workshop contact columns + backfills `cover_text`. WU5's own migration (`0010`) is additive-only, no drops — consistent with the proposal's "additive migration first, drop last" rollback plan. |

Additional correctness spot-checks specific to WU5:

| Item | Status | Notes |
|---|---|---|
| Recorded debt: `String()` coercion on upload-key fields | ✅ Confirmed, unchanged in kind | `service.ts:163-172` — now 4 fields (`logoR2Key`, `logoContentType`, `coverImageR2Key`, `coverImageContentType`), the latter two added by WU5 mirroring the existing pattern exactly, as recorded. Not a new gap; explicitly out of scope per WU1. |
| Pre-authorized gap: `chunkProducts` splits by count, not measured height | ✅ Confirmed present, unchanged | `DEFAULT_PRODUCTS_PER_PAGE = 6` in `selection.ts`, untouched by WU5. |
| Pre-authorized gap: task 3.14 production queue drain | ✅ Confirmed, unaffected by WU5 | Checkbox text still states "NOT executed against production"; deploy-time step, out of this verify's scope. |
| 66/66 tasks match code state | ✅ Confirmed | Every WU5 task (`6.1`-`6.14`, all `[x]`) has a corresponding code change or test in the current diff; `6.15` (GGA) is `[x]` with a self-contradictory note (see Completeness section above). |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| D6 — one `WorkshopContact` object on both branding shapes, not 7 flat fields | ✅ Yes | `CatalogTemplate.tsx:41-50` matches D6's literal type. |
| D6 — cover image reuses WU3's R2→data-URI path, not a new mechanism | ✅ Yes | `resolveImageDataUri()` shared helper, confirmed. |
| D6 — worker stays a pure function of its payload (no `workshop_config` read inside the worker) | ✅ Yes | `contact` passes through the pg-boss payload verbatim (`worker.ts:109`); no DB import in `worker.ts` for contact data. |
| D6 — unset field omitted, never an empty label | ✅ Yes | Per-field `CONTACT_ROWS.filter()` + `socialHandles` length guard. |
| D6 — missing cover photo degrades to red/black block, never a broken `<img>` | ✅ Yes | Conditional `<img>` render, background fallback confirmed. |
| D6's own code block omitted `coverImageUrl` from `CatalogTemplateBranding` | ⚠️ Design gap, self-corrected | `apply-progress.md` and task `6.7` both flag this omission and explain why it was added anyway (renderer cannot show the photo otherwise). Same class of gap that caused WU5 to exist in the first place — recorded honestly this time, not silently patched. Not a new finding; carried forward as a design-process observation. |
| Data Flow diagram (design.md, updated for D6) now routes `contact` and `coverImageR2Key` out of `workshop_config` | ✅ Yes | Confirmed against the ASCII diagram at `design.md:184-196` — matches the actual call graph (`route.ts`/`CatalogBuilderForm.tsx` → `buildWorkshopContact()` → branding → worker → `resolveImageDataUri`). |

### Issues Found

**CRITICAL**: None. The prior CRITICAL finding (Workshop Contact Block unimplemented) is **CLOSED**, verified by direct source inspection of the render path, the branding-assembly call sites, and a passing regression test for the specific bug that was found and fixed along the way.

**WARNING**:
1. `tasks.md` task `6.15` contains self-contradictory text ("PASSED... three non-blocking flags" followed immediately by a stale "NOT RUN" sentence from an earlier revision that was never deleted). The checkbox is `[x]` and the work is functionally done (PR #38 merged), but the artifact reads as internally inconsistent to a future reader. Recommend cleaning the stale sentence before archive.
2. Four scenarios remain implemented-but-not-scenario-tested, unchanged from the last verify pass and on files WU5 never touched: `R8.1` "Selecting a template" (single-entry gallery, structurally can't fire `onChange`), "Cover text survives a template switch", "Cover text applies on next generation", and "Preview uses the authenticated route". None regressed under WU5; none block this change, carried as pre-existing debt.
3. The cover-photo visibility fix (Bug 1) is proven only by the recorded live-smoke transcript, not by a re-run this pass or by a unit test capable of catching a blend-mode regression (the existing unit test only asserts `<img>`/`src` presence, same limitation that let the original bug through). This is disclosed rather than silently accepted, per `AGENTS.md`'s coverage-limit rule — a future change to the cover markup could reintroduce this exact bug without any test failing.

**SUGGESTION**:
1. `apply-progress.md`'s WU5 record undercounts the new lint warnings by 1 ("+1 new warning" recorded vs. the actual +2, confirmed by diffing `CatalogTemplate.tsx` against its pre-WU5 revision `e3b405a`). Zero functional impact (0 errors either way); worth a correction for record accuracy.
2. Consider a lightweight Playwright/visual-regression smoke (even a single screenshot diff) for the cover-photo blend-mode path, given it has now caused one real, only-visually-detectable bug — this is a process suggestion, not a blocker, and is explicitly out of scope per the proposal's "no change to the logo upload/serving route itself" and the design's "verifiable only live" testing strategy for `renderPdfBuffer`.

### Verdict
**PASS WITH WARNINGS**

The CRITICAL finding from the previous verify pass is closed: the Workshop Contact Block now renders on a dedicated last page, sourced correctly from `workshop_config` via one shared `buildWorkshopContact()` mapping used identically by both the live preview and the PDF worker. Both bugs found after the previous verify pass (invisible cover photo, blank contact page) are confirmed fixed in the current code with passing regression tests where testable. All 66 tasks are complete and match the code state. 790/790 tests pass, `tsc --noEmit` is clean, lint has 0 errors. The six previously-passed checks (R8.4 asymmetry, em-dash rule, two-layer price guard, Risk-5 single renderer, logo data-URI path, REMOVED-requirement migrations) hold unregressed — confirmed by direct diff-stat inspection showing the relevant files were untouched by WU5, not by re-trusting the prior report. Remaining items are pre-existing, non-blocking WARNINGs (4 scenarios without direct scenario-level tests, unchanged since the last pass) plus one documentation self-contradiction in `tasks.md` worth cleaning before archive. Recommend `sdd-archive`.

```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:local-worktree-2026-08-12
verdict: fail
blockers: 1
critical_findings: 1
requirements: 7/10
scenarios: 17/21
test_command: npm test -- --run
test_exit_code: 0
test_output_hash: sha256:f1e539df5ae099bd17d20741cdf2fe75219de881b874dd4fad9ae54e76caa6de
build_command: npx tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: catalog-templates-and-workshop-info
**Version**: N/A (no openspec/specs/ tree consolidated yet — deltas live in the change folder, per task 5.1)
**Mode**: Strict TDD
**Branch verified**: `feature/catalog-templates-and-workshop-info` (tracker; not merged to `main`)

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 51 |
| Tasks complete | 51 |
| Tasks incomplete | 0 |

Task 3.14 (drain the production pg-boss queue) and the deploy-time claim it
carries are explicitly recorded as NOT executed against production — the
checkbox text itself says so. Treated as correctly documented, not a false
"done", per the user's framing; not counted as an incomplete task.

### Build & Tests Execution
**Build**: ✅ Passed
```text
npx tsc --noEmit — clean, 0 errors
```

**Tests**: ✅ 759 passed / 0 failed / 0 skipped (65 files)
```text
npm test -- --run
Test Files  65 passed (65)
     Tests  759 passed (759)
```
Matches WU4's apply-progress-recorded 759/759 exactly — no drift since apply.

**Lint**: ✅ 0 errors, 15 pre-existing warnings (matches WU4's recorded 15; none introduced by this change, confirmed by diffing the warning file list against apply-progress's per-WU warning counts).

**Coverage**: Not run — no coverage script configured in this repo; not available.

**Live/e2e evidence**: NOT independently re-run this verify pass. A disposable
dev Postgres container was found running (`proyectocatalogo-db-1`,
`localhost:5433`) but `src/e2e/full-flow.e2e.test.ts` is documented (README,
apply-progress) as requiring its own disposable Postgres instance — running
it against the shared dev DB risked mutating real rows for no verification
benefit, so it was not run. Per `AGENTS.md`'s coverage-limit rule cited in
the task brief, **the green unit suite above proves nothing about the
hand-built price SQL in `queries.ts` or the real R2/Chromium logo path** —
those two facts are accepted here only on the strength of apply-progress's
recorded live-smoke transcripts (WU1's three live migration smokes, WU3's
byte-identical data-URI smoke, WU4's `full-flow.e2e.test.ts` 5/5 run against
a disposable container). This report explicitly does not upgrade those to
"independently verified" — they are "verified as recorded, not re-proven."

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ⚠️ Partial | WU4 has a full RED/GREEN/REFACTOR "TDD Cycle Evidence" table; WU1–WU3 report RED/GREEN per-task inline in `tasks.md` ("RED `x.test.ts`" / "GREEN `x.ts`" labels) and narrative RED→GREEN prose in `apply-progress.md`, but not the structured table format |
| All tasks have tests | ✅ | Every RED-labeled task in `tasks.md` has a corresponding test file confirmed to exist and pass in the current tree (spot-checked: `service.test.ts`, `registry.test.ts`, `worker.test.ts`, `AdaptiveCards.test.tsx`, `CatalogBuilderForm.test.tsx`, `generate/route.test.ts`) |
| RED confirmed (tests exist) | ✅ | All named test files exist in the tree |
| GREEN confirmed (tests pass) | ✅ | 759/759 on this exact tree |
| Triangulation adequate | ✅ | `AdaptiveCards.test.tsx` triangulates all-present / one-missing / all-missing / hostile-zero across both card variants (`describe.each`); `generate/route.test.ts` triangulates per-tier trust-boundary rejections individually |
| Safety Net for modified files | ➖ Not independently re-verified | Trusted from apply-progress's per-round GGA and live-smoke narrative; not re-run here |

**TDD Compliance**: 4/6 checks fully passed, 2 partial/trusted — WARNING (format-only gap for WU1–WU3, not a substantive TDD-was-skipped finding; every task traces to a real test file that exists and passes).

---

### Assertion Quality
Spot-checked `AdaptiveCards.test.tsx`, `worker.test.ts`, `registry.test.ts`, `service.test.ts` (template-config): no tautologies, no assertion-without-production-call, no ghost loops over possibly-empty collections. `AdaptiveCards.test.tsx`'s "all `null`" and "hostile 0" cases assert concrete rendered text (`—`, absence of `$0.00`), not smoke-only `toBeInTheDocument()`. `worker.test.ts` asserts exact `data:` URI byte content and exact `getObject` call arguments, not just truthiness.

**Assertion quality**: ✅ All spot-checked assertions verify real behavior.

---

### Spec Compliance Matrix

**catalog-generation**

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| R13 Review Step | No tier selector shown | `CatalogBuilderForm.test.tsx` (task 4.11) | ✅ COMPLIANT |
| R13 Review Step | All three tiers travel to generation | `CatalogBuilderForm.test.tsx` — asserts real POST body `prices` | ✅ COMPLIANT |
| R6 PDF Catalog Generation | All three tiers present | `AdaptiveCards.test.tsx` + `render.test.ts` | ✅ COMPLIANT |
| R6 PDF Catalog Generation | A zero tier renders an em-dash | `AdaptiveCards.test.tsx` "hostile 0 tier" + `render.test.ts` "zero-value tier" | ✅ COMPLIANT |
| R6 PDF Catalog Generation | A missing tier renders an em-dash | `AdaptiveCards.test.tsx` + `render.test.ts` "one missing" | ✅ COMPLIANT |
| Workshop Contact Block on Cover | Full contact info | **none found** | ❌ **UNTESTED — not implemented** |
| Workshop Contact Block on Cover | Partial contact info | **none found** | ❌ **UNTESTED — not implemented** |
| Workshop Contact Block on Cover | Logo matches the live preview | `worker.test.ts` (`resolveBranding`) | ✅ COMPLIANT (logo only) |

**template-config**

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| R8.1 Gallery Selection | Gallery replaces the style editor | `TemplateConfigForm.tsx` source (no color/font/logo/cover-text input remains) + `TemplateConfigForm.test.tsx` | ✅ COMPLIANT |
| R8.1 Gallery Selection | Selecting a template | `TemplateConfigForm.test.tsx` | ⚠️ PARTIAL — only one registry entry exists, so the switch path itself is unverified (recorded as a known WU2 deviation, closes once a 2nd template ships) |
| R8.1 Gallery Selection | Single-entry gallery | `registry.test.ts` "includes the default template id" + form renders `CATALOG_TEMPLATES.map` | ✅ COMPLIANT |
| R8.4 Persistence | Selection survives a restart | `service.test.ts` "passes selectedTemplateId to insert/onConflictDoUpdate" + WU2 live smoke (fresh `getTemplateConfig()` call) | ✅ COMPLIANT |
| R8.4 Persistence | Orphaned id falls back | `registry.test.ts` `getTemplate` unknown/null → default | ✅ COMPLIANT (READ path) |
| REMOVED: Per-Generation Font/Color Selection | N/A (no scenarios) | migration `0009` DROP `font`, `primary_colors` | ✅ Migration confirmed |
| REMOVED: Template-Owned Logo URL/Cover Text | N/A (no scenarios) | migration `0009` DROP `logo_url`, `cover_text`; migration `0008` ADD `workshop_config.cover_text` | ✅ Migration confirmed |

**workshop-settings**

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Workshop Contact Information | Partial update preserves other fields | `service.test.ts` line ~56 block (`it.each` partial-touch) | ✅ COMPLIANT |
| Workshop Contact Information | Hours is one free-text field | `service.test.ts` "stores hours verbatim with no per-day parsing" | ✅ COMPLIANT |
| Workshop Contact Information | New social platform needs no migration | `service.test.ts` "accepts socialHandles with an arbitrary platform key" | ✅ COMPLIANT |
| Cover Text Ownership | Cover text survives a template switch | **no direct test** — structurally guaranteed (separate tables/services; `saveTemplateConfig` never touches `workshop_config`) | ⚠️ PARTIAL — architecturally sound, not scenario-tested |
| Cover Text Ownership | Cover text applies on next generation | `generate/route.ts` reads `getWorkshopConfig()` fresh per request; `render.test.ts` | ✅ COMPLIANT |
| Independence from Template Config Logo | Preview uses the authenticated route | `CatalogBuilderForm.tsx:556` (`logoR2Key ? "/api/workshop-config/logo" : null`) — **no test asserts this literal value** | ⚠️ PARTIAL — implemented, not unit-asserted |
| Independence from Template Config Logo | PDF matches the preview exactly | `worker.test.ts` (byte-exact data URI) + WU3 live smoke (byte-for-byte real R2 comparison, not re-run here) | ✅ COMPLIANT |
| Independence from Template Config Logo | No logo set | `worker.test.ts` "logoUrl: null without calling getObject()" + `CatalogTemplate.tsx`'s `branding?.logoUrl &&` guard | ✅ COMPLIANT |

**Compliance summary**: 17/21 scenarios fully compliant, 2 partial (architecturally sound but not directly test-asserted — WARNING), 2 untested/unimplemented (CRITICAL).

---

### Correctness (Static Evidence) — the six specifically-requested checks

| # | Check | Status | Notes |
|---|---|---|---|
| 1 | R8.4 read/write asymmetry | ✅ Confirmed, coherent, tested, spec-consistent | `getTemplate()` (`registry.ts:18`) falls back to default for unknown/null id — READ rule, tested in `registry.test.ts`. `validateTemplateConfigInput` (`service.ts:61-70`) rejects an unknown id, throwing `TemplateConfigValidationError` (→ 400 at `route.ts`) — WRITE trust boundary, tested in `service.test.ts` ("rejects an unknown selectedTemplateId"/"rejects a non-string"). The code's own docstring (`service.ts:41-46`) argues the split explicitly. The delta spec's literal R8.4 text scopes the fallback to "the persisted id no longer matches... (e.g. after a deploy removed it)" and "WHEN the system resolves branding for a generation" — i.e. an already-persisted id becoming orphaned by a registry edit, a READ-time concern. It does not literally bless (or forbid) rejecting a client-submitted unknown id at write time. The split is a reasonable, non-contradictory reading, not a spec violation, but it is an inference, not a verbatim mandate — worth a one-line spec clarification, not a blocker. |
| 2 | Em-dash money rule | ✅ Confirmed, spec-mandated, pinned by tests at two layers | R6's literal text: "a tier with no usable price — absent... or an ERP value `<= 0.00` — SHALL render an em-dash (`—`), never `$0.00`". `AdaptiveCards.tsx:26` (`formatTier`) implements `value == null \|\| value <= 0 → "—"` exactly. Pinned by `AdaptiveCards.test.tsx`'s explicit "hostile 0 tier ... never $0.00" test and `render.test.ts`'s "renders a zero-value tier as an em-dash, never $0.00" (which asserts `.not.toContain("$0.00")` on real rendered HTML, not just a unit call). |
| 3 | Two-layer price guard coherence | ✅ Coherent, nothing falls between the layers | `isTier` (`generate/route.ts:46`) is `v == null \|\| (typeof v === "number" && Number.isFinite(v))` — copied verbatim from design D4, deliberately accepts negative finite numbers (a `TypeError`-prevention guard, not a business-rule guard). `formatTier` (`AdaptiveCards.tsx:26`) independently re-guards `<= 0` at render time. A negative number passes `isTier`, reaches the renderer, and is caught by `formatTier`'s `<= 0` check → em-dash. No value can be both "accepted by isTier" and "printed as raw negative currency" — the two guards' domains overlap by design (design.md documents this explicitly as deliberate, not accidental). Recorded in apply-progress as a GGA suggestion (tighten to `v > 0`) that was correctly declined as out-of-scope of the literal design block. |
| 4 | Risk-5 — one shared renderer | ✅ Confirmed, never forked | `render.ts:43` (`renderToStaticMarkup(CatalogTemplate(props))`, PDF path) and `CatalogBuilderForm.tsx:547` (`<CatalogTemplate .../>`, live preview) both import and use `@/shared/template/CatalogTemplate` — the identical component, identical props type. No second copy exists anywhere in `src`. |
| 5 | Logo data URI | ✅ Confirmed, code path matches spec, unit-covered | `worker.ts`'s `resolveBranding()` (lines 77-93) reads R2 bytes via injectable `getObject`, inlines `data:${contentType};base64,...`, and is called from `renderPdfBuffer` (line 107) before `renderCatalogHtml`. `getObject` returning `null` yields `logoUrl: null` without throwing (matches D3's "missing logo must not fail the job"). Fully covered by `worker.test.ts`'s 5 cases (null branding, successful resolve, content-type default, null-object no-throw, no-key skips `getObject()` entirely). The "pixel/byte identical to the live preview" claim itself is a live-smoke-only fact (WU3's real-R2 comparison), not independently re-run this pass. |
| 6 | `REMOVED` requirements' migrations | ✅ Both confirmed to have actually happened | `0009_template_config_branding_split.sql`: `DROP COLUMN logo_url, primary_colors, font, cover_text` on `template_config` — exact match to the Migration note. `0008_workshop_contact_info.sql`: adds `workshop_config.cover_text` plus a hand-appended `INSERT ... ON CONFLICT DO NOTHING` + `UPDATE workshop_config SET cover_text = (SELECT cover_text FROM template_config WHERE id='singleton') WHERE cover_text IS NULL` — the described migration path, plus two extra data-integrity fixes (singleton-row creation, `id='singleton'` instead of `ORDER BY ... LIMIT 1`) recorded and justified in apply-progress as pre-PR local fixes, not post-merge edits. |

### 🔴 New finding — not one of the six requested checks, discovered during matrix mapping

**The "Workshop Contact Block on Cover" ADDED requirement (`catalog-generation` spec) is not implemented.** `CatalogTemplateBranding` (`CatalogTemplate.tsx:37-41`) and `PdfBranding` (`enqueue.ts`, assembled in `generate/route.ts:148-153`) both carry only `{templateId, logoUrl/logoR2Key, coverText}`. `phone`, `whatsapp`, `email`, `address`, `hours`, `website`, `socialHandles` are persisted in `workshop_config` (WU1: schema, validation, admin form) but **never read by `generate/route.ts`, never carried by `PdfBranding`, and never rendered anywhere in `CatalogTemplate.tsx`**. A grep across `src/shared/template`, `src/modules/pdf-generation`, and `src/app/api/catalog-builder/generate` for any of those field names returns zero matches. `design.md`'s own Data Flow diagram (line 139) only routes `coverText`/`logoR2Key` into the branding types — the contact fields were dropped between the proposal (whose own success criteria list: *"A generated PDF shows workshop phone/WhatsApp/email/address/hours and social handles"*) and the design, and `tasks.md` never assigned a task to wire them in. Confirmed against `git blame`-equivalent inspection of every WU's "What shipped" section in `apply-progress.md` — none mentions rendering contact fields on the cover.

This is a genuine spec-vs-implementation gap, not one of the two gaps the task brief pre-authorized ("New Risk #4 page overflow" and "task 3.14 queue drain"). It was not recorded anywhere in `apply-progress.md` as a known/accepted gap.

---

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 registry contract (tokens + one `Card` seam) | ✅ Yes | `registry.ts`, `template-ids.ts`, `dforce-classic.tsx` match the literal type shape |
| D2 branding split (two shapes) | ✅ Yes | `CatalogTemplateBranding` vs `PdfBranding` exist as separate types exactly as designed — but neither carries contact fields (see finding above; this is a *design* gap, not an apply deviation) |
| D3 logo resolution in `renderPdfBuffer` | ✅ Yes | `resolveBranding()` called before `renderCatalogHtml` |
| D4 three tiers, one render-site guard | ✅ Yes | `isTier`/`formatTier` layering matches literally |
| D5 two migrations, additive first | ✅ Yes | `0008`/`0009` split confirmed |
| Risk-5 (one renderer) | ✅ Yes | confirmed above |
| New Risk #1 (render.ts font) | ✅ Yes | `render.test.ts` "PDF body font-family resolves from getTemplate" |
| New Risk #2 (queue drain) | ⚠️ Recorded as carried, not executed | Task 3.14's own checkbox text says so — matches the task brief's pre-authorized gap #2 |
| New Risk #3 (NOT NULL sequencing) | ✅ Yes | WU2 kept legacy inputs until WU3's `0009` |
| New Risk #4 (page overflow) | ⚠️ Recorded, mitigated by `DEFAULT_PRODUCTS_PER_PAGE`, not fixed | Matches the task brief's pre-authorized gap #1 — confirmed `selection.ts` |

### Known, pre-authorized gaps (confirmed present, not treated as findings)

1. **New Risk #4 — page overflow.** `apply-progress.md` (task 4.15) confirms a 10-product section spilling across 2 physical PDF pages, no card cut in half. `DEFAULT_PRODUCTS_PER_PAGE = 6` confirmed present in `src/modules/catalog-builder/selection.ts`. `chunkProducts` measuring real height instead of a fixed count remains out of scope per `design.md`. Confirmed recorded, not fixed.
2. **Task 3.14 — production queue drain.** `tasks.md` line 83 explicitly states dev was verified empty and the production drain is carried in PR bodies of #36/#37, "NOT executed against production." Checkbox honestly reflects this. Confirmed recorded, not fixed.

### Issues Found

**CRITICAL**:
1. **Workshop Contact Block on Cover is unimplemented.** The ADDED requirement in `catalog-generation`'s delta spec (phone/WhatsApp/email/address/hours/website/social handles on the cover) has two of its three scenarios ("Full contact info", "Partial contact info") with zero implementation and zero tests. Data model, validation, and admin form exist (WU1); nothing reads or renders them into a catalog. This also breaks one of `proposal.md`'s explicit success criteria. Blocks archive until either implemented or the spec/proposal is amended to descope it.

**WARNING**:
1. R8.1 "Selecting a template" scenario is structurally unverifiable with only one registry entry (`onChange` never fires) — recorded as a known WU2 deviation, closes once a second template ships. Not a defect, just an open scenario.
2. "Cover text survives a template switch" and "Preview uses the authenticated route" are implemented but not directly asserted by a test — architecturally sound (separate tables/services; literal source line), but a future refactor could silently break either with no red test to catch it.
3. TDD Cycle Evidence table format is present only for WU4; WU1–WU3 use inline RED/GREEN task labels + prose instead of the structured table. Every underlying test file was confirmed to exist and pass — this is a reporting-format gap, not evidence that TDD was skipped.
4. Live/e2e evidence (real Postgres SQL round-trip, real R2 byte comparison, real Chromium PDF) is accepted only on the strength of `apply-progress.md`'s recorded transcripts from the apply session — not independently re-run in this verify pass. Per `AGENTS.md`'s injected-seam coverage-limit rule, the green unit suite alone does not prove this; recommend a fresh live smoke before archive if significant time has passed since WU3/WU4's smokes.

**SUGGESTION**:
1. `service.ts`'s R8.4 docstring is the only place the read/write asymmetry is explained; consider adding one clarifying line to `specs/template-config/spec.md`'s R8.4 text making the write-time trust-boundary rejection an explicit, named behavior rather than an inference from "resolves branding for a generation."
2. `registry.ts`'s `thumbnail` field still points at a non-existent asset (`/templates/dforce-classic.png`); the gallery renders a color swatch instead. Recorded already in apply-progress as a non-blocking follow-up.

### Verdict
**FAIL** — one CRITICAL, spec-mandated requirement (Workshop Contact Block on Cover: phone/WhatsApp/email/address/hours/website/social handles) has no implementation and no test coverage anywhere in the render pipeline, despite `tasks.md` reporting 51/51 tasks complete and `apply-progress.md` reporting all four work units "done." All six specifically-requested checks (R8.4 asymmetry, em-dash rule, two-layer guard, Risk-5 shared renderer, logo data URI, REMOVED-requirement migrations) pass with real test coverage. The two pre-authorized gaps (page overflow, queue drain) are correctly recorded as open, not silently dropped. Recommend routing back to `sdd-apply` (or `sdd-tasks`/`sdd-design` first, since no task ever assigned this work) to either implement the contact block or formally descope it from the spec/proposal before archiving.

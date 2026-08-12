# Apply Progress: Catalog Templates and Workshop Info

Phase: `sdd-apply` · Store: hybrid (Engram `sdd/catalog-templates-and-workshop-info/apply-progress` + this file)

## WU1 — Workshop Contact Info + `coverText` (Phase 1, tasks 1.1–1.10)

Status: **done**. Branch `catalog-tpl/wu1-workshop-info`, cut from tracker
`feature/catalog-templates-and-workshop-info`.

All ten Phase 1 tasks complete — see `tasks.md` for per-task checkmarks.

### What shipped

- `src/shared/db/schema.ts` — `workshopConfig` gains `phone`, `whatsapp`,
  `email`, `address`, `hours`, `website`, `coverText` (all nullable text) and
  `socialHandles` (jsonb); `templateConfig` gains `selectedTemplateId`
  (nullable text, unwired until WU2/WU3). `templateConfig.logoUrl` /
  `primaryColors` / `font` / `coverText` are untouched (still `NOT NULL`) —
  dropping them is WU3's migration `0009`.
- `src/shared/db/migrations/0008_workshop_contact_info.sql` — drizzle-kit
  generated `ALTER TABLE` statements, plus a hand-appended
  `UPDATE workshop_config SET cover_text = (SELECT cover_text FROM
  template_config LIMIT 1) WHERE cover_text IS NULL` to preserve the
  owner's already-typed cover text.
- `src/modules/workshop-config/service.ts` — `WorkshopConfigInput` extended
  with the 8 new fields; `validateWorkshopConfigInput` and
  `saveWorkshopConfig` reuse the existing `"field" in value` /
  `"field" in parsed` partial-touch guards (no new upsert pattern invented).
  Pre-existing `name` handling was pulled into the same discipline
  (`"name" in parsed`, not always-set) — an RDD review pass caught that
  `name` was the one field the module's own partial-touch pattern didn't
  cover, so a partial POST omitting `name` would have nulled it.
- `src/modules/workshop-config/WorkshopConfigForm.tsx` — added contact
  fields (Teléfono, WhatsApp, Email, Dirección, Horario, Sitio web), a
  Texto de portada textarea, and a dynamic social-handle key/value row
  editor (Agregar/Eliminar red social). All labels in Spanish per
  `AGENTS.md`'s language rule.
- New test files: `src/modules/workshop-config/service.test.ts` (RED→GREEN
  additions) and `src/modules/workshop-config/WorkshopConfigForm.test.tsx`
  (new file).

### Deviations from tasks.md

None. `templateConfig.selectedTemplateId` was added in this WU's migration
per design D5, even though task 1.1 only mentions `workshopConfig` fields —
task 1.2 and design.md's migration table both require it here so WU2 has a
column to persist into.

An RDD review during apply caught the PR shipping a premature
`openspec/specs/` consolidation of `catalog-generation` and
`template-config` (not authorized by any WU1 task) that asserted "FULL
current state" facts not yet true on this branch. Reverted both files and
the `archive/README.md` policy change back to their pre-PR state; the
change-folder delta specs under `specs/` stay, since those are correctly
scoped deltas.

### Risk carried into WU2/WU3

**Duplicate live `coverText` editor.** `WorkshopConfigForm.tsx`'s new
"Texto de portada" field writes to `workshop_config.coverText`, but the PDF
renderer still reads `template_config.coverText` (via
`TemplateConfigForm.tsx`, untouched in WU1) until WU3 wires the registry
and drops the legacy branding columns. Between this PR merging and WU3
landing, an Administrador who edits the new field sees "Configuración
guardada." with **no effect on any generated catalog** — the old field
is still the one that renders. Not a WU1 defect (design.md's New Risk #3
already covers the `NOT NULL` constraint driving this sequencing), but
WU2/WU3's tasks should close this window deliberately rather than by
sequencing luck — e.g. hide or label the new field as "not yet active"
until WU3 wires it, or land WU3 promptly after this merges.

**`getWorkshopConfig()` can now return a non-null, all-null-fields row.**
Migration `0008`'s `INSERT ... ON CONFLICT DO NOTHING` (added to fix the
cover-text data-loss bug above) means any install that never had a
`workshop_config` row before this migration now gets one — every field
`NULL` except `id`/`updatedAt`. Previously `getWorkshopConfig()` returned
`null` on such an install (`service.test.ts`'s "returns null when no config
has been saved" test still passes only because it mocks the query, not the
real migrated schema). Audited every current caller
(`app/(app)/layout.tsx`, `app/(app)/workshop-config/page.tsx`,
`app/api/workshop-config/route.ts`, `app/api/workshop-config/logo/route.ts`)
— all of them already read through optional chaining (`config?.name`,
`config?.logoR2Key`) rather than branching on `config === null`, so none is
affected today. WU3's `generate/route.ts` (not yet written) must follow the
same discipline and not assume `getWorkshopConfig() === null` means
"nothing configured".

**Full-overwrite form fixed to a diff-based submit.** `WorkshopConfigForm.tsx`
originally sent every field on every save. An RDD review pass caught the
consequence: a save from a browser tab that loaded before some OTHER field
was set elsewhere would silently revert it (a stale-tab data-loss path,
same shape whether or not `""` collapses to `NULL`). Fixed by snapshotting
`initialConfig` on mount and only including a field in the POST body when
its current value differs from that snapshot — matching `UserForm.tsx`'s
existing "omit unchanged optional fields, but send an explicit empty value
for a deliberate clear" precedent. The snapshot updates after a successful
save so a second edit in the same session diffs against the just-saved
state, not the original page load.

**Caveat, not fully closed:** the diff protects every scalar field but NOT
`socialHandles` — it is one jsonb column, diffed and sent as a whole map.
If two tabs each add a different platform, the second save still drops the
first's addition. This is inherent to a single map column, not something
worth building per-key merge semantics for on a single-admin app, but is
recorded here so it is not mistaken for fully solved.

**`saveWorkshopConfig` callers audited for the `name` partial-touch change.**
`app/api/workshop-config/logo/route.ts`'s `POST`/`DELETE` both read the
current config only to re-supply `name` unconditionally on every logo
save/clear — the exact clobber this WU's `name` fix was meant to close, now
made reachable instead of just theoretical. Removed `name` (and the two
inert `id`/`updatedAt` keys `validateWorkshopConfigInput` was silently
ignoring) from both calls; `DELETE`'s now-unused `getWorkshopConfig()` call
was removed entirely.

**Follow-up, out of WU1's scope (GGA final pass, non-blocking):**
`logoR2Key`/`logoContentType` in `service.ts` still go through
`String(value.logoR2Key)` — the exact non-string coercion `readTextField`'s
docstring was written to avoid. Pre-existing code, not touched by any WU1
task, so hardening it here would be scope creep; noting it so a future
change (or WU2, which touches this file's neighbor) picks it up
deliberately rather than by accident.

### Verification

- `npm test` — 722/722 passing (full suite, not just this module).
- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors, 17 pre-existing warnings (none introduced by
  this change).
- `GGA_PROVIDER=claude gga run --pr-mode --diff-only` (cross-cutting task
  5.2), run against `feature/catalog-templates-and-workshop-info` as base:
  eight rounds total across this apply session, each finding fixed and
  re-verified before the next run — the fixes above (empty-string/type
  coercion at the trust boundary, the two migration data-integrity bugs,
  the stale-tab full-overwrite form, the logo route's `name` clobber, and
  the `name`/`socialHandles` trimming inconsistencies) all came out of this
  loop, not the unit-test suite alone. Final round: clean.
- Live smoke (task 1.10): ran `npm run db:migrate` against the real dev
  Postgres (`postgres://dforce:dforce@localhost:5433/dforce_catalog`).
  Confirmed via `psql`:
  - `workshop_config.cover_text` was hand-copied from `template_config`'s
    existing row ("Para mas informacion escribenos al 6666 6666").
  - Every other new `workshop_config` column defaulted to `NULL`.
  - `template_config.selected_template_id` defaulted to `NULL`; the four
    legacy branding columns stayed `NOT NULL` and unchanged.
- Second live smoke, added after RDD review caught the cover-text data-loss
  edge case above: created a scratch database on the same Postgres
  instance, applied migrations `0000`–`0007`, seeded a `template_config`
  row while leaving `workshop_config` empty (the exact scenario the
  original `UPDATE`-only migration couldn't handle), and confirmed the
  unfixed `0008` left `workshop_config` with zero rows — then confirmed the
  fixed version (`INSERT ... ON CONFLICT DO NOTHING` ahead of the `UPDATE`)
  correctly created the singleton row with `cover_text` backfilled. Scratch
  database dropped afterward. Because `0008` had already been applied to
  the real dev DB before the fix, and drizzle-orm's migrator hashes the
  full migration file to detect "already applied", the dev DB's recorded
  hash for migration `8` was updated to match the corrected file content —
  confirmed a subsequent `db:migrate` run against it is a clean no-op that
  does not attempt to re-run the (already-applied) `ADD COLUMN` statements.
- Third live smoke, same scratch-DB technique: a follow-up review pass
  correctly pointed out `template_config.id` has no DB-level singleton
  constraint, so the migration's `ORDER BY "id" LIMIT 1` picked an
  arbitrary row rather than the one the app actually reads
  (`template-config/service.ts` always keys by the literal id
  `'singleton'`). Reproduced with a second, abandoned `template_config` row
  ordering *before* `'singleton'` lexicographically, confirmed the ordered
  version copied the wrong row's cover text, then fixed the subquery to
  `WHERE "id" = 'singleton'` (matching the app's own key exactly, not a
  guess) and confirmed it now picks the right row regardless of any extra
  rows present. Dev DB's migration `8` hash updated again to match.

**On editing `0008` after applying it locally three times.** `design.md`
D5's "an applied migration is never edited" targets migrations already
merged and applied in shared environments (`0000`–`0007`, all on `main`) —
the whole reason the drop in `0009` is sequenced last. `0008` itself has
never been pushed, reviewed, or applied anywhere but this local dev
sandbox; catching and fixing its bugs before the PR opens is what review is
for, not a violation of the rule the rule exists to protect. Also fixed:
the file was missing its trailing newline (every other migration in this
folder has one — drizzle-kit generates it; the hand-append had stripped
it).

### Next

WU2 (template registry + gallery picker) can start once this PR merges to
the tracker branch — it depends on `template_config.selected_template_id`
existing, which is now in place.

## WU2 — Template Registry + Gallery Picker (Phase 2, tasks 2.1–2.8)

Status: **done**. Branch `catalog-tpl/wu2-template-registry`, cut from
`catalog-tpl/wu1-workshop-info` (WU1's PR #33 not yet merged). PR targets
WU1's branch, not the tracker and not `main`.

All eight Phase 2 tasks complete — see `tasks.md` for per-task checkmarks.
~361 changed lines (347 insertions, 14 deletions across nine files), against
an estimate of ~280 — over budget but well under the ledger cap of 700 and
the ~500-line stop-and-report threshold; the overrun is mostly two GGA
review rounds' worth of hardening (below), not scope growth.

### What shipped

- `src/shared/template/registry.ts` (new) — `CatalogTemplateDef` type,
  `CATALOG_TEMPLATES` array, `getTemplate(id?)` with a never-null fallback
  to the default template, per design D1.
- `src/shared/template/template-ids.ts` (new) — `KNOWN_TEMPLATE_IDS` and
  `DEFAULT_TEMPLATE_ID`, split out of `registry.ts` with zero JSX/component
  imports so a server-only module (`template-config/service.ts`, which
  imports `@/shared/db/client`) can validate an id without pulling in
  `registry.ts`'s Card-bearing entries — mirrors the
  `workshop-config/limits.ts` precedent from WU1. `registry.test.ts` has a
  drift-guard test asserting `CATALOG_TEMPLATES`' ids exactly match this
  list.
- `src/shared/template/templates/dforce-classic.tsx` (new) — the one
  registry entry: `font: "Arial, sans-serif"`,
  `primaryColors: { primary: "#D42027", secondary: "#000000" }` (red band /
  black stripe from the mockup), `thumbnail: "/templates/dforce-classic.png"`
  (asset does not exist yet — see Deviations), and a `Card` component that
  is today's `CatalogTemplate.pickCard` strict/adaptive branch, moved here
  per design D1. **Additive and unwired**: `CatalogTemplate.tsx` was not
  touched; nothing calls `getTemplate()` or `template.Card` yet. WU3 wires
  it.
- `src/modules/template-config/service.ts` — `TemplateConfigInput` gains
  `selectedTemplateId?: string | null`; `validateTemplateConfigInput`
  validates it against `KNOWN_TEMPLATE_IDS` (any unknown/non-string value
  falls back to `null`, matching R8.4's "orphaned id falls back" scenario).
  `getTemplateConfig`/`saveTemplateConfig` gained an injectable `db` param
  (defaulting to the real client), matching `workshop-config/service.ts`'s
  DI pattern, so the persistence tests below can spy on the query builder.
- `src/modules/template-config/TemplateConfigForm.tsx` — added a gallery
  picker (native radio inputs, `role="radiogroup"`, Spanish label "Plantilla
  del catálogo") over `CATALOG_TEMPLATES`, pre-selected via
  `getTemplate(config?.selectedTemplateId).id`. On save, POST body includes
  `selectedTemplateId` alongside the existing branding fields.
- New/extended tests: `registry.test.ts` (new), `service.test.ts` (extended:
  `selectedTemplateId` validation + registry-membership + DI-based
  persistence assertions), `TemplateConfigForm.test.tsx` (new).

### Deviations from tasks.md

**The gallery EXTENDS the branding form; it does not replace it.** Tasks
2.6/2.7 read literally as "no color/font/logo/cover-text input present" /
"replace branding inputs with a gallery picker" — which is also the delta
spec's (`specs/template-config/spec.md`) end-state language ("MUST NOT show
any color, font, logo, or cover-text input"). That end state is WU3's,
not WU2's: `template_config.logo_url/primary_colors/font/cover_text` stay
`NOT NULL` until migration `0009` (WU3), so `saveTemplateConfig` must keep
receiving values for all four or the upsert fails (design.md Risk #3,
explicitly flagged there as "WU2's picker cannot delete the branding
inputs — WU3 does"). This was confirmed as the correct reading before
implementation (not discovered via review) — task 2.5's "internally
supplies placeholder values… they are no longer form inputs" framing is
what's superseded here, not the NOT-NULL constraint itself. The gallery
picker was built as an addition alongside the existing Logo URL / colors /
Typography / Cover text inputs; WU3's task 3.12 is what deletes them, once
migration `0009` drops the columns they write to. `tasks.md` 2.5/2.6 are
annotated with this deviation.

**Thumbnail asset does not exist.** `registry.ts`'s `thumbnail` field
documents `/public/templates/<id>.png`; `dforce-classic.tsx` sets
`/templates/dforce-classic.png`. No `public/templates/` PNG was added in
this PR — no design tool was available to produce real artwork from the
proprietary `.op` mockup within this work unit. `TemplateConfigForm.tsx`
renders a colored swatch (`template.primaryColors`) in the gallery instead
of an `<img>`, so nothing ships broken; swap it for a real thumbnail once
one exists (follow-up, not blocking).

**Selection-switch path (spec: "Selecting a template") is unverified.**
With exactly one registry entry, pre-selected, clicking the radio fires no
`onChange` — `TemplateConfigForm.test.tsx`'s submit test passes on the
form's initial state alone, not on an actual selection change. Noted in
the test file itself. Closes once a second template exists (out of this
change's scope — proposal.md: "A second template is an additive PR").

### Verification

- `npm test` — 739/739 passing (full suite).
- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors, 17 pre-existing warnings (same count as WU1;
  none introduced by WU2 — the one new gallery `<img>` from an earlier
  draft was replaced by a colored `<div>` swatch during review, see
  Deviations).
- `GGA_PROVIDER=claude gga run --pr-mode --diff-only`: five rounds, stopped
  deliberately (rationale below) rather than run to a clean pass. Note
  `PR_BASE_BRANCH` in `.gga` does not take effect for this gga version/repo
  combination (verified: `gga config` reports `auto-detect` even after
  editing `.gga`, and `bash -x` traces show the project config's `source
  <(...)` executing but the exported variable not landing in the review
  process) — every round therefore reviewed `main...HEAD`, which includes
  WU1's unmerged commits alongside WU2's. Findings scoped to WU1-only files
  were treated as out of WU2's authority and left alone; every actionable,
  non-contradictory WU2-scoped finding was fixed:
  - Round 1: `selectedTemplateId` had no validation against the registry's
    known ids (any string persisted verbatim) — fixed by validating against
    `KNOWN_TEMPLATE_IDS`, falling back to `null` on an unknown id (R8.4). The
    round-trip persistence test was flagged as tautological (a fake db that
    echoes back its own writes) — fixed with a live smoke against the real
    dev Postgres (see below) plus a spy-based unit test. Gallery thumbnail
    referenced a non-existent asset — replaced with a swatch. New tests
    pinned pre-existing English label text on fields WU3 deletes — switched
    to id-based queries.
  - Round 2: `service.ts` importing the Card-bearing `registry.ts` risked
    pulling client-component code into a server module (and vice versa,
    a "use client" form importing a module one hop from `@/shared/db`) —
    fixed by extracting `template-ids.ts` as a DB-free/JSX-free id source
    both sides import instead. `React.ReactElement` relied on the ambient
    global — made explicit. The unassociated `<Label>` gallery heading —
    changed to `<h2>`. Submit-button test query was unqualified
    (`getByRole("button")`) — name-qualified.
  - Round 3: the "fixed" round-trip test's fake `select` chain still
    ignored its arguments entirely (any table/column/where would still
    pass) — replaced with assertions on the actual `insert().values()` /
    `onConflictDoUpdate({set})` call arguments, matching
    `workshop-config/service.test.ts`'s own pattern. Recorded two decisions
    in `tasks.md` for WU3 rather than act on them here (translate
    `TemplateConfigForm`'s surviving English strings; don't assume
    `getWorkshopConfig() === null` means unconfigured).
  - Round 4: fixed a real (if type-only) import cycle between `registry.ts`
    and `dforce-classic.tsx` by extracting `registry-types.ts`; fixed the
    submit-button test still pinning `"Save"` text (round 2's fix
    name-qualified it without removing the English-copy pin); rewrote the
    `getTemplateConfig` persistence test to assert real query-builder
    arguments (table + `limit(1)`) instead of an empty tautology.
  - Round 5: asked for `where`'s exact filter argument too, not just
    `from`/`limit` — fixed (asserts `eq(templateConfig.id, "singleton")`).
    Renamed the submit test to state what it actually proves. Corrected
    `registry-types.ts`'s docstring to stop overclaiming the cycle is fully
    broken. Annotated `workshop-config`'s zero-rows test with the
    post-migration-0008 caveat.
  - **Stopped after round 5's second pass**, which re-reviewed round 4's
    fixes and **reversed two of its own prior blocking demands without
    acknowledging the reversal**: (a) round 1 required `selectedTemplateId`
    to fall back to `null` on an unknown id; round 5's new #2 called that
    same behavior a trust-boundary violation and demanded a hard validation
    error instead. (b) round 4 required extracting `registry-types.ts` to
    fix the type cycle; round 5's new #4 called the same file unnecessary
    and recommended deleting it. Round 5 also re-escalated the
    already-decided-and-recorded English-copy question (round 3: "record a
    decision, don't act"; round 5: "blocking, translate now") without a new
    argument. This is oscillation, not convergence — continuing to chase it
    risks alternating fixes that undo each other every round. Judgment call:
    keep the round-1/round-4 code (matches R8.4's documented read-path
    fallback semantics; the type-cycle fix is real and cheap to keep), leave
    the English-copy question as the round-3 recorded decision, and stop
    the loop here rather than push through — flagging the disagreement for
    the orchestrator/human reviewer rather than resolving it unilaterally
    by re-litigating the same three points a second or third time.
- Live smoke (task 2.8, closing the round-trip gap the unit tests cannot
  honestly claim): ran a throwaway `tsx` script against the real dev
  Postgres (`postgres://dforce:dforce@localhost:5433/dforce_catalog`),
  calling the real `saveTemplateConfig`/`getTemplateConfig` (not mocked).
  Saved `selectedTemplateId: "dforce-classic"`, confirmed a **fresh**
  `getTemplateConfig()` call (a new `select`, not the same in-memory value)
  returned it, then restored the row's prior `selectedTemplateId` (`null`)
  so the dev DB was left unmutated. Script deleted after the run — not part
  of the PR.

### Next

WU3 (wire registry into renderer; branding split; logo data URI;
migration `0009`) can start once this PR merges to WU1's branch. It should
also decide the thumbnail-asset follow-up and, per design.md's own New
Risk #2, drain the pg-boss `pdf-generate` queue before deploying.

## WU3 — Wire Registry Into Renderer; Branding Split; Logo Data URI;
Migration `0009` (Phase 3, tasks 3.1–3.15)

Status: **code complete, verified, NOT opened as a PR.** Branch
`catalog-tpl/wu3-wire-registry`, cut from tracker
`feature/catalog-templates-and-workshop-info` (which already contains WU1
and WU2, both merged). Stopped before task 5.2 (GGA review) and before
opening the PR — see "Budget" below.

All 14 of 15 Phase 3 tasks complete (3.14, draining the pg-boss queue, is a
deploy-time action not applicable to this dev sandbox — left as an explicit
checklist item for whoever ships this PR). See `tasks.md` for per-task
detail and the two recorded deviations (3.11's `logoUrl` gating, 3.6's
`resolveBranding` extraction).

### What shipped

- `src/shared/template/CatalogTemplate.tsx` — `CatalogTemplateBranding`
  shrinks to `{templateId, logoUrl, coverText}` (design D2); the renderer
  resolves font/colors via `getTemplate(branding?.templateId)` and delegates
  card markup to `template.Card`, removing the duplicated `pickCard` branch
  WU2 already moved into `dforce-classic.tsx`.
- `src/modules/pdf-generation/render.ts` — the PDF body's `font-family`
  resolves through the SAME `getTemplate()` call the cover uses, closing
  design's New Risk #1 (previously `props.branding?.font ?? "sans-serif"`
  silently drifted from the cover once font moved into the registry).
- `src/modules/pdf-generation/enqueue.ts` — new `PdfBranding` type
  (`{templateId, logoR2Key, logoContentType, coverText}`), the pg-boss
  payload shape, distinct from what the renderer consumes.
- `src/modules/pdf-generation/worker.ts` — new exported `resolveBranding()`
  (D3): reads the R2 object server-side via `getObject()` and inlines it as
  a `data:` URI, because Playwright cannot authenticate against
  `/api/workshop-config/logo`'s session-gated route (explore.md Risk 1).
  `getObject()` returning `null` yields `logoUrl: null` without throwing — a
  missing object must not fail a job that already consumed a queue slot.
  `renderPdfBuffer` calls it before `renderCatalogHtml`.
- `src/app/api/catalog-builder/generate/route.ts` — branding assembly reads
  `getWorkshopConfig()` alongside `getTemplateConfig()` and builds
  `PdfBranding` via `getTemplate(template?.selectedTemplateId).id` (never
  `null` — every field is independently nullable already).
- `src/app/(app)/builder/page.tsx` — added a `getWorkshopConfig()` read,
  passed to `CatalogBuilderForm` as a new `workshopConfig` prop.
- `src/modules/catalog-builder/CatalogBuilderForm.tsx` — the live preview's
  `branding` prop is now assembled the same way generate/route.ts's is.
- `src/modules/template-config/{TemplateConfigForm.tsx,service.ts}` — the
  four legacy branding inputs (logo URL, primary/secondary color,
  typography, cover text) and the form's own inline preview panel are gone;
  `TemplateConfigInput` shrinks to `{defaultImageHandling,
  selectedTemplateId}`. Surviving strings translated to Spanish per
  `AGENTS.md`'s language rule (`Save`→`Guardar`,
  `Saving…`→`Guardando…`, `Saved. New catalogs will use this
  template.`→`Guardado. Los nuevos catálogos usarán esta plantilla.`,
  `Image handling`→`Manejo de imágenes`).
- `src/shared/db/schema.ts` +
  `src/shared/db/migrations/0009_template_config_branding_split.sql` —
  `template_config` drops `logo_url`/`primary_colors`/`font`/`cover_text`
  (drizzle-kit generated, matches design D5's literal `DROP COLUMN` list
  exactly).

### Deviations from tasks.md (both confirmed correct before implementation)

1. **Task 3.6's literal wording** ("RED `worker.test.ts` — `renderPdfBuffer`
   resolves...") reads as testing `renderPdfBuffer` directly. Instead, the
   resolution logic was extracted into a new exported `resolveBranding()`
   and THAT is what `worker.test.ts` covers. Reason: `renderPdfBuffer`
   launches a real Playwright Chromium browser, and design.md's own Testing
   Strategy table already says it "has no unit coverage by design — the
   data-URI path is verifiable only live." Testing the extracted seam
   instead gives the actual crux of this work unit (R2 bytes → `data:` URI)
   real, fast, injected-dependency unit coverage — this repo's standing
   `deps?.thing ?? real` pattern — without mocking Playwright's Chromium,
   which the design explicitly flags as a live-smoke-only concern.
2. **Task 3.11's literal snippet** (`{templateId:
   templateConfig?.selectedTemplateId, logoUrl:
   "/api/workshop-config/logo", coverText: workshopConfig?.coverText}`)
   does not type-check against design D2's `CatalogTemplateBranding.
   templateId: string` (non-nullable) and would render a broken `<img>`
   when no logo has been uploaded. Implemented instead as
   `getTemplate(templateConfig?.selectedTemplateId).id` for `templateId`
   (always resolves to a concrete id) and `workshopConfig?.logoR2Key ?
   "/api/workshop-config/logo" : null` for `logoUrl` (only supplies the URL
   when a logo actually exists, preserving the pre-WU3 "no `<img>` at all
   when unset" behavior). The same `getTemplate(...).id` resolution is used
   in `generate/route.ts`'s branding assembly for the same type reason.

### Verification

- `npm test` — 737/737 passing (full suite; 10 new tests from RED work
  minus the ~15 template-config tests that no longer apply after 3.12's
  shrink, net -12 vs. WU2's 749).
- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors, 16 pre-existing warnings (one fewer than WU2's
  17 — no new warning introduced by this WU).
- Live smoke (task 3.15, required — design.md: "`renderPdfBuffer` has no
  unit coverage by design"): ran a throwaway `wu3-live-smoke.mts` (`npx tsx
  -r dotenv/config`) against the real dev Postgres
  (`postgres://dforce:dforce@localhost:5433/dforce_catalog`) and the real R2
  bucket already holding a real uploaded logo (`workshop_config.logoR2Key =
  "logos/1785201079552.png"`, 275,743 bytes). Confirmed:
  1. `resolveBranding()`'s decoded `data:` URI bytes are byte-for-byte
     identical to what a direct `getObject()` call (the same call
     `GET /api/workshop-config/logo` makes) returns — a stronger guarantee
     than a pixel diff, since identical bytes decode to identical pixels by
     construction and neither path re-encodes the image.
  2. The rendered HTML's body `font-family` is `Arial, sans-serif,` (the
     registry's `dforce-classic.font`), not the `sans-serif` fallback.
  3. A real Playwright Chromium (`npx playwright install chromium` was
     needed first — not previously installed in this sandbox) produced a
     real 329,792-byte PDF from that HTML; visually inspected page 1 — the
     actual Dforce Car Audio logo, the red-on-black cover band
     (`#D42027`/`#000000`, the `dforce-classic` template's colors), and the
     real `workshop_config.coverText` ("Para mas informacion escribenos al
     6666 6666") all render correctly.
  4. `0009` applied cleanly to the real dev DB (`node scripts/migrate.mjs`)
     and confirmed via `\d template_config` (the 4 columns are gone) and a
     `drizzle.__drizzle_migrations` row count check (10 rows, recorded in
     the correct schema — not the `public.__drizzle_migrations` mistake a
     past WU1 session made). Re-ran the migrate script a second time to
     confirm it is a clean no-op.
  Script and generated PDF deleted after the run — not part of the PR.

### Budget — stopped before GGA/PR

Real changed lines (`git diff --cached --numstat`, summed insertions +
deletions, **excluding** the auto-generated
`src/shared/db/migrations/meta/0009_snapshot.json`, 1134 lines of pure
drizzle-kit metadata): **797** across 16 hand-written files. The ledger cap
for this WU was 500; the instruction's own stop-and-report checkpoint was
~450. Per-file breakdown (insertions/deletions):

| File | +/- |
|---|---|
| `generate/route.test.ts` | 100/2 |
| `worker.test.ts` (new) | 70/0 |
| `worker.ts` | 41/3 |
| `TemplateConfigForm.test.tsx` | 32/21 |
| `service.test.ts` (template-config) | 27/127 |
| `CatalogTemplate.tsx` | 21/20 |
| `render.test.ts` | 19/1 |
| `enqueue.ts` | 16/2 |
| `TemplateConfigForm.tsx` | 16/132 |
| `generate/route.ts` | 14/9 |
| `CatalogBuilderForm.tsx` | 13/11 |
| `service.ts` (template-config) | 11/58 |
| `schema.ts` | 7/12 |
| `builder/page.tsx` | 4/1 |
| `0009_*.sql` (new) | 4/0 |
| `render.ts` | 2/1 |

The largest single driver is task 3.12's mandated retirement:
`TemplateConfigForm.tsx`+`.test.tsx` and `service.ts`+`.test.ts` alone
account for 86 insertions + 338 deletions = 424 of the 797 — almost all of
it deleting now-dead branding validation/rendering code and its extensive
pre-existing test coverage (7 tests asserting the 4 legacy fields' hex/URL/
length validation, none of which apply once those columns are gone). This
is not scope creep — every line traces to an explicit tasks.md 3.1–3.13
item, confirmed against design.md before writing any code, and the WU2
apply-progress already flagged that WU2's own actual size (361) ran ~30%
over its 250–300 estimate for the same reason (test-shape retrofit cost
under-counted at planning time).

Per the explicit instruction "If you cross ~450 and are not clearly
finishing, stop and report rather than pushing through — do not treat WU1's
accepted size exception as licence": all 15 code/test tasks are done and
independently verified (tests/tsc/lint/live-smoke all green), so the coding
work IS finished, but task 5.2 (GGA review, historically 5-8 rounds each
adding further hardening lines on WU1/WU2) and PR-opening were deliberately
NOT run. Continuing into a GGA loop on a diff already 60% over cap risked
compounding the overrun further before a human had a chance to decide
whether this is an acceptable `size:exception` (as WU1's was, at a much
smaller multiple) or whether Phase 3 should be split into two PRs (e.g.
"wire registry + logo data URI" vs. "retire legacy branding form +
migration 0009").

**Recommendation for the human/orchestrator decision:** the retirement work
(3.12) and its test rewrite is the cleanest place to split if a smaller PR
is required — it is largely independent of the registry-wiring work (3.1–
3.9) and could land as its own PR immediately after, still ahead of WU4.
Alternatively, accept `size:exception` (as WU1's larger overrun was
accepted) given the overrun is entirely deletion-driven code hygiene, not
added feature surface, and proceed straight to GGA + PR.

### Next

Awaiting a decision on how to proceed (accept as one oversized PR with
`size:exception`, or split 3.1–3.9 from 3.10–3.13) before running task 5.2's
GGA review and opening the PR against
`feature/catalog-templates-and-workshop-info`.

**Update (recorded during WU4 apply, not edited above to preserve the
original record):** this status is stale — `tasks.md` 5.2 confirms WU3's PR
did open, ran GGA (two rounds, six findings, fixed in `3a1416d`/`af5e8e8`),
and merged as PR #36 (`main` history: `af5e8e8` → `3a1416d` → `29bd362` →
merge commit `c4aec74`'s parent). GGA flagged this exact
apply-progress-vs-tasks.md disagreement during WU4's own review loop (round
1, finding #6) — noted here rather than silently rewritten, per this file's
own "not a session log" standard cutting both ways: the historical record
of what was true when WU3 stopped is itself useful, so it stays as written
above.

## WU4 — Three-Tier Pricing (Phase 4, tasks 4.1–4.16)

Status: **done.** Branch `catalog-tpl/wu4-three-tier-pricing`, cut from
tracker `feature/catalog-templates-and-workshop-info` (already containing
merged WU1, WU2, WU3). Base verified green before starting: `npm test`
740/740, `npx tsc --noEmit` clean, `npm run lint` 0 errors.

All 16 Phase 4 tasks complete — see `tasks.md` for per-task detail.

### What shipped

- `src/modules/catalog-builder/price-lists.ts` — new `resolveAllPrices`,
  wrapping the existing `resolvePrice` per tier (`ProductPrices` imported
  from `CatalogTemplate.tsx`, not redeclared — one canonical shape).
- `src/shared/template/CatalogTemplate.tsx` — `ProductPrices` type
  (design D4's own code block) exported here; `ProductPrintRef.price?:
  number | null` → `prices?: ProductPrices | null`.
- `src/shared/template/AdaptiveCards.tsx` (+ new `AdaptiveCards.test.tsx`)
  — `ProductPrice` (single value) replaced by one shared `ProductPrices`
  component; three labelled rows (`Venta`/`Taller`/`Socio`, a local
  constant, not imported from `catalog-builder`); em-dash rule `value ==
  null || value <= 0 → "—"`, re-guarded here even though `resolvePrice`
  already nulls a hostile `0.00` upstream. Both card variants
  (`TransparentProductCard`/`OpaqueProductCard`) proven identical via
  `describe.each`.
- `src/modules/pdf-generation/render.test.ts` — the "product prices"
  `describe` block (previously line 128) rewritten for the `prices` shape:
  all-present, one-missing, all-missing, zero-tier, and both card variants.
  `render.ts`/`chunkProducts` needed zero code changes (pure pass-through,
  confirmed by all 20 tests passing on fixture changes alone).
- `src/app/api/catalog-builder/generate/route.ts` — `isPrintProduct`
  rewritten: `isValidPrices` validates `prices.venta`/`taller`/`socio`
  individually via design D4's literal `isTier` guard (`v == null ||
  (typeof v === "number" && Number.isFinite(v))`) — non-object `prices`,
  array `prices`, and a `NaN`/`Infinity`/wrong-type single tier are each
  rejected on their own, never folded into one check.
- `src/modules/catalog-builder/CatalogBuilderForm.tsx` (+ new
  `CatalogBuilderForm.test.tsx` — no test file existed before this unit) —
  removed the `priceList` state and the "Lista de precios" `Select` card
  entirely; `reviewedProducts` now maps `prices: resolveAllPrices(priceLists)`
  instead of `price: resolvePrice(priceLists, priceList)`.
- `src/e2e/full-flow.e2e.test.ts` — three-tier fixtures including a real
  `0.00` tier (p2's socio price), plus the necessary pre-existing-bug fixes
  below to get the required live smoke to a genuine green.

### Deviations from tasks.md

**None on the assigned price-shape work itself** — `price` → `prices` was
not split (per the explicit instruction and design.md's own recommendation:
"do not split the `price`→`prices` rename"), `ProductPrices` was defined in
`CatalogTemplate.tsx` per design D4's own code block rather than in
`price-lists.ts`, and the tier labels are a local constant in
`AdaptiveCards.tsx` as task 4.5 specifies.

**Task 4.13/4.14 required three pre-existing, unrelated bugs to be fixed to
get a genuine green live smoke** (not scope creep — each one independently
blocked `npm run test:e2e` from passing at all, which 4.14 requires):

1. **Stale Interfuerza fixture shape.** The fixture predated `a828759`
   ("fix: correct inventory-sync mapper to match real Interfuerza 5-key
   wrapper contract") — a flat `{id, name, category_l1, price}` object threw
   `"Interfuerza product is missing a usable Producto.id"` in `parseProduct`
   on the very first live run, independent of any WU4 change. Rebuilt to the
   real `{Producto, InStock, PriceLists, Images}` wrapper (`Matrix` omitted
   deliberately — `parseProduct`/`warnMalformedWrapper` never read it; GGA
   round 1 flagged the fixture/comment mismatch, fixed in round 2's follow-up
   commit).
2. **Stale proxy 401 assertion.** `9b789e2` ("fix: redirect unauthenticated
   page visits to /login instead of raw 401 JSON") changed a page route's
   no-cookie behavior from 401 to a redirect, after this test was last
   touched. Rewrote the assertion to match the real, current contract (page
   route → redirect for both no-cookie and bad-cookie; API route → 401),
   rather than the stale one. **GGA round 2 called this out-of-scope** (see
   "GGA review" below for why it was kept).
3. **`regularUser` (tecnico) used for an admin-only action.**
   `policy.ts`'s `MATRIX.tecnico["catalogs.generate"]` has been `false`
   since the very first commit that introduced it (`edd86d7`) — the e2e test
   generating a catalog as `regularUser` has apparently never actually
   passed with a real policy check. Swapped to `adminUser` for the
   generate/poll/file-ownership steps; `otherUser` (still tecnico) stays the
   denied party for the R7 ownership check.

**Task 4.14's live smoke was also strengthened beyond "update fixtures"**:
the generate-step now resolves `prices: resolveAllPrices(p.priceLists)`
against the real Postgres row `listProductsInCategories`'s hand-built jsonb
SQL just returned, and asserts the real `0.00` socio tier collapses to
`null` — this is the actual point of a live smoke per `AGENTS.md` ("a green
unit suite proves zero coverage of the hand-built price SQL"); the original
e2e test never exercised price content at all (it POSTed the raw
`ProductRef[]` candidates directly, which never carried a `price`/`prices`
field either, before or after this change).

### Issues found, not acted on (recorded per AGENTS.md's scope discipline)

- **`isTier` accepts negative finite numbers** (design D4's own literal
  guard, copied verbatim: `v == null || (typeof v === "number" &&
  Number.isFinite(v))`). GGA round 4 suggested tightening to `v > 0` since a
  negative price is nonsense data, not a `TypeError` risk — a reasonable
  point, but it is a deviation from design D4's literal code block, not a
  bug in what was implemented. `formatTier`'s render-site `<= 0 → "—"` guard
  already prevents a negative value from ever printing. Recorded here rather
  than freelanced, per "ALWAYS follow the design decisions."
- **`getObject` is mocked in `full-flow.e2e.test.ts`** (pre-existing, WU3-era
  — the mock itself is untouched by this diff; only import lines shifted its
  line numbers, which is what GGA's round-4 diff view showed). This means
  WU3's `resolveBranding` data-URI path is not exercised by Chromium inside
  the one repeatable e2e run — only by WU3's own throwaway script, which was
  deleted. Not a WU4 defect or WU4-fixable without changing what R2 boundary
  this test mocks; recorded as a coverage gap for a future change to decide
  whether to close.
- **`specs/template-config/spec.md`'s R8.4 "MUST use the default… not error
  or crash"** contradicts `service.ts`'s write-path rejection of an unknown
  `selectedTemplateId`. Not new — WU2's apply-progress section already
  recorded this exact fallback-vs-reject question as GGA round-5 oscillation
  deliberately left unresolved (keeping the code, per that section's
  judgment call). GGA round 4 re-raised it against a spec file this WU never
  touched (confirmed via `git diff origin/feature/...:HEAD --stat`, empty).
  Left as WU2's recorded decision, not re-litigated a third time.

### GGA review (task 4.16) — 4 rounds, capped per the instruction

`PR_BASE_BRANCH` does not take effect in this repo/gga version (documented
defect) — every round reviewed `main...HEAD`, dragging in WU1–WU3's
already-committed-but-not-yet-`main`-merged code. Every finding was checked
against the actual base with `git diff origin/feature/catalog-templates-
and-workshop-info...HEAD -- <file>` before acting.

- **Round 1** — 3 blocking: (1) `portada.png` — verified via `git show
  origin/feature/...:portada.png` that it already existed on the tracker
  (added in WU3's `3a1416d`), not touched by this diff; left alone. (2)
  `full-flow.e2e.test.ts`'s `templateConfigPOST` body still posted the four
  legacy branding fields WU3's migration `0009` dropped — parsed to `{}`,
  returned 200 while configuring nothing. This one WAS fixed (real bug,
  directly blocking a meaningful 4.14 result) — posts
  `{selectedTemplateId, defaultImageHandling}` now and asserts on the saved
  value. (3) `registry-types.ts` docstring contradicting the actual gallery
  swatch rendering — verified pre-existing (WU2), untouched by this diff;
  left alone.
- **Round 2** — 1 blocking, real and mine: the WU4-added fixture comment
  claimed a 5-key wrapper (`...Matrix`) but the fixture built 4 keys.
  Fixed the comment to explain the omission instead of contradicting the
  code next to it (`Matrix` is passthrough `parseProduct` never reads).
- **Round 3** — re-raised `portada.png` (left alone, same verification);
  called the `proxy` 401→redirect fix "scope creep" distinct from the
  branding-body and `adminUser` fixes. Disagree and kept the fix: all three
  equally block a green `npm run test:e2e` run, which 4.14 requires — the
  proxy test's topic (auth redirect) being unrelated to pricing doesn't
  change that it's in the same required file and equally blocking. Also
  flagged a real, cheap issue in the new `CatalogBuilderForm.test.tsx` (two
  buttons sharing the label "Empezar a generar" across steps) — fixed with
  a clarifying comment rather than restructuring (they are mutually
  exclusive by `step`, and RTL's `getByRole` already throws on a genuine
  multi-match).
- **Round 4** — re-raised `portada.png` a third time, this time claiming
  the earlier "pre-existing" verification was itself wrong because `git
  diff` against `main` shows `new file mode`. That diff is `main...HEAD`,
  not `tracker...HEAD` — re-verified decisively:
  `git diff origin/feature/catalog-templates-and-workshop-info...HEAD -- portada.png`
  is empty, and `git merge-base --is-ancestor 3a1416d HEAD` confirms the
  commit that added it is an ancestor of this branch. This is the exact
  `PR_BASE_BRANCH` defect scenario the WU4 instructions warned about — GGA
  cannot see the tracker, only `main`. Left alone, documented here instead
  of re-litigated a fifth time. Raised the `isTier`/negative-number and
  `getObject`-mock/spec-contradiction points recorded above.

**Stopped after round 4** (within the 3–5 round cap): every finding that
was actually introduced by this diff was fixed; every repeated finding
against pre-existing, unrelated files was independently verified with `git
diff`/`git show` against the real base and left alone, consistent with the
explicit instruction not to fix what this WU did not write.

### Verification

- `npm test` — 759/759 passing (full suite). Base was genuinely 740/740 as
  the task brief said — confirmed via a scratch `git worktree` checked out
  at `origin/feature/catalog-templates-and-workshop-info` with its own
  `npm install`. All +19 net new tests trace to this WU's own RED work
  (price-lists, `AdaptiveCards`, the trust-boundary block, `render.test.ts`,
  `CatalogBuilderForm.test.tsx`), not a stale baseline.
- `npx tsc --noEmit` — clean throughout every round.
- `npm run lint` — 0 errors, 15 pre-existing warnings (2 fewer than WU3's
  16 — the removed `priceList`/`Select` code path in `CatalogBuilderForm.tsx`
  happened to drop two of the warnings; none introduced by WU4).
- Task 4.14, live smoke (required): ran `full-flow.e2e.test.ts` (5/5
  passing) against a disposable Postgres
  (`docker run ... -p 55432:5432 postgres:17-alpine`, per README) + real
  Playwright Chromium (already installed from WU3's smoke). Confirmed: the
  hand-built `priceLists` jsonb SQL in `queries.ts` round-trips correctly
  through real Postgres (`p2`'s real `"0.00"` socio tier resolved to `null`
  via `resolveAllPrices` against the actual returned row, asserted
  explicitly); the full real pg-boss + Chromium PDF pipeline still reaches
  `uploadStatus: "uploaded"` and serves a real `%PDF`-prefixed buffer;
  ownership (404, not 403) still holds for a non-owning user. Disposable
  container removed after each run.
- Task 4.15, live smoke: rendered one real 10-product PDF via
  `renderPdfBuffer` (throwaway `scripts/wu4-live-smoke.mts`, `npx tsx`,
  deleted after the run — not part of the PR) with intentionally long
  product names and a mix of hostile `0` tiers, `productsPerPage: 10`.
  Visually inspected the output (3 physical PDF pages): confirmed design's
  New Risk #4 — the taller three-row price table pushed the single logical
  `productsPerPage: 10` section across **2 physical PDF pages** (6 cards on
  page 2, 4 on page 3) instead of the 1 page it would have fit at the old
  single-price-row height. No card was cut in half (`break-inside: avoid`
  held — the browser broke cleanly between card rows), so this is a page-
  budget/print-cost planning risk, not a rendering-corruption one. Every
  price row rendered correctly: three tiers bold, hostile `0` tiers as
  `—`, never `$0.00`. Not fixed in this WU (task 4.15 is a smoke/verify
  task, not a remediation task; `chunkProducts` measuring real height
  instead of a fixed count is design's own noted gap, not assigned here).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 4.1/4.2 `resolveAllPrices` | 3 new tests failed (`resolveAllPrices is not a function`) | Added function + `ProductPrices` type import; 17/17 pass | — |
| 4.3 `ProductPrintRef.prices` | N/A (type-only change) | `npx tsc --noEmit` isolated the 2 real call sites needing updates | — |
| 4.4/4.5 `AdaptiveCards` money rendering | New `AdaptiveCards.test.tsx`, 8/8 failed (`ProductPrices` component did not exist) | Rewrote `AdaptiveCards.tsx`; 8/8 pass | — |
| 4.6/4.7 `render.test.ts` prices | Rewrote the block against the new shape first | Confirmed `render.ts` needed zero changes — 20/20 pass on fixtures alone | — |
| 4.8/4.9 `isPrintProduct` trust boundary | 9 new tests, 5 failed (NaN/Infinity/wrong-type tiers wrongly accepted) | `isValidPrices` + `isTier`; 25/25 pass | — |
| 4.11/4.12 `CatalogBuilderForm` review step | New `CatalogBuilderForm.test.tsx`, both tests failed (`Lista de precios` still rendered; `prices` was `undefined`) | Removed selector, wired `resolveAllPrices`; 2/2 pass | Round-3 GGA comment clarifying the shared-label query |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and result | `npx vitest run src/modules/catalog-builder/price-lists.test.ts src/shared/template/AdaptiveCards.test.tsx src/app/api/catalog-builder/generate/route.test.ts src/modules/catalog-builder/CatalogBuilderForm.test.tsx src/modules/pdf-generation/render.test.ts` — all pass (94 tests across 5 files) |
| Runtime harness command/result | `DATABASE_URL=postgres://dforce:dforce@localhost:55432/dforce_catalog npm run test:e2e` against a disposable `postgres:17-alpine` container — 5/5 passing, real Chromium PDF produced |
| Rollback boundary | Independent commit chain (`2e317f4` → `0af4677` → `d69e7be` → `54c57e2`) on top of merged WU1–WU3; revert restores the scalar `price` field end to end (renderer, builder, API) with no partial-rename state at any point |

### Changed lines

`git diff origin/feature/catalog-templates-and-workshop-info...HEAD --numstat -- src openspec`:
494 insertions + 124 deletions = **618** total (586 excluding `tasks.md`'s
32-line checkbox/note churn). Against the 700-line ledger cap — comfortably
under; against the ~400-line original estimate — over, driven almost
entirely by two brand-new test files Strict TDD required
(`AdaptiveCards.test.tsx` 62 lines, `CatalogBuilderForm.test.tsx` 102
lines — 164 of the 618 total) plus the required e2e fixture repair (86/14)
that predates this WU but blocked its required live smoke.

### Next

WU4 is the last work unit (`tasks.md`'s Suggested Work Units: WU1→WU2→WU3→
WU4). PR targets `feature/catalog-templates-and-workshop-info` (the
tracker), not `main`. Cross-cutting task 5.1 (confirm the `template-config`
delta spec is what `sdd-verify` checks against) is unassigned to this WU and
left for the tracker-level close-out.

## Phase 5 — WU5: Workshop Contact Block + Cover Image

Added after `sdd-verify` failed the change on a CRITICAL finding (spec's ADDED
"Workshop Contact Block on Cover" requirement was never implemented — see
design D6). Branch `catalog-tpl/wu5-contact-block-cover`, cut from the merged
tracker (WU1–WU4). Implemented all 13 code/test tasks (6.1–6.14); stopped
before 6.15 (GGA) and opening the PR — see "Budget stop" below.

### What was built

- Migration `0010_workshop_cover_image.sql` (additive only): `workshop_config`
  gains `coverImageR2Key`/`coverImageContentType`. Generated via
  `drizzle-kit generate`, applied to the real dev Postgres (5433) and
  confirmed recorded in `drizzle.__drizzle_migrations` (per the hard
  constraint about the past session that lost hours to the wrong table).
- `service.ts`/`service.test.ts` — the two new fields follow the exact same
  `"field" in parsed` partial-touch discipline as every other column.
- `api/workshop-config/cover-image/route.ts` (new) — mirrors `logo/route.ts`
  exactly (GET/POST/DELETE, same admin gating, same `MAX_UPLOAD_BYTES`
  pre-buffer check, same "don't resend name" partial-touch discipline). A new
  `ROUTE_GUARDS` entry was required in `route-guards.test.ts` (a pre-existing
  completeness test caught the missing registration immediately).
- `LogoUploadField.tsx` parametrized (`label`/`endpoint`/`helpText`, all with
  defaults matching the pre-WU5 logo behaviour) and reused for the cover-image
  field in `WorkshopConfigForm.tsx`, instead of a near-duplicate second
  component.
- `CatalogTemplate.tsx` — added `WorkshopContact` type; `CatalogTemplateBranding`
  gained `contact` and `coverImageUrl` (both optional, see deviation below).
  New cover markup (hero photo w/ multiply blend, black wedge via `clip-path`,
  red diagonal accent, logo placard, brand name, claim), translated from
  `Insumos/Templates/Portada_DForce_v1.html`. New contact page (icon-circle
  rows per set field, social-handle pills iterating `socialHandles` entries
  generically), translated from `Template_Catalogo.op`'s page "3 · Contacto y
  redes" — placed LAST in the document, matching that file's own page order
  (`0 · Portada, 1 · Índice, 2 · Productos, 3 · Contacto y redes`, confirmed
  by reading the `.op` file's page names rather than assumed).
- `enqueue.ts`'s `PdfBranding` gained `coverImageR2Key`/`coverImageContentType`/
  `contact` (optional, same reasoning). `worker.ts`'s `resolveBranding()`
  extended via a small shared `resolveImageDataUri()` helper (used for both
  logo and cover image); `contact` passes through verbatim — no R2 read, it is
  plain text (worker stays a pure function of its payload).
- `generate/route.ts` assembles `contact`/cover-image fields from
  `getWorkshopConfig()`. `CatalogBuilderForm.tsx`'s live preview builds the
  identical branding shape (Risk-5). Both call the new
  `src/modules/workshop-config/contact.ts`'s `buildWorkshopContact()` — one
  shared `WorkshopConfig` → `WorkshopContact` mapping instead of two that
  could drift.

### Deviations from the literal task text

1. **`CatalogTemplateBranding.coverImageUrl` is new, not in design D6's own
   code block.** D6 lists only `contact` on `CatalogTemplateBranding`, but the
   renderer cannot show the cover photo without carrying its resolved URL —
   same http-path(preview)/data-URI(worker) split `logoUrl` already uses. This
   was an omission in D6 itself (the same class of gap that caused this WU to
   exist), not a re-interpretation of it.
2. **`coverImageUrl`/`contact` are optional (`?:`) on both `CatalogTemplateBranding`
   and `PdfBranding`**, not the design's literal required fields. Making them
   optional kept every pre-WU5 branding/`PdfBranding` object literal in
   `render.test.ts`/`worker.test.ts` (pricing, image-handling, font-resolution
   tests — none of them about the contact block) compiling unchanged instead
   of needing a mechanical edit across files unrelated to this WU's actual
   work. The real call sites (`generate/route.ts`, `worker.ts`'s
   `resolveBranding`, `CatalogBuilderForm.tsx`) always populate both fields.
3. **`LogoUploadField.tsx` was generalized instead of adding a second
   component** for task 6.6. Same upload/preview/delete logic either way; one
   file instead of ~90 duplicated lines, with defaults preserving the pre-WU5
   logo behaviour exactly (no test needed updating).
4. **`buildWorkshopContact()` (new file) instead of inlining the mapping
   twice.** `generate/route.ts` (server) and `CatalogBuilderForm.tsx` (client
   preview, `"use client"`) both need the identical `WorkshopConfig` →
   `WorkshopContact` mapping — Risk-5 means they must never drift. The helper
   is typed structurally (no `@/shared/db` import), matching `limits.ts`'s
   established "safe for a use-client import" convention.

### Bug found and fixed during the live smoke

The cover section's container background was `black` (matching the fallback
red/black block), with the hero photo layered on top using
`mix-blend-mode: multiply` (copied from `Portada_DForce_v1.html`, whose own
comment says this "melts the photo's white background into the page"). That
trick only works against a **white** page — multiplying any colour with black
is always black, so the uploaded photo was completely invisible in the first
smoke render. Fixed by making the container background white only when a
cover photo is actually set; the black/red fallback (hard constraint #4) is
unchanged when it is not. Re-ran the smoke after the fix and confirmed the
photo renders correctly (see below). Caught by literally looking at the
rendered PDF — the unit tests (which only assert the `<img>` element and its
`src` are present, correctly, per task 6.8) could not have caught a blend-mode
visibility bug; this is exactly why the live smoke is a required, not
optional, step.

### Live smoke (task 6.14, required — both states)

Ran a throwaway `src/e2e/wu5-smoke.e2e.test.ts` (`vitest.e2e.config.ts`,
`node --env-file=.env`) against the real dev Postgres (already migrated
through `0010`), the real R2 bucket, and a real Playwright Chromium render via
`renderPdfBuffer` directly. The pre-existing dev `workshop_config` row (real
hand-entered data from earlier sessions: name "DForce Car Audio" + a real
logo) was snapshotted in `beforeAll` and restored exactly in `afterAll` — this
script must not leave the dev DB mutated. Script and both generated PDFs
deleted after the run, not part of the PR.

- **State 1 (every field set + 2 social handles + a real cover image).** Used
  `Insumos/Templates/DFORCE CAR AUDIO.png` as the logo and the repo's existing
  `portada.png` as the cover photo (both real, already-present image assets —
  not synthesized). Rendered PDF, page 1 (cover): the car photo renders
  correctly behind the black wedge and red diagonal accent, logo placard
  top-left, "Dforce Car Audio" brand name and the cover-text claim bottom-left,
  "Catálogo: Audio" title bottom-right — matches
  `Portada_DForce_v1.html`'s layout. Page 3 (contact, last page, after the one
  product page): logo + brand name centered, all six rows present (TELÉFONO,
  WHATSAPP, CORREO, DIRECCIÓN, HORARIO, SITIO WEB) each with a red icon circle
  and the correct value, "SEGUINOS EN REDES" heading with two pills
  (`instagram: @dforcecaraudio`, `facebook: @dforcecaraudio`) — matches
  `Template_Catalogo.op` page "3 · Contacto y redes"'s layout. (Note: the
  `portada.png` fixture itself has a pre-existing grey rectangle baked into
  its right edge from an earlier, unrelated dev session — visible in the
  rendered cover but not a defect in this WU's rendering code, confirmed by
  inspecting the source PNG directly.)
- **State 2 (half the fields unset, cover image removed).** Cleared
  `whatsapp`/`address`/`website`/`socialHandles`/`coverImageR2Key`/
  `coverImageContentType`, re-rendered. Cover: degraded cleanly to the plain
  red/black block (no `<img>`, no empty gap, no broken image). Contact page:
  only TELÉFONO, CORREO, and HORARIO rows remain — WHATSAPP, DIRECCIÓN, SITIO
  WEB, and the entire "SEGUINOS EN REDES" section are omitted outright, no
  empty labels or empty rows left behind.

Both states confirmed the spec's "omitted, never an empty label" requirement
and hard constraint #4's cover-image fallback, visually, not just via unit
assertions.

### Budget stop

`git diff --cached --stat FETCH_HEAD -- . ':!src/shared/db/migrations/meta/0010_snapshot.json'`
(FETCH_HEAD = `origin/feature/catalog-templates-and-workshop-info`, excluding
the auto-generated migration snapshot per the same convention WU3 used):
**920 insertions + 34 deletions = 954** real changed lines — well past the
700-line ledger cap. New code breaks down roughly as: `CatalogTemplate.tsx`
+172 (cover/contact markup + types), `cover-image/route.test.ts` +173 (new,
mirrors `logo/route.test.ts`), `cover-image/route.ts` +100 (new, mirrors
`logo/route.ts`), `render.test.ts` +110, `worker.test.ts` +77,
`generate/route.test.ts` +61, `LogoUploadField.tsx` +48 (net, parametrization),
`worker.ts` +34, `contact.ts` +35 (new), `service.test.ts` +40,
`WorkshopConfigForm.test.tsx` +30, `service.ts` +17, `enqueue.ts` +14,
`schema.ts` +9, `generate/route.ts`/`CatalogBuilderForm.tsx`/
`route-guards.test.ts` small additions each. The overrun is driven by
mirroring an entire second upload route (route + test, ~273 lines) plus
substantial new render markup and its tests — not scope creep beyond the
assigned 6.1–6.14 task list.

Per the explicit instruction not to self-grant a size exception (same
discipline WU3 followed at 797/500 lines), the apply agent left task 6.15's
GGA review and the PR unrun. All 13 code/test tasks (6.1–6.14) were done and
verified at that point: `npm test` 789/789, `npx tsc --noEmit` clean,
`npm run lint` 0 errors, both required live-smoke states passed and are
documented above.

**Resolved after that stop.** The owner accepted the size exception. The
orchestrator ran GGA (**PASSED**, three non-blocking flags), corrected the
`catalog-generation` spec requirement from "on Cover" to a dedicated contact
page, and — while writing the new scenario that correction called for — found
and fixed a real bug in `aa5da24`: `buildWorkshopContact()` returns an
object-of-nulls rather than `null` for the guaranteed singleton row, so a
workshop with no contact info got a blank black page appended to every
catalog. Final state: 790/790 tests, tsc clean, **lint 0 errors / 17
warnings** (WU5 adds 2 to WU4's 15, both the same `<img>`-element pattern
already present in this file — an earlier note in this section said +1, which
undercounted). Merged in PR #38.

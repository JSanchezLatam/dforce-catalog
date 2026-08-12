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
real migrated schema). No WU1 caller is affected — `WorkshopConfigForm`
already null-coalesces every field. WU3's `generate/route.ts` must not
assume `getWorkshopConfig() === null` means "nothing configured"; check
individual fields instead.

### Verification

- `npm test` — 711/711 passing (full suite, not just this module).
- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors, 17 pre-existing warnings (none introduced by
  this change).
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

### Next

WU2 (template registry + gallery picker) can start once this PR merges to
the tracker branch — it depends on `template_config.selected_template_id`
existing, which is now in place.

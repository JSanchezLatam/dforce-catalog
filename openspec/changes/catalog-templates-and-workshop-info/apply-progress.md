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

### Verification

- `npm test` — 685/685 passing (full suite, not just this module).
- `npx tsc --noEmit` — clean.
- Live smoke (task 1.10): ran `npm run db:migrate` against the real dev
  Postgres (`postgres://dforce:dforce@localhost:5433/dforce_catalog`).
  Confirmed via `psql`:
  - `workshop_config.cover_text` was hand-copied from `template_config`'s
    existing row ("Para mas informacion escribenos al 6666 6666").
  - Every other new `workshop_config` column defaulted to `NULL`.
  - `template_config.selected_template_id` defaulted to `NULL`; the four
    legacy branding columns stayed `NOT NULL` and unchanged.

### Next

WU2 (template registry + gallery picker) can start once this PR merges to
the tracker branch — it depends on `template_config.selected_template_id`
existing, which is now in place.

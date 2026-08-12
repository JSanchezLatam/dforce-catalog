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

### Verification

- `npm test` — 719/719 passing (full suite, not just this module).
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

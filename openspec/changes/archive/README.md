# Archived changes

Every change in this folder is complete and merged to `main`. Nothing here is
active work. New changes go in `openspec/changes/<name>/`, not here.

| Change | Tasks | Landed |
|--------|-------|--------|
| `crm-workshop-management` | 41/41 | customers, service orders, reminders |
| `adaptive-catalog-layouts` | 19/19 | image classification, adaptive cards, review step |
| `crm-shell-settings-rbac` | 46/46 v1 | grouped nav, workshop settings, role matrix |
| `user-lifecycle-management` | 40/40 | deactivation, forced password change, admin user management |

Archived 2026-08-11, in that chronological order — it is the order their delta
specs must be applied in.

`crm-shell-settings-rbac` also carries eight unchecked boxes under "Deferred to
follow-up change". Those are a deferral register, not open work: all four units
shipped as `user-lifecycle-management`. See the note there.

## Where the current spec actually lives

There is no `openspec/specs/` baseline in this repo, and these deltas do not
add up to one on their own. Reading the current contract means reading two
places:

1. **`.kiro/specs/dforce-catalog/requirements.md`** — the original baseline
   (Requisitos 1-12, Spanish). This is what the deltas' `R5`/`R6`/`R8`
   references point at. It carries its own errata: R1 and R3's original text
   describes the Interfuerza API as `GET /products`, which is wrong — see the
   correction notes inline, and `interfuerza-api-contract-fix`.
2. **The `specs/` folder of each change here**, applied in the table's order.

## Known merge debt

Consolidating the above into one `openspec/specs/<capability>/spec.md` tree was
NOT done as part of this archival, deliberately. It is not a mechanical merge:
the baseline is a 242-line Spanish document organized by numbered requirement,
while the 13 deltas are English and organized by capability. Producing one tree
means choosing a language for the consolidated spec and re-cutting the baseline
along capability lines — both are judgment calls, and a half-correct baseline is
worse than this pointer, because the next change would plan against it and
believe it.

**Policy**: consolidate a capability the first time a change touches it (see
`catalog-templates-and-workshop-info` below for the first application of this
policy). Once consolidated, `openspec/specs/<capability>/spec.md` is the FULL
current state and no longer needs the two-source read.

### Consolidated capabilities

- `catalog-generation` — consolidated 2026-08-12 by `catalog-templates-and-workshop-info`.
  Built from: `.kiro` R5/R6 → `adaptive-catalog-layouts` →
  `crm-shell-settings-rbac` → `catalog-templates-and-workshop-info`. See
  `openspec/specs/catalog-generation/spec.md`.
- `template-config` — consolidated 2026-08-12 by `catalog-templates-and-workshop-info`.
  Built from: `.kiro` R8 → `adaptive-catalog-layouts` →
  `catalog-templates-and-workshop-info` (supersedes R8.1). See
  `openspec/specs/template-config/spec.md`.

### Still two-source (unconsolidated)

Eight capabilities still require reading BOTH `.kiro/specs/dforce-catalog/requirements.md`
AND the relevant change(s) below, applied in order where more than one
contributes:

- `customer-management` — crm-workshop-management, then crm-shell-settings-rbac
- `service-orders` — crm-workshop-management, then crm-shell-settings-rbac
- `app-navigation`, `role-permissions`, `user-account`, `user-management`,
  `workshop-reminders`, `workshop-settings` — single-source (see the table
  above for which change)

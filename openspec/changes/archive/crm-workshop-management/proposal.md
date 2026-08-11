# Proposal: crm-workshop-management

## Intent
The workshop has no way to track WHO its customers are, WHAT vehicles they own, or WHAT work was done on them. Staff manage repairs ad-hoc, with no service history and no follow-up. This change adds a native customer/CRM layer, work-order tracking, and automated reminders — turning the catalog app into a workshop operations tool. Success = staff can register a customer, open a service order referencing parts (`producto`), and have the system send service-due/appointment reminders automatically.

## Flagged Assumptions (confirm or override BEFORE implementation)
1. **auto-crm: NOT integrated.** Build a native `cliente`/CRM module inside the existing Postgres/Drizzle schema. Borrow UX ideas (contact list/detail) only. Do NOT port SQLite, lead-scoring, or sales-pipeline logic. *Rationale: DB-engine fork (SQLite vs Postgres) makes real integration costly; workshop needs records, not a sales funnel.*
2. **Providers:** WhatsApp = **Kapso** (`integrate-whatsapp` skill installed); Email = **Resend** (`resend-cli` skill installed). *Both confirmed in `.atl/skill-registry.md`; lowest-friction start.*

## Lower-Stakes Defaults (proposed, overridable)
3. **`cliente` scope:** name, phone, email, plus embedded vehicle info (make/model/year/plate). One vehicle per customer inline for v1; multi-vehicle deferred.
4. **Sequencing:** `cliente` first → `orden_servicio` (depends on cliente + producto) → reminders (depends on orden_servicio). Reminders ship last.
5. **Order states:** `open → in_progress → done → cancelled`.

## Scope

### In Scope
- New `cliente` table + CRUD/list/detail UI (shadcn Table, Card, Dialog, Pagination)
- New `orden_servicio` table referencing `cliente` + `producto` (parts used), with status lifecycle
- Service history view per customer (their orders)
- Reminders scheduled via pg-boss (`sendAfter`), delivered via Resend (email) + Kapso (WhatsApp)
- Reminder types: service-due, appointment (tied to `orden_servicio`)

### Out of Scope
- Absorbing/migrating the auto-crm repo or its SQLite codebase
- Lead scoring, Kanban, sales pipeline, AI features from auto-crm
- Multi-vehicle-per-customer, invoicing/payments, inventory deduction on parts use
- SMS channel; provider abstraction layer (direct Kapso/Resend calls for v1)
- Customer-facing portal or authentication (staff-only, reuses existing session auth)

## Capabilities

### New Capabilities
- `customer-management`: `cliente` entity, CRUD, list/detail UI, service history
- `service-orders`: `orden_servicio` entity, status lifecycle, parts + customer linkage
- `workshop-reminders`: pg-boss-scheduled email/WhatsApp reminders

### Modified Capabilities
- None (additive; no existing spec-level behavior changes)

## Approach
1. Add `cliente` + `orden_servicio` tables to `schema.ts`, same conventions as `catalogs`/`producto` (JSONB where flexible, typed columns for query fields).
2. Build customer module (queries + service + UI) mirroring `catalog-builder`/`inventory` module layout.
3. Build service-order module referencing both tables; status transitions server-validated.
4. Add reminder scheduling on the existing pg-boss singleton (`sendAfter`); new worker sends via Resend + Kapso wrappers.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| shared/db/schema.ts | Modified | +`cliente`, +`orden_servicio` tables, order status enum |
| modules/customers/* | New | queries, service, list/detail UI |
| modules/service-orders/* | New | queries, service, order UI + status transitions |
| modules/reminders/* | New | pg-boss scheduling + Resend/Kapso send workers |
| shared/jobs/boss.ts | Modified | Register reminder job/queue |
| app/(app)/customers, app/(app)/service-orders | New | Routes/pages |
| app-sidebar.tsx | Modified | Nav entries for Customers + Service Orders |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Provider assumptions wrong (Kapso/Resend) | Medium | Flagged for confirmation; direct-call design keeps swap cheap |
| pg-boss scheduled-send semantics differ from expectation | Medium | Validate `sendAfter` in design phase before building reminders |
| Scope creep toward full CRM/pipeline | Medium | Explicit out-of-scope; v1 = records + orders + reminders only |
| cliente/vehicle model too thin for real use | Low | Single-vehicle inline v1; multi-vehicle deferred, not blocked |

## Rollback Plan
- Revert schema migration (drizzle-kit) — additive tables, drop `cliente`/`orden_servicio`
- Remove new modules/routes/nav entries (isolated, no changes to catalog flow)
- Unregister reminder queue from pg-boss; no impact on existing PDF jobs

## Dependencies
- Kapso account + credentials (WhatsApp) — pending user confirmation
- Resend account + API key + verified sending domain (email) — pending user confirmation
- Existing pg-boss/Postgres infra (already present)

## Success Criteria
- [ ] Staff can create/edit/list/view a `cliente` with vehicle info
- [ ] Staff can open an `orden_servicio` linking a customer + parts, and move it through states
- [ ] Customer detail shows their service-order history
- [ ] A scheduled reminder fires via pg-boss and sends through email + WhatsApp
- [ ] All existing tests pass unchanged (additive change)

# Archive Report: vehicle-details-and-renewals

**Archived:** 2026-10-04  
**Status:** Complete and merged to main  
**Base commit:** bf86655 (all 7 PRs merged)

## Change Summary

Shipped vehicle descriptive fields (chasis, colors, estilo, motor, unit number), internal plate renewal and insurance expiry tracking, and a "Vencimientos próximos" workflow to contact customers when plates or insurance are due.

### Merged PRs

- PR #151: Schema, validation, vehicle detail, public mapper (1a fields/gate)
- PR #152: Order detail and print sheet (1b form)
- PR #153: Order detail and print with 4-column header
- PR #154: Due rules and migration 0022
- PR #155: Service/route/e2e for due module
- PR #156: Page and sidebar badge
- PR #157: Contact dialog, badge degrade, GGA fixes (44x44 close, price focus ring, complete fixture, insurance wording)

## Verification Status

**Mode:** Strict TDD, hybrid  
**npm test:** 2028/2028 passed  
**tsc --noEmit:** clean  
**Lint:** 0 errors, 14 warnings (pre-existing)  
**verify-report:** pass_with_warnings, 0 critical

Browser verification (2026-10-04, LAN IP):
- Tecnico RSC payload carries no internal fields ✓
- Unchanged saves preserve DB values for both roles ✓
- Print preview keeps 900 chars of Hallazgos; signature on page 1 ✓
- Vencimientos list/badge 6→5, collapsed dot, phone cards, tecnico refused with no nav item ✓
- Dialog wa.me carries 50766518556; opt-out disabled with reason; close button 44x44; console clean ✓

## Spec Consolidation

### New Capability
- `openspec/specs/vehicle-renewals/spec.md` created with 8 requirements

### Modified Capabilities
- `openspec/specs/customer-management/spec.md`: Added 3 requirements (Vehicle Descriptive Fields, Internal Fields Preservation, Vehicles GET Route Public Shape); modified existing requirement Vehicle Detail Screen with Service History
- `openspec/specs/service-orders/spec.md`: Modified 2 requirements (Service Order Detail, Printable Work Order) to include new vehicle fields and internal-field exclusion

## Artifacts Archived

- `proposal.md`: Intent, scope, approach, affected areas, risks, dependencies
- `design.md`: Architecture, open questions, decisions
- `specs/`: All delta specs merged into main specs
- `tasks.md`: 37 ticked, 2 archive-phase notes (6.1, 6.2); follow-ups recorded for future cycles

## Known Follow-ups

Per tasks 6.2, not in scope for this change:

1. **Contact mark race condition:** `markContactado` route lacks transaction isolation; concurrent calls can yield 500 instead of 404 when duplicate key error occurs on `ON CONFLICT DO NOTHING`
2. **Email sending:** "Correo" button remains disabled placeholder; full implementation requires WhatsApp/email provider integration
3. **listContacts full scan:** Current implementation scans entire `cliente` table without index; compound index on (deactivated_at, created_at) would optimize
4. **Workshop config access unguarded:** Renewals page reads `getWorkshopConfig` directly; no permission gate
5. **CustomerPicker create mode:** "Uso interno" visibility not controlled in create flow; form shows internal fields to unauthorized users during vehicle creation

## Dependencies

- Migrations 0021 (vehicle columns) and 0022 (vehiculo_contacto) deployed via `scripts/windows/standalone.ps1` to workshop
- `src/modules/reminders/providers/whatsapp.ts` (toE164 conversion) unchanged but used by contact dialog
- `src/modules/workshop-config/service.ts` (getWorkshopConfig) unchanged but used by message builder

## Rollback Plan

Revert in reverse PR order (157→151):
- PR #157, #156, #155, #154 (drop cleanly; table holds only contact marks)
- PR #153, #152, #151 (migration 0021 is additive; down migration drops columns, losing only data entered since merge)

## Notes

- GGA fixed two pre-existing warnings in PR #157: 44x44 close button and price input focus ring alignment
- Owner approved mockup and "Contactar" dialog copy 2026-10-04
- Owner accepted size exceptions for PR 1a (1b also split per GGA); WU3 split into 3a/3b per review workload forecast
- No changes to `src/modules/reminders/providers/whatsapp.ts` or `src/modules/workshop-config/service.ts`; both reused as-is

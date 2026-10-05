# Archive Report: service-order-reception

**Archived:** 2026-10-05  
**Status:** Complete and merged to main  
**Base commit:** 0ba9284 (all 7 PRs merged to main)

## Change Summary

Shipped customer identity documents (Cédula / RUC), vehicle intake recording (mileage, fuel, battery), automatic navigation to order detail after creation, reception photo storage and management, and printable work orders with customer intake details, QR slot, and paginated photos.

### Merged PRs

- PR #159: Schema, validation, form, detail display for Cédula / RUC (migration 0023)
- PR #160: Intake fields (km, fuel, battery), motor-aware form, detail display, navigate after create (migration 0024)
- PR #161: Photo table, R2 storage with checksum validation, edit policy, service layer with FOR UPDATE concurrency (migration 0025)
- PR #162: Photo upload route (POST), GET and DELETE routes with checksum headers and auth gates
- PR #163: Photo compression, OrderPhotos uploader card with sequential upload and counted success toast, mobile detail layout fix
- PR #164: Mobile sidebar trigger (disjoint defect fix)
- PR #165: Print page with Cédula/RUC, intake rows, QR slot, paginated photos (4/sheet from page 2), decode wait, 60s upload abort

## Verification Status

**Mode:** Strict TDD, hybrid  
**npm test:** 2236/2236 passed  
**tsc --noEmit:** clean  
**Lint:** 0 errors, 14 warnings (pre-existing)  
**verify-report:** pass_with_warnings, warnings 1–3 corrected in later commits  
**Delivery strategy:** ask-on-risk; owner accepted size exceptions for every PR over 400 lines

Browser verification (2026-10-05, LAN IP):
- Customer form Cédula/RUC field RSC boundary, console clean ✓
- Intake inputs follow motor (combustion/electrico/hibrido/unset) ✓
- Navigation to order detail lands on correct page ✓
- Photo compression runs without secure-context errors on HTTP ✓
- Print preview: photos 4/page from page 2, signature on page 1, light sheet in dark theme ✓
- Bulk actions not blocked by locked rows during photo operations ✓

## Spec Consolidation

### Modified Capabilities
- `openspec/specs/customer-management/spec.md`: R17 (Field Validation) MODIFIED to add `documento_identidad` clause with trimming, 30-char cap, no format/uniqueness checks, and import preservation rules
- `openspec/specs/service-orders/spec.md`: 
  - ADDED: Vehicle Intake Fields (km/fuel/battery, motor-aware display)
  - ADDED: Navigate to Order Detail After Creation
  - ADDED: Reception Photos (12-photo limit, JPEG validation, position ordering, R2 storage, status/role gates, authenticated serving, retention sparing)
  - MODIFIED: Service Order Detail Displays Vehicle, Category, and Notes (added intake fields display with Spanish formatting)
  - MODIFIED: Printable Work Order (added Cédula/RUC, intake rows, 25mm QR slot, photos 4/sheet from page 2, light-theme forcing, Letter target)

**Merge verification:** no duplicate requirement titles; no remaining delta headers (## ADDED/MODIFIED/REMOVED)

## Artifacts Archived

- `proposal.md`: Intent, scope, approach, affected areas, risks, dependencies
- `design.md`: Architecture, open questions, decisions, R2 integration pattern
- `specs/`: All delta specs merged into main specs per archive discipline
- `tasks.md`: All 5 work units complete (37 ticked tasks), archive-phase notes 6.1 and 6.2 complete; follow-ups recorded for future cycles
- `verify-report.md`: Final verification pass with corrections applied in commit history

## Known Follow-ups

Per tasks 6.2, not in scope for this change:

1. **QR code integration:** Slot reserved (25mm blank square), awaiting external QR service/provider hookup
2. **Customer portal (step 4):** RDD/scheduling portal accessible via customer link requires separate workflow design
3. **Técnico and Jefe Taller fields (step 3):** Technician assignment and workshop manager role setup
4. **Orphan R2 sweeper:** Background job to clean unreferenced R2 objects outside service-orders prefix
5. **Photo annotation:** Ability to label/caption photos per reception workflow
6. **Cédula/RUC import:** Bulk load of identity documents during customer data synchronization

## Implementation Decisions

- **R2 checksum validation:** WHEN_REQUIRED mode enforces integrity on cloud storage round-trip without blocking legacy clients
- **Photo concurrency:** FOR UPDATE on ordem_servicio during insert guarantees exactly 12, rejecting 13th atomically
- **Print pagination:** Manual chunking over framework helpers ensures 4 photos per sheet with exact position ordering and page breaks
- **Intake fields motor-aware:** Form hidden inputs prevent unnecessary server validation and preserve null semantics across vehicle types
- **Photo compression:** Fallback to `HTMLImageElement + URL.createObjectURL` when `crypto.randomUUID` unavailable over insecure HTTP context (LAN IP)

## Dependencies

- Migrations 0023 (cliente.documento_identidad), 0024 (orden_servicio intake fields), 0025 (orden_servicio_foto table) deployed via `scripts/windows/standalone.ps1` to workshop
- R2 client library configured with WHEN_REQUIRED checksum validation; existing catalog storage integration reused without modification
- Photo table uses position-based ordering and UNIQUE(orden_id, position) constraint to enforce sequential integrity
- Print routes reuse existing workshop_config singleton for name/logo rendering

## Rollback Plan

Revert in reverse PR order (165→159):
- PR #165, #164, #163, #162, #161 (drop cleanly; foto table and migrations are additive)
- PR #160, #159 (intake columns and documento_identidad are additive; down migrations drop columns, losing only data entered since merge)

## Notes

- Owner approved chained PR strategy per workload forecast; PRs #161/#162 split within WU3 per verification bandwidth
- GGA passed all PRs; verify-report warnings 1–3 addressed in commit history before archive
- Mobile sidebar trigger (PR #164) was a disjoint defect fix outside the main change scope but included in same branch for deployment efficiency
- No secure-context dependencies in photo-handling code; fallback paths validated over LAN HTTP
- Migrations are additive-only; existing orders and customers unaffected by new optional fields

## Migration Checklist

- Migration 0023: nullable documento_identidad text column ✓
- Migration 0024: nullable kilometraje, nivel_combustible, bateria_pct columns with CHECK constraints ✓
- Migration 0025: orden_servicio_foto table with position uniqueness constraint ✓
- Migrations reach workshop via scripts/windows/standalone.ps1 ✓

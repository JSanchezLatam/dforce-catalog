# Proposal: Plate Municipio

## Intent

In Panama a plate is renewed at the municipio that issued it. The workshop offers that renewal (see `vehicle-renewals`), but the vehicle record does not say which municipio, so whoever calls the customer has to ask first. Owner decision, final (grill 2026-10-06, Engram `decision/closed-order-lock-and-plate-municipio`).

## Scope

### In Scope
- Nullable free-text column `placa_municipio` on `vehiculo`, next to `placaRenovacionMes`.
- Validation at the trust boundary: trim, empty becomes null, max 80 characters, Spanish error message.
- INTERNAL field, same rules as the other renewal fields: needs `vencimientos.read`, tri-state on save (omitted = unchanged), refused from a session without the grant, absent from `PublicVehiculo`.
- Shown and edited where the renewal data already is (`CustomerForm` renewal section, vehicle detail page); shown on each "Vencimientos próximos" row. Responsive on tablet and phone.

### Out of Scope
- A list or picker of municipios; filtering or grouping by municipio.
- The service order, the printed sheet, the customer portal and `GET /api/customers/[id]/vehicles` (they never show it).
- Using the municipio in the contact message.

## Capabilities

### New Capabilities
None

### Modified Capabilities
- `vehicle-renewals`: Internal Renewal Fields gains the municipio (validation, visibility, refusal, preservation); the page shows it per row.

## Approach

Mirror how `placaRenovacionMes` was added in `archive/2026-10-04-vehicle-details-and-renewals`:
- Migration `0026` adds the column (additive, no default, no backfill).
- `VehiculoInput.placaMunicipio?: string | null` (tri-state), included in `applyVehiculoPlan`'s conditional spread and in `sendsInternalVehiculoFields`.
- `validation.ts` normalizes it; `CustomerForm` adds one text input to the gated section and its row error.
- `listDueCandidates` selects it; the page renders it when present.
- The `PublicVehiculo` allowlist and `vehicle-rows.ts` need no edit; the existing poisoned-fixture tests get the new key so a leak goes red.

One PR, estimated well under 400 authored lines (the generated migration snapshot excluded).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/shared/db/schema.ts`, `src/shared/db/migrations/0026_*` | Modified/New | Column |
| `src/modules/customers/` (`vehicles.ts`, `validation.ts`, `CustomerForm.tsx`) | Modified | Input, normalization, gating, form |
| `src/app/(app)/customers/[id]/vehicles/[vehicleId]/page.tsx` | Modified | Display |
| `src/modules/vencimientos/queries.ts`, `src/app/(app)/vencimientos/page.tsx` | Modified | Select and display |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Technician save wipes the municipio | Med | Tri-state; mutation-verified test plus an e2e assertion |
| Leak to order, sheet or public GET | Low | Allowlists; poisoned fixtures extended |
| Workshop PC lacks the column, page errors | Med | Run `standalone.ps1` (migrations) on the workshop PC when deploying |
| Long text breaks the phone row | Low | Wrapping; browser check at the LAN IP |

## Rollback Plan

Revert the PR. The migration is additive; a down migration drops the column, losing only municipios entered since.

## Dependencies

- None. Deployment: the workshop PC must run `standalone.ps1` to apply migration `0026`.

## Success Criteria

- [ ] An administrador saves "  San Miguelito " and sees "San Miguelito" on the vehicle and the due row; blank saves as null.
- [ ] A technician's save leaves it unchanged; a technician sending it is refused.
- [ ] It never appears on the order, the sheet or the public GET (sentinel tests red when broken).

## Proposal question round

Not run: execution mode auto, and the owner settled every product question in the 2026-10-06 grill. Assumption for review: max length 80 characters.

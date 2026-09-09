# Spec: user-management

**This baseline is INCOMPLETE, and that is a known gap, not an oversight in
reading it.** The file was created by `table-redesign-bulk-actions`' archive by
copying that change's delta verbatim — preamble and `## ADDED Requirements`
merge header included — so it holds only the one requirement that change added.
Every other user-management requirement still lives unconsolidated in
`openspec/changes/archive/crm-shell-settings-rbac/specs/user-management/spec.md`
and must be read from there. Consolidating them is its own change.

The stray merge header was removed on 2026-09-09: `## ADDED` / `## MODIFIED`
are instructions for an archiver, consumed rather than copied, and one sitting
in a consolidated baseline makes the spec claim authorship it does not have.

## REQUIREMENTS

### Requirement: Bulk Activate/Deactivate Under the Admin-Floor Invariant

Staff MUST be able to select users in the list view (per
`table-bulk-actions`) and apply a bulk activate or deactivate action.
Because a mixed selection of active and inactive users needs opposite
operations, the UI MUST offer two separate actions — "Activar" and
"Desactivar" — never one action that infers direction per row.

The bulk deactivate action MUST loop the existing `deactivateUser()`
sequentially, one row at a time, exactly as it is called today for a single
row. It MUST NOT read the active-administrator list once and evaluate every
row against that snapshot, because `deactivateUser()` is race-safe only by
re-querying the active-admin count fresh, inside its own transaction, on
every call (`account/service.ts:454-479`). A batched read would let a
selection containing every administrator pass every row's check against a
not-yet-decremented count and leave the workshop with zero administrators.
This extends the existing "Last Active Administrador Cannot Be Removed"
requirement to the bulk path without changing that requirement's rule.

#### Scenario: Selecting every remaining admin deactivates exactly one
- GIVEN exactly 2 active administrators and no other selected users
- WHEN staff selects both and runs "Desactivar"
- THEN the system MUST deactivate exactly one of them and refuse the second with `last_active_admin`, leaving at least one administrator active

#### Scenario: Mixed selection uses the matching button only
- GIVEN a selection containing both active and inactive users
- WHEN staff clicks "Desactivar"
- THEN only the active users in the selection MUST be affected; the already-inactive ones MUST be reported as a no-op, not a failure

#### Scenario: Self-inclusion is refused per row, not for the whole batch
- GIVEN a selection that includes the acting administrator's own account among 4 others
- WHEN staff runs "Desactivar"
- THEN the other rows MUST be processed normally and the acting administrator's own row MUST be refused with `self_deactivate`

*Verification*: `deactivateUser()`'s transaction is exercised only through an
injected `database`/`listActiveAdminIds` seam in unit tests — per AGENTS.md,
a green suite here proves zero coverage of the real transaction's
row-locking behavior. The admin-floor scenario above MUST additionally be
run against a throwaway Postgres database before merge, confirming that
selecting both remaining admins together still leaves exactly one active.

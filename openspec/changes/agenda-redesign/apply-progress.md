# Apply progress: agenda-redesign

## WU1: range query (branch feat/agenda-redesign-wu1-range-read) - code done, close C2/C3 pending (orchestrator)

- 1.1-1.6 done. 1.7: C1 gates green (npm test 3902, tsc clean, lint 0 errors / 13 warnings, agenda e2e 15 + combined 6 on throwaway dforce_e2e); GGA and PR left to the orchestrator.
- RED: e2e 4 new tests failed (technicians undefined, no-show row absent), 11 passed; unit "No-show: the SQL text" failed on `exists`. GREEN after `queries.ts`.
- Mutations (queries.ts, restored byte-identical): drop `changed_at >` -> no-show e2e + unit red; drop `from_status = 'booked'` -> same two red; include deactivated -> "A deactivated technician is excluded" red; drop NO_SHOW from the WHERE -> no-show e2e + unit red (the unit needed a stronger `or(ne(...), NO_SHOW)` assertion first: it was a placebo).
- Not mutated: "replace the batch with a join" (not done; the assertion on row ids and count() is what guards it).
- Deviations: `noShow` is derived in TS as `status === "cancelled"` (WHERE admits a cancelled row only as a no-show) instead of a selected boolean; the AgendaRow builder is in `items.test.ts`.

# Apply progress: agenda-redesign

## WU1: range query (branch feat/agenda-redesign-wu1-range-read) - code done, close C2/C3 pending (orchestrator)

- 1.1-1.6 done. 1.7: C1 gates green (npm test 3902, tsc clean, lint 0 errors / 13 warnings, agenda e2e 15 + combined 6 on throwaway dforce_e2e); GGA and PR left to the orchestrator.
- RED: e2e 4 new tests failed (technicians undefined, no-show row absent), 11 passed; unit "No-show: the SQL text" failed on `exists`. GREEN after `queries.ts`.
- Mutations (queries.ts, restored byte-identical): drop `changed_at >` -> no-show e2e + unit red; drop `from_status = 'booked'` -> same two red; include deactivated -> "A deactivated technician is excluded" red; drop NO_SHOW from the WHERE -> no-show e2e + unit red (the unit needed a stronger `or(ne(...), NO_SHOW)` assertion first: it was a placebo).
- Not mutated: "replace the batch with a join" (not done; the assertion on row ids and count() is what guards it).
- Deviations: `noShow` is derived in TS as `status === "cancelled"` (WHERE admits a cancelled row only as a no-show) instead of a selected boolean; the AgendaRow builder is in `items.test.ts`.

## WU2: item fields (branch feat/agenda-redesign-wu2-item-fields) - code done, close C2/C3 pending (orchestrator)

- 2.1-2.3 done; 2.4: C1 gates see the report. RED: 6 new/changed `items.test.ts` tests failed (the serializability test passed at RED: the item had no Date yet). GREEN after `items.ts` + `items.fixture.ts`.
- Mutations (items.ts, restored): initials from one word -> "Technician initials" red; drop noShow label -> "Status is text as well as colour" red; Date left in item -> "no Date and no function" + "Chip fields" + "Flag is a server-computed boolean" red; `noShow: false` -> "Status is text..." red.
- Deviations: `minuteOfDay` is parsed from the formatted `HH:mm` (no new dates.ts helper). `categoriaLabel` uses `CATEGORIA_LABEL`, so `revisado` reads "REVISADO" (the spec examples say "Revisado"; WU6 card tests must assert the real label or the spec example must change).

## WU3: side reads (branch feat/agenda-redesign-wu3-side-reads) - code done, 3.6 C2/C3 pending (orchestrator)

- 3.1-3.5 done. RED: 3 e2e ("is not a function") and 4 unit surface tests failed; items 3 tests failed. GREEN: `agendaBusyDays`, `agendaNext`, `agendaWeekCounts` (queries.ts, shared `SHOWN` inclusion rule), `nextLabel`, `toWeekSummary` (items.ts). e2e: agenda-queries 18/18 on a freshly recreated dforce_e2e.
- Mutations (restored, cmp-verified): UTC day for busy days -> "Busy days are real" red; drop `status = 'booked'` from next -> "Próxima cita ... ignores non-booked" + unit "next is booked-only" red; week upper bound widened -> "Week summary counts" red; drop SHOWN from week counts -> "Week summary counts" + unit red; cutoff = now, and strict `>` at the 60-minute boundary -> "Week summary counts" red (first run SURVIVED: the seed had no booked row inside the margin; added a 30-min-ago and an exactly-60-min row, then both red). nextLabel: UTC date -> "the later date is the PANAMA day" red; `< 61` -> "Próxima cita text" red.
- Deviations: `agendaWeekCounts(scope, week, now)` takes `now` (Vencida needs it; the task listed two args). Week counts use one non-grouped aggregate query (`count(*) filter`), not GROUP BY. `toWeekSummary` returns `{label,count}[]` in column order. Hours exactly on the hour read "en 1 h 0 min" (spec formula, literal). agendaBusyDays takes any day key of the month.
- e2e isolation: the side reads are DB-wide, so each test owns an era (2032-01 busy days, 2032-03 next, 2031-12 week); other e2e files seeding those months would break them (not checked: only run on a fresh DB, this file alone).

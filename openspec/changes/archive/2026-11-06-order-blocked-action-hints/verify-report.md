# Verify report: order-blocked-action-hints

Verified 2026-11-06 on `main` @ 00e0461 (tracker #335 merged; WU PRs #336-#342). Engram was not consulted or written (hybrid mode; filesystem only).

## Verdict: PASS WITH WARNINGS (0 CRITICAL, 3 WARNING, 3 SUGGESTION)

## Gates
- `npm test`: 288 files, 4550 tests, all passed.
- `npx tsc --noEmit`: clean.
- `npm run lint`: 0 errors, 13 warnings (matches baseline).
- Tasks: all checked except 7.3 (browser, documented as not done) and 7.4 (tracker integration/merge/archive, this phase's gate).

## Mutation spot-check (reverted via `git checkout`; tree clean after)
| Mutation | Red tests (by name) |
|---|---|
| `hints.ts` Faltan: drop `a.active &&` | hints.test "in_progress excludes a deactivated technician", "in_progress with nobody unmarked and active shows nothing"; page.test "leaves a deactivated technician out of the list", "renders no hint when the only unmarked assignee is deactivated" |
| `blockedMoveReason`: drop `isAllowedTransition` guard | hints.test "booked -> diagnosing has no edge...", "diagnosing -> ready_for_review has no edge...", "in_progress -> diagnosing (no edge)...", "uses the 'Pasa sola' text exactly...over every pair"; DndBoard "lights the legal columns...", "a booked card over En diagnóstico is not told it passes by itself", "dropping a booked card on En diagnóstico toasts the origin-aware reason" |
| `assignAction`: always `"technicians"` | hints.test "open, nobody assignable, no technicians.manage: text only", "workLinesHint ... 'Ir a Técnicos' only with technicians.manage"; OrderWorkCard "open, jefe, nobody left to assign and no technicians.manage: text only" |

No placebos found in the three sampled rules.

## Scenario coverage

Paths: `SO` = src/modules/service-orders, `K` = src/modules/kanban, `SU` = src/shared/ui, `PG` = src/app/(app)/service-orders.

### kanban-board
| Scenario | Test(s) |
|---|---|
| Legal and illegal targets | K/DndBoard "lights the legal columns and dims the others with the hint of THIS origin and target, for an in_progress card" |
| Recibida over En diagnóstico | DndBoard same test + "the same target reads differently by origin..."; SO/hints "open -> diagnosing passes by itself" |
| Same target, different origin (booked) | DndBoard "a booked card over En diagnóstico is not told it passes by itself"; hints "booked -> diagnosing has no edge" |
| Automatic review target from another origin | hints "diagnosing -> ready_for_review has no edge"; (DndBoard drag for a diagnosing card not asserted directly; covered at the pure-function level) |
| Illegal drop explains itself | DndBoard "dropping an open card on En diagnóstico sends nothing and toasts the reason with a period" |
| Illegal drop from another origin | DndBoard "dropping a booked card on En diagnóstico toasts the origin-aware reason" |
| Drop on own column is silent | DndBoard "dropping on the card's own column is silent: no request, no toast" |
| Old generic text gone | board/primitives "an illegal column shows the dropHint it was given, never the old generic text"; "a hint is only shown while the column is illegal" |
| Hold needs a reason / Complete confirmed / Recibida refused | pre-existing: K/KanbanBoard.move.test.tsx (not re-audited in this change; suite green) |
| Drop hint placement and legibility [browser] | tasks 6.6: Playwright LAN IP 1280, real mouse drag. Tablet 768 long-press NOT done |
| Toggle by role / Mark urgent | pre-existing K/KanbanBoard.urgent.test.tsx, CardMenu "a técnico sees only Ver orden", "Marcar como urgente reports true" |
| Recibida menu explains the missing move | CardMenu "an open card for a jefe starts with a disabled, aria-disabled reason item with an Info icon, then a separator"; "blocked carries the assign-a-technician reason only for an open card the viewer may move" |
| Disabled item does nothing | CardMenu same test (click sends nothing, menu stays) |
| Phone sheet carries same reason | MoveSheet "blocked reason > an open card shows the reason as the first, non-button row and keeps Trash2 on Cancelar orden" |
| Other statuses and roles get no reason | CardMenu "no reason item for a booked card (jefe) or an open card (técnico)"; MoveSheet "is absent for a booked card and for a técnico" |
| Blocked row hit target and wrap [browser] | CardMenu "every menu row is at least 44px tall..." (class pin); browser 6.6 at 1280: item 44px, full opacity. Tablet/phone widths and dark NOT verified |

### order-work-lines
| Scenario | Test(s) |
|---|---|
| Lines/totals, técnico own mark, mutation confirms, hit-target floor | pre-existing OrderWorkCard tests ("lists every line...", "offers the mark to the viewer's own pending assignment...", "holds both controls at the 44px floor") |
| Recibida without técnico, jefe | OrderWorkCard "open, jefe, nobody assigned: hint above the empty state with an Asignar técnico button that focuses #assign-tecnico"; hints "open without assignee, jefe: assign button" |
| Recibida, nobody left to assign | OrderWorkCard "open, jefe, nobody left to assign: a link Ir a Técnicos..." and "...no technicians.manage: text only" |
| Agendada jefe / técnico | OrderWorkCard "booked, jefe: Recibí la orden, no button", "booked, assigned técnico..." |
| En espera jefe / técnico | OrderWorkCard "on_hold, jefe", "on_hold, assigned técnico" |
| En diagnóstico técnico / is técnico-only | OrderWorkCard "diagnosing, técnico: ...", "diagnosing, jefe: no hint"; hints "a técnico with a marked part on diagnosing gets no..." |
| Técnico after Mi parte lista; Lista para revisión técnico | hints "marked técnico on in_progress and ready_for_review..."; OrderWorkCard "takes every write control away from a técnico who marked their part" (hint text asserted in hints.test; see SUGGESTION 1) |
| No hint when viewer can write | OrderWorkCard "shows no hint when the viewer can write", "shows no hint on a closed order" |
| Copy is exact | hints.test exact-string assertions + OrderWorkCard per-status tests |
| Hint layout beside controls [browser] | task 5.3: Playwright LAN 390/768 light. Dark NOT re-measured; owner's device extension NOT used |

### service-orders
| Scenario | Test(s) |
|---|---|
| Each label renders / filter / unknown status / sort | pre-existing PG/page.test "it.each statuses" (filter), "ignores an unknown ?status=", StatusBadge "the eight order statuses" |
| Badge hue equals STATUS_HUE | SU/StatusBadge.test.tsx "%s renders hue-tint with --h/--s from ORDER_HUE"; status-hue.test "is the source of the board's STATUS_HUE h and s" |
| Cancelled keeps its own style | StatusBadge "keeps cancelled neutral and struck through, with no hue" |
| Badge text contrast [browser] | task 1.7 (LAN IP, light+dark) |
| Secondary actions move to breadcrumb line | PG/[id]/page.test "puts Editar orden and Imprimir in the breadcrumb row, not in the card header", "holds only the title and the badge in the title row..." |
| Short label is accessible name | SO/OrderStatusControls "uses the visible short label as the accessible name: no button has an aria-label" (deviation accepted) |
| Only normal next step filled | OrderStatusControls "fills nothing on %s", it.each at :417/:427, "tints the rest..." |
| Button color is target hue | "colours each button with the hue of the status it leads to, from the shared source" |
| Cancelar last after divider | "puts an aria-hidden divider right before Cancelar, which is last"; "offers staff the close first, then the send-back, then the cancel..." |
| Icons per button | "puts an icon in every button, and Ban on Cancelar" |
| Statuses offered unchanged / técnico none | "offers staff ... on a booked/on_hold/in_progress/ready_for_review order"; "offers a técnico nothing on ..." |
| Header never clips / phone stacks / hit target [browser] | task 2.6 [x] (browser, LAN IP); class pins "stacks full width below 640px of container", "keeps every status control at the 44x44 floor" |
| Open order without técnico | PG/[id]/page.test "puts the hint in the card header, after the status controls" |
| Asignar técnico focuses select | page.test "focuses the #assign-tecnico select when Asignar técnico is clicked"; SU/FocusTargetButton "focuses the element it points at when clicked" |
| No technician left to assign | page.test "offers a link to Técnicos, and no Asignar técnico...", "shows the text only..." |
| Open order hint for jefe_taller | page.test open-order block (admin/jefe via canAssign); hints "open without assignee offers 'assign'". See SUGGESTION 2 |
| Open order with technician shows no assign hint | page.test "shows no assign hint once someone is assigned" |
| Faltan lists / excludes deactivated / none / only En progreso | page.test "lists, in order, the active technicians who have not marked their part", "leaves a deactivated technician out of the list", "renders no hint when the only unmarked assignee is deactivated"; hints "'Faltan' appears only on in_progress" |
| Agendada without vehicle / complete enables Recibir | page.test "opens the same edit dialog from the hint's button", "leaves Recibir alone and shows no hint when vehicle and category are set"; OrderStatusControls "disables Recibir, keeps Cancelar enabled and points Recibir at the hint", "sends nothing when the disabled Recibir is clicked" |
| Hint visual treatment [browser] | task 4.5 (LAN IP, 390 wrap, 44px, light+dark) |
| Empty list: linked / unlinked / filter / other roles / técnico with orders | PG/page.test "ServiceOrdersPage — técnico empty list": five tests, one per scenario |

Uncovered scenarios: none at unit level.

## Unverified in a browser
- Tablet long-press drag (task 6.6) and 768/phone widths for the Recibida menu/sheet.
- Both técnico empty states (task 7.3, open): no suitable linked/unlinked técnico in dev data. Covered only by 5 page tests plus mutations.
- Dark mode on the work card (task 5.3) and on the Recibida menu item.
- The owner's Chrome device extension was not used for any [browser] item (Playwright at LAN IP instead).
- Per AGENTS.md, jsdom pins classes only; rendered 44x44 for WU4/WU5/WU6 rests on the Playwright measurements recorded in tasks.md.

## Findings

### CRITICAL
None.

### WARNING
1. Task 7.3 left open: técnico empty states have never rendered in a browser. The `findTecnicoByUserId` branch is server-side data-dependent; low risk, but the AGENTS.md rule says a green suite is not evidence there. Close with a seeded linked and unlinked técnico before relying on it.
2. Task 7.4 open (tracker integration check, archive): tracker is merged; this report plus the gates above serve as the integration check. Archive must follow the two-part gate in the archive-discipline memory (delta specs merged into `openspec/specs/{kanban-board,order-work-lines,service-orders}`; the delta spec already carries the WCAG 2.5.3 no-aria-label decision (checked); design.md D5 still says otherwise and is superseded by tasks.md).
3. Tablet long-press and dark-mode checks (above) are unverified; accepted gap only if the owner accepts it.

### SUGGESTION
1. Spec scenario "Técnico after Mi parte lista" / "Lista para revisión, técnico": hint text is asserted in `hints.test.ts`; OrderWorkCard has no dedicated rendered test for the marked-técnico hint (existing "takes every write control away from a técnico who marked their part" does not assert the hint text). Add one render assertion.
2. Spec "Open order hint for jefe_taller" is covered by the shared `canAssign` path; no test names jefe_taller explicitly versus administrador.
3. No DndBoard drag test for a `diagnosing` card showing "Desde En diagnóstico no se puede pasar a Lista para revisión" in the rendered column (pure function covered).

## Accepted deviations (documented, not failures)
No aria-label (WCAG 2.5.3); `workLinesHint` without `mode`; `dom-ids.ts`; drop-toast tests in DndBoard.test.tsx.

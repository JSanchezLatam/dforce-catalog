# Verify Report: mobile-responsive-pass

Verdict: PASS WITH WARNINGS (0 CRITICAL, 3 WARNING, 2 SUGGESTION). Main @ f26c381.

Gates: `npm test` exit 0 (172 files, 2439 tests); `npx tsc --noEmit` exit 0.

## Spec coverage

responsive-layout
- No overflow 390 [LAN]: tasks 3.8, 5.4, 6.4, 9.8, audit-final.md (86 screens, scrollWidth == innerWidth); 11a.9 for 768 lists.
- Title/actions on phone [LAN]: task 3.8. Header contract [unit]: src/shared/ui/PageHeader.test.tsx:14,40,46; src/app/(app)/service-orders/page.test.tsx:716.
- No-permission: PermissionDenied.test.tsx:11,17,26; per-page refusal assertions in vencimientos, template-config, customers, customers/[id], service-orders, service-orders/[id], print page tests; same-component guard src/app/responsive-guards.test.ts:63-70. [LAN] task 4.6, audit-final #18.
- Touch floor [unit]: button.test.tsx, sidebar.test.tsx:31,44,54, checkbox.test.tsx:35, dialog.test.tsx:12, Pagination.test.tsx:82, input/select tests. [LAN] tasks 2.8, 11a.9, audit-final #5/#9/#10.
- Contrast [LAN]: task 1.9 (measured values), audit-final #6/#7/#20. Theme pairs [unit]: StatusBadge.test, Toast.test, styles.test.ts:16-22, ConfirmGenerateDialog.test, InventoryStatsHeader.test, button.test.tsx:14,20.
- Builder/template-config tablet-plus: preview [unit] TemplateConfigForm.test.tsx:163-167; [LAN] audit-final #17. "Builder markup unchanged on phones [unit]": no dedicated test (see W2).

table-bulk-actions
- Cards below md / table md+: customers page.test.tsx:872-885, service-orders :536-549, inventory :377, users UsersTable.test.tsx:916-924 (+ RecordCard.test.tsx:6).
- Card is one link: customers :892, orders :556, inventory :384; users deliberately no link (:951).
- Order card fields: service-orders page.test.tsx:565.
- No checkbox / bar unreachable: customers :933, :946-953; orders :577; inventory :421; users :979.
- Cross-page selection (existing scenarios): customers page.test.tsx:586-708, inventory :252, :296.

table-sorting
- price/stock plain: inventory page.test.tsx:347 (+ :360 values). [LAN] task 7.4.

## Tasks
All of WU1-WU11 ticked. 11.1 unticked, 11.2/11.3 are archive-phase (accepted).

## Findings
W1 (WARNING) Task 11.1 unticked. audit-final.md was measured 2026-10-05 at the tip of the 10-PR chain (8d04a7f), before WU11. N1-N6 fixes are only evidenced by 11a.9 and unit tests, not a full re-run in 4 role/theme combinations. Close 11.1 explicitly (re-run or owner waiver).
W2 (WARNING) Spec scenario "Builder unchanged on phones [unit]" has no test (guards file and builder page test do not pin markup).
W3 (WARNING) 11a.6 contrast fixes (sidebar group label, CARD_MUTED, login footer) are computed from tokens, tasks say "confirm in the browser"; no browser measurement recorded.
S1 (SUGGESTION) Task 11a.1 "Done" text still says `lg` while the header says `xl`; code is `xl` (HIDE_BELOW_XL in the three list pages).
S2 (SUGGESTION) Add a "Filtros" disclosure scenario to the spec at archive (#14 has unit test InventoryFilters.test.tsx:318 but no spec line).

## Spec drifts to fix at archive
(a) table-bulk-actions: users card links to /users/<id> -> no link (UsersTable.test.tsx:951; no detail page; design overrides).
(b) service-orders main spec "detail shows full id" -> 8-char id in title/breadcrumb, full id in a title attribute (task 9.4).
(c) Hidden secondary columns breakpoint is `xl` (not lg/md): Inventario "Categoría 2", Clientes "Email", Órdenes "ID" and "Vehículo"; tests at the three list page.test.tsx files (orders :733, inventory :491, customers :~980). Not in any spec; add to table-bulk-actions at archive.
(d) Inventory filter panel open state seeded from active filters on mount only (task 11a.5); document in spec.
Also: users table/cards word is now "Desactivado" (task 9.v); DEACTIVATED_CHIP in shared/ui/styles.

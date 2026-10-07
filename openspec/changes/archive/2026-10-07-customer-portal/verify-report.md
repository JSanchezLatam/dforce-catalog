# Verification Report: customer-portal

Mode: openspec (Engram unavailable). Date: 2026-10-07. Branch `chore/archive-customer-portal` == `main`.
Artifacts read: proposal, design, tasks, 4 delta specs (customer-portal, portal-sync, customer-management, service-orders).

## Verdict: PASS WITH WARNINGS (0 CRITICAL, 9 WARNING, 5 SUGGESTION)

## Gates (all run on this checkout)

| Gate | Result |
|---|---|
| root `npx tsc --noEmit` | exit 0 |
| root `npm run lint` | 0 errors, 13 warnings (design target of 13; AGENTS.md says 14, see W8) |
| root `npm test` (`--maxWorkers=2`) | 217 files, 3304 tests passed |
| portal `npm test` | 11 files, 102 tests passed |
| portal `npx tsc --noEmit` / `npm run lint` | exit 0 / clean |
| root e2e on throwaway `dforce_e2e` (dropped after) | 19 files, 239 tests passed |
| portal e2e on throwaway `dforce_portal_test` (run twice back to back, dropped) | 2 files, 22 tests passed, both runs |
| `npm run test:portal-sync` | 1 file, 11 tests passed; its own two throwaway DBs dropped; only `dforce_catalog` and `dforce_portal` remain |

`dforce_catalog` and `dforce_portal` were never touched.

## Completeness

All WU1-WU7 tasks are `[x]`. Unchecked: 8.1 and 8.2 (archive-time work, expected) and D.1-D.6 (owner-blocked deployment). Totals counted from the specs: about 29 requirements, 102 scenarios.

## Spec compliance matrix (scenario -> covering test)

Legend: U = unit, E = e2e (real SQL), L = `scripts/portal-sync/sync.local.ts`, B = browser-only (orchestrator, no automated test).

### customer-portal
| Scenario | Covering test |
|---|---|
| First visit shows terms only | E portal-api "open without acceptance says terms and carries no customer data; snapshot too"; U PortalClient "shows the terms and no data before Acepto" |
| Accepting reveals history | E portal-api "accept inserts exactly one row ... and returns the snapshot"; U routes "records the acceptance before it returns the snapshot" |
| Snapshot refused before acceptance | E portal-api (same first test); U routes snapshot "returns data only once accepted" |
| Returning visitor skips gate | E "after accept, open says accepted and snapshot returns the data"; U PortalClient "an already accepted token goes straight to snapshot" |
| New terms version re-gates | E "an acceptance of an older terms version re-gates" |
| Token stripped from address bar | U PortalClient "strips the fragment BEFORE the first fetch and sends the token only in the POST body"; real address bar B |
| Acceptance logged by token hash | E "accept inserts exactly one row (hash, version, time)"; schema.test unique index |
| Unknown token / Revoked and unknown indistinguishable / Rotated token | E "revoked, rotated-away, tombstoned and never-issued tokens give byte-equal 404s on every route"; U routes "answers every unknown token with the same 404"; PortalClient "shows the same neutral page when the token is unknown" |
| Only that customer's data | E "customers A and B never see each other's data" |
| Multi-vehicle history | U History "groups orders under their vehicle" |
| Unset text fields omitted | U History "shows description, hallazgos and recomendaciones only when set" |
| Staleness visible | U History "shows when the data was last updated" |
| Empty history | U History "says so when there is nothing to show" |
| No horizontal scroll at 360 px | U History "wraps long text instead of overflowing a 360px screen" pins classes only; measurement B. PARTIAL (W6) |
| No credential prompt | U page.test "asks for no phone, PIN, email or cédula"; PortalClient (no input/form) |
| Banner on terms | U PortalClient "shows the terms and no data before Acepto" |
| Replacing text changes version | E "older terms version re-gates" |
| Missing/wrong signature, stale timestamp, body tampering | U ingest route.test (401 cases); E ingest "bad signature, skew and tampering write nothing"; contract.test |
| Unknown field rejected | U parse.test "rejects an extra key at every level"; E ingest "an unexpected key is refused with 400" |
| Newer wins / stale ignored / delayed upsert after delete / idempotent delete | E ingest e2e (4 rows named in tasks 4.2) |
| Database holds no usable code | E ingest "stores no plaintext token anywhere" |
| Rate limit | U rate-limit.test; U routes "429s ... never reaches the lookup"; E portal-api "the 31st request from one IP is 429" |
| Headers on every page | headers.test pins the `next.config` rule only; no response-level test (W5) |
| Portal boots without workshop credentials | U env-isolation "reads only its own variables" |

### portal-sync
| Scenario | Covering test |
|---|---|
| Payload only whitelisted keys / Internal status / Soft-deleted vehicle / Token never in payload | U snapshot.test (4 named tests); E portal-sync "reads only active vehicles and their orders, with no forbidden column on the wire" |
| Upserted / Consent revoked after enqueue / Deactivated removed / Reactivation restores / No consent no data | U job.test (`decideSync`, `runPortalSync` tests); E portal-sync "decides by the NEWEST consent row", "pushes nothing for a customer who never consented, and a delete once deactivated"; L deactivate/reactivate |
| Rotation within one sync / Revocation within one sync | L "rotate: ..." and "revoke: ..." |
| Outgoing request signed | U transport "signs the exact bytes it sends, in a way the portal's verify accepts" |
| No cloud database credential | UNCOVERED by assertion (W7): only `env.test` pins the secret as sensitive |
| Retried job does not regress / Two jobs back to back | E portal-sync "draws strictly increasing versions", "serializes two workers ..."; E ingest "two concurrent newer versions"; L "a replayed OLDER signed body does not roll the customer back" |
| Order status change triggers / Customer without consent no push | E "enqueues exactly one job per trigger", "a customer who never consented still enqueues, but the worker pushes nothing"; U service.test per mutation; readiness.test (applyReadiness does not trigger) |
| Enqueue failure does not fail the mutation | U enqueue.test "captures an enqueue failure instead of throwing it"; service.test enqueue-after-commit |
| Transient failure retried / Exhausted retries to DLQ | U job.test/enqueue.test pin the pg-boss options (retry 5, 60 s, DLQ); the dead-letter move itself is pg-boss behaviour and is not run (S1) |
| Offline workshop catches up | L "offline: edits succeed and the sync throws a retryable error ..." (queue is a spy there) |
| Stale-version acknowledgement | U transport "completes on a 2xx whatever the body says" |
| Missed trigger heals / Missed delete repeated | U reconcile.test; E "portal-reconcile ... enqueues everyone who ever consented"; L "the nightly reconcile heals what the queue lost" |
| Rollback switch | U enqueue "no-op ... not configured"; job.test "sends nothing and does no database work"; L "with no secret configured nothing leaves the workshop" |

### customer-management
| Scenario | Covering test |
|---|---|
| Granting records who/when/version | E portal-consent "grant appends one granted row ..." |
| Revoking appends / Re-granting three rows | E "revoke appends a revoked row ...; re-grant gives three rows in order" |
| Saving without the checkbox records nothing | E "repeating the state it already has appends nothing"; U CustomerConsentPanel "keeps save disabled and sends nothing until the checkbox changes" |
| Provisional marker | U consent.test "opens with the legal-review banner, verbatim"; CustomerConsentPanel "starts the clause with the provisional-text banner" |
| Jefe records / Tecnico 403 / Only administrador rotates | U policy.test; consent route.test "403s a tecnico before any service call"; rotate route.test; E "rotate is refused for jefe_taller with 403 ..."; route-guards.test |
| Deactivated consent frozen | E "refuses a deactivated customer: 409 and no row" |
| Declined at the counter | PARTIAL (S2): token null and no QR covered; "creating orders still works" has no explicit test |
| State is visible | U CustomerConsentPanel "shows who recorded a grant and when" |
| Token issued / Two customers differ / Revocation deletes / Re-consent fresh | U portal-token.test; E "a grant stores a 256-bit base64url token", "a revoke nulls the token, and a re-grant mints a NEW one" |
| Rotation replaces / needs confirmation | E "rotate replaces the token and the old value exists nowhere in cliente", "rotate without the confirmation flag changes nothing"; U PortalCodeRotate "rotates nothing until the warning ... is confirmed" |
| Token absent from list | E "the customer list carries no token field, against the real select"; U toPublicCliente |
| Deactivate keeps record / Reactivate restores | E "deactivating and reactivating keeps the consent rows and the token"; E triggers; L deactivate/reactivate |

### service-orders
| Scenario | Covering test |
|---|---|
| Workshop name / no logo / back control / Imprimir / printed data / handwriting space / read gate / new vehicle fields / internal fields absent / Cédula + intake | print page.test (existing named tests, all passing) |
| QR slot blank on workshop copy | U "keeps the 25 mm slot blank and prints no QR, with or without consent" |
| Clause + signature for consented / No clause without consent | U "carries the clause, banner first, and the Firma del cliente line ..."; "carries neither ... without current consent" |
| Photos 4 per sheet from page 2 | U `it.each` chunking + "keeps the signature on page 1" |
| Photo-less order is one page (with clause) | B only (print preview at LAN IP). jsdom cannot count pages (W6) |
| QR prints / no consent / no PORTAL_BASE_URL / deactivated | U "shows the QR of <PORTAL_BASE_URL>/c#<token> ..." and the `it.each(cases)` "when %s" block (includes sync unconfigured) |
| Customer copy no signature block / no internal fields / read gate | U "has no Firma del cliente, no signature block ..."; "never prints the renewal month ..."; "refuses the customer copy without service-orders.read, before any customer or token read" |
| Customer copy is one page (9 photos) | B only; the test pins that the copy renders no photos (W6) |
| Hint on three fields / none on observaciones / create dialog | U ServiceOrderForm "'Visible para el cliente' hint"; detail page.test (3 hints) |

Compliance: every scenario has a passing test except the items marked B / PARTIAL / UNCOVERED, which were verified by the orchestrator in a browser or are assertions of absence.

## Correctness and design coherence

Implementation matches the design in substance: contract file with only `node:crypto`, `@portal/contract` alias, plaintext workshop token and hash-only portal, advisory-lock plus sequence ordering, tombstone via one `ON CONFLICT ... WHERE version <` statement, fragment transport with client-side POSTs, server-side acceptance, neutral 404, per-IP limiter with `ponytail:` ceiling, two print copies. No spec contradiction found in code. Deviations are all in text (below), not behavior.

## CRITICAL

None.

## WARNING (artifact text that no longer matches what shipped)

- W1 Work-unit split. Shipped as about 16 PRs (wu1a/wu1, wu2a/wu2, wu3a/wu3, wu4a/wu4, wu5a1/wu5a, wu5b1/wu5b, wu6a1/wu6a, wu6b1/wu6b, wu7). `proposal.md` "Nine chained PRs of at most 400 lines", the `design.md` WU table, and the `tasks.md` forecast and unit table still show nine units. Only the WU2 header mentions a split (and as 2a/2b, while the branches are `wu2a-token` and `wu2-token`).
- W2 `.dockerignore`. `design.md` ("adds `portal/`") says exclude whole `portal/`; shipped is selective (`portal/*`, keep `portal/src/contract.ts` because the workshop imports it). Also `tasks.md` 3.2.
- W3 QR gating. `proposal.md` "Printed sheet" ("only when consented AND `PORTAL_BASE_URL` is set") and `tasks.md` 2.6 ("four cases") omit the fifth condition, sync configured (`PORTAL_INGEST_URL` + `PORTAL_INGEST_SECRET`); the delta spec and code (`print/page.tsx`) already have it. Design "Copies" row is silent.
- W4 `allowedDevOrigins` in the portal. `portal/next.config.ts` sets it (dev-only, LAN phones never hydrate otherwise). Not in `design.md`, `tasks.md` (3.x) or `portal/README.md`.
- W5 Security headers. `design.md` and `tasks.md` 6a.4 say headers apply to `/c` and `/api/c/:path*`; shipped is one catch-all rule over every route except `_next/static`, `_next/image`, `favicon.ico` (the delta spec "every portal page" matches). `headers.test.ts` only pins the config, and the `noindex` meta comes from `layout.tsx` metadata with no test.
- W6 Page-count and layout scenarios have no automated test (jsdom limit, per AGENTS.md): photo-less consented order is one page; customer copy one page with 9 photos; no horizontal scroll at 360 px (class pinned only); real response headers. Verified in browser by the orchestrator, record it in the PR/archive notes.
- W7 `portal-sync` "No cloud database credential" has no assertion beyond `SENSITIVE_ENV_KEYS`.
- W8 Stale counts and names: `AGENTS.md` says lint has 14 warnings (verified 2026-09-09), reality is 13 (design already says 13); `tasks.md` 5a.2 names `eligibility.test.ts` but the tests live in `src/modules/portal-sync/job.test.ts`. Also the spec "Per order: ... and the id of its vehicle" vs the shipped contract, where orders are nested under their vehicle and carry no `vehicleId` (design Interfaces is the accurate one).
- W9 Test strategy text. `design.md` Testing Strategy "Local sync" row and the `tasks.md` unit-7 table row (`npm run test:portal-sync` "needs :3001 up; fails, never skips"; `next start -p 3001`) describe a spawned :3001 run; shipped runs in-process on two throwaway DBs and never touches :3001 (task note 7a and `portal/README.md` are right). Reconcile cron in `design.md` Data Flow is `0 8 * * * UTC`, shipped `0 3 * * *` with `tz: "America/Panama"` (task note 5b(c) is right).

## SUGGESTION

- S1 No test runs real pg-boss retry exhaustion into `portal-sync-dlq`; only the options are pinned and a job row is asserted. Add if cheap.
- S2 Add an explicit test "an order can still be created for a customer after consent is revoked" (customer-management "Declined at the counter").
- S3 Checkboxes 1.7, 5b.7 and 6b.5 are `[x]` while their notes say "NOT DONE"; the orchestrator later covered them manually (note 7b). Amend the notes so they agree with the checkbox.
- S4 Design data model omits the unique index `portal_terms_acceptance_token_version_uq` (migration 0001, `ON CONFLICT DO NOTHING`) and the signed non-POST 405; add both.
- S5 "placa" wording: artifacts write `plate` in English prose (fine) but the portal terms and consent clause say "placa(s)" and service-orders spec says "placa"; consistent in behavior. If the spec is meant to quote the shipped copy, name the Spanish label once. Also `createVehiculo` route enqueue (task note 5b(b)) and `registerPortalSyncWorker` wiring are not in the design trigger list.

## Next

Clean for archive once W1-W5, W8, W9 text is amended in the change docs (the specs themselves need only the one-line W8 `vehicleId` fix and optionally nothing else). No code change required.

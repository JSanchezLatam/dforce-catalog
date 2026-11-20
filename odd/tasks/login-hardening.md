# login-hardening

Objective: harden the workshop login and add TOTP two-step verification, keeping the app's own auth.
Branch: `feat/login-hardening` (draft tracker) with chained work-unit PRs. Delivery: `auto-chain`, `stacked-to-main`. Tests: `npm test`, plus e2e against a throwaway Postgres.
Security: touches auth, high-risk item 2. Each unit gets `security-audit` in guidance mode before its PR, plus an independent verifier.

## Specs

Owner's words: "Si, quiero 2FA. pero para todos. de forma opcional. y lo que recomiendas." The recommendations below were confirmed with "Si, confirmado así". Mockup approved 2026-11-18 ("Vale, perfecto"): `odd/mockups/login-hardening/index.html`.

- S1. Keep the own auth (bcrypt plus opaque DB sessions); Clerk rejected.
- S2. TOTP 2FA is optional for every user and mandatory for `administrador` and `jefe_taller`.
- S3. A trusted device skips the code for 30 days.
- S4. 10 single-use recovery codes, shown once.
- S5. An administrator resets other users' 2FA, never their own.
- S6. 5 failed attempts lock the user. Owner, 2026-11-19: "el que crece: 15 min, 1 hora, después admin" — the first lock lasts 15 minutes, the next one 1 hour, and the one after that lasts until an administrator unlocks. A successful login or an administrator unlock starts the count over. An administrator can unlock sooner. Unknown usernames lock the same way, so a lock never tells whether a user exists.
- S7. 20 failed attempts from one IP in 15 minutes lock that IP.
- S8. Passwords need at least 10 characters and cannot be on a common-password list.
- S9. Changing a password revokes the user's other sessions.
- S10. Administrators see a log of login attempts at "Registro de accesos", under Configuración, below "Gestión de usuarios".
- S11. The `secure` cookie is enabled only once the HTTPS tunnel exists (deferred).
- S12. The screens, states and copy follow the approved mockup. Code input: one field, `inputmode="numeric"`, `autocomplete="one-time-code"`.
- S13. If the sole administrator loses the phone and the recovery codes, an emergency command that runs only on the workshop PC resets that user's 2FA. Owner, asked "¿Hago el comando de emergencia en la PC del taller?": "Si". Owner, 2026-11-19, asked "¿Agrego al comando de emergencia de la PC del taller la opción de desbloquear un usuario?": "Si, agregalo al comando de emergencia". The same command also unlocks a user, so a sole administrator locked until unlock (S6) can recover.

### Assumptions (not owner decisions yet)

- A1. `pantalla` has no 2FA: the role is not in S2 and cannot open `/account`.
- A2. A user who must change password does that first, then enrols.
- A3. Mandatory roles enrol at their next login; open sessions are not cut at rollout.
- A4. Passwords under 10 characters stay valid until their next change.
- A5. A 2FA reset also revokes that user's sessions and trusted devices.
- A6. Recovery codes use the mockup format `7KQM-2XPA`.
- A7. The client address comes from the connection; `x-forwarded-for` is believed only from a proxy on the server itself (the future tunnel).

## Tasks

| ID | Specs | Work unit | Route | Status | Commit |
|---|---|---|---|---|---|
| T1 | S8, S9 | Password policy with server enforcement and fixtures | inline | done | `e70fe55` |
| T2 | S6, S7, S12 | Attempts table, IP helper, user and IP lock, lock message | inline | done | `ca92976` |
| T3 | S6, S12 | Admin unlock | inline | done | `12604ae`, `30e156a` |
| T3b | S6, S12, S13 | Escalating user lock (15 min, 1 h, until unlocked) and the emergency command's unlock | inline | done | `f50ef51`, `93d9e13`, `48bff30`, `2438e3d` (PR #369, merged `282c9d1`) |
| T4a | S10, S12 | Access log screen, read-only, typed text of unknown logins hidden | inline | done | `281cc09`, fix in the next commit |
| T4b | S10 | 90-day retention that keeps the rows a standing lock needs; unlock actor column | inline | pending | |
| T5 | S2, S4 | TOTP core, secret encryption, recovery hashes, env key | inline | pending | |
| T6 | S2 | Pending session, proxy gate, e2e fixtures | inline | pending | |
| T7 | S4, S12 | Second-step page and recovery-code path | inline | pending | |
| T8 | S2, S4, S12 | Enrolment, QR, codes, mandatory roles enforced | inline | pending | |
| T9 | S3, S9 | Trusted device, revoked on password change | inline | pending | |
| T10 | S5, S13 | Admin 2FA reset, self-reset refusal, emergency command | inline | pending | |
| T11 | S11 | `secure` cookie | inline | deferred until the tunnel | |

Route evidence: units depend on each other in order, so no writer trigger applies.

## Log

- L1 (2026-11-17, owner): "Si, quiero 2FA. pero para todos. de forma opcional. y lo que recomiendas."
- L2 (2026-11-18, owner, on the confirmed scope): "Si, confirmado así".
- L3 (2026-11-18, owner, on the mockup): "Vale, perfecto. Lo unico es que en el badges de fallido, creo que debe ser una X o un simbolo similar." Applied.
- L4 (2026-11-18): auth map. `/login*` and `/api/login*` skip `src/proxy.ts`, so 2FA routes must live outside that prefix. `authenticateUser` issues the session at once, so 2FA needs a pending state. Next migration is 0039. `qrcode` is installed; TOTP uses `node:crypto`, no new dependency. Self-service password change has no server-side length check. S9 already exists for passwords; only trusted-device revocation is new.
- L5 (2026-11-18): the mockup copy used "tú", while `AGENTS.md` and the rest of the app use Rioplatense. The standing rule wins: copy ships in voseo and the mockup was aligned.
- L6 (2026-11-18, owner): sole-administrator recovery resolved with the emergency command, S13: "Si".
- L7 (2026-11-18, T1): `security-audit` in guidance mode found no boundary violation: the change is scoped to the session user and the current password is checked before the new one is judged. An independent verifier confirmed S8 and S9.
- Follow-up: `scripts/seed-user.mjs` writes a hash without the policy; it is an install-time CLI, and its default `admin123` should be addressed with T8 enrolment.
- L8 (2026-11-18, T2): `security-audit` guidance and an independent verifier ran against real Postgres. Locks count before the password comparison under advisory locks. Anyone who knows a username can lock it for 15 minutes; S6 accepts this and T3 adds the admin unlock.
- Follow-up for T4: `login_attempts` needs the 90-day retention, and a password typed into the username field must not be shown to administrators.
- L9 (2026-11-18, T2): the Gentle AI review found that a client could forge its address. The server now takes it from the connection and believes `x-forwarded-for` only from a local proxy; checked against the running server. Non-blocking follow-ups: refused attempts still add log rows, the lock countdown uses the browser clock, and concurrent logins wait on the database pool.
- L10 (2026-11-19, T3): `POST /api/users/[id]/unlock` (`users.manage`) records an `unlocked` attempt under the per-login advisory lock; Gestión de usuarios shows "Bloqueado hasta HH:MM" (workshop clock) and Desbloquear behind a confirmation. RED observed by name, six mutations caught, real-SQL e2e plus one SQL mutation, checked at the LAN IP on desktop and phone, dark and light. The session cookie is `SameSite=lax`, so a cross-site POST carries no session.
- Follow-up: an IP lock is invisible on this screen. A user refused by the IP lock shows "Activo" with no button, and when both locks are active the toast says "Usuario desbloqueado" while login still returns 429.
- Follow-up for T4: the unlocked row does not record which administrator acted (that needs a migration), and the mockup's "Resultado" filter has no entry for unlocks.
- L11 (2026-11-19, T3): an independent verifier passed S6 and S12 with no blockers. It confirmed through the running server that forged `x-user-*` headers never reach the route, and that `userLocks` and `reserveLoginAttempt` agree on case variants, long names and a concurrent unlock. GGA passed. The Gentle AI review (risk, reliability) was approved with two advisories: the lock badge is computed at page render, and the unlock relies on the counter-reset rule in `login-lock.ts`.
- Follow-up: `reserveLoginAttempt` reads the clock before taking its advisory lock, so an attempt queued behind an unlock can be stamped earlier and be cleared by it (at most one failure per concurrent unlock). A direct POST also resets up to four earlier failures on a login that is not locked; it needs an admin session.
- L12 (2026-11-19, owner): "Okey, creo que el bloqueo debe ser por mas tiempo. y tambien me di cuenta que si pongo un usuario que no existe tambien lo bloquea. creo que el bloqueo debe ser diferente". Explained that locking unknown usernames prevents user enumeration (OWASP); the owner kept it and chose the escalation: "el que crece: 15 min, 1 hora, después admin". S6 rewritten, T3b opened. The IP lock stays at 15 minutes.
- L13 (2026-11-19, T3b): GGA and an independent verifier both flagged that a lock lasting until an unlock leaves a sole administrator with no way back in the app. Owner: "Si, agregalo al comando de emergencia". S13 extended; the command's `unlock` ships with T3b, its 2FA reset stays in T10. GGA's two stale-comment findings fixed in `93d9e13`. Verifier: PASS on S6, S7, S12, no blockers.
- L14 (2026-11-19, T3b): `scripts/emergency.mjs unlock <usuario>` writes the same `unlocked` row under the same advisory lock as the admin unlock, reading `DATABASE_URL` from `.env` when unset; WINDOWS.md and WINDOWS.es.md list it under "When something fails". e2e 11/11 on `dforce_e2e` (mutation: an `INSERT` of `locked` instead of `unlocked` fails the emergency test by name); the CLI was run for usage, unknown user and a real unlock. GGA passed on `48bff30`. Follow-ups: a failing `ROLLBACK` in the command masks the original error; unknown-username permanent locks cannot be cleared and their rows stay (T4 retention).
- L15 (2026-11-20, T3b): Gentle AI review (risk + reliability, owner granted) APPROVED and acknowledged, no blockers. Advisories fixed: the command now refuses to run without `DATABASE_URL` (pg would fall back to libpq defaults), a failed `ROLLBACK` no longer masks the original error, and the restart e2e asserts a lower bound. Left as follow-ups: R1 permanent lockout by anyone who knows a username (owner's choice in S6, recovery via S13); R3 user-lock reads are unbounded back to the last reset, to be bounded by T4's 90-day retention, which must not delete rows a standing lock depends on.
- L16 (2026-11-20, T4): T4 split in two: the read-only screen first (T4a), then retention and the unlock actor (T4b), which delete stored data and add a migration. Asked "¿qué muestro cuando alguien entra con un usuario que no existe? A veces la gente escribe la contraseña en el campo de usuario por error, y entonces el administrador la vería.", the owner chose "Ocultarlo (Recomendado)": a row whose typed login matches no user shows "Usuario desconocido" and the typed text never leaves the server. This departs from the mockup's `admin (no existe)` row.
- L17 (2026-11-20, T4a): `/access-log` (`users.manage`), with a Configuración entry below Gestión de usuarios. Filters are Usuario (from `users`), Resultado and Período (24 h, 7, 30 or 90 days, default 7), with 25 rows per page. The name comes from a join on `users.username`, so refused rows (with no `user_id`) still name a real user, and an unknown login's text is never selected. Deviations from the mockup, logged rather than shipped silently: a "Desbloqueado" result and badge for unlock rows; public addresses shown in full, not masked as `181.197.x.x`; a refused row reads "Rechazado: acceso bloqueado", because the row does not record which lock refused it; success rows carry no detail until 2FA exists (T7–T9); and dates use the app's `formatDateTime`. Checks: RED observed; two SQL mutations (selecting the typed text, dropping the period bound) fail the e2e by name; e2e 15/15 on `dforce_e2e`; suite 4851/4851, `tsc` clean, lint 0 errors (13 warnings). Checked at the LAN IP on desktop dark and phone light: 57 rows in the window paged 25/25/7, the filter and page links keep the filters, typed text absent from the HTML, no horizontal scroll. QA rows removed.
- L18 (2026-11-20, T4a): GGA found an oracle in the user filter: `?user=<guess>` matched the typed text and its count confirmed what someone had typed. The filter now goes through the join, so only a real login matches, and the e2e expects zero rows for the typed text. The independent verifier passed S10 and S12 with no blockers. Its advisory, that `?result=toString` crashed the page because `in` reads inherited names, is fixed with `Object.hasOwn`. Kept on purpose: the header "de los últimos 90 días" is the mockup's copy (S12) and describes what the log holds, not the default filter. Verifier advisories left as is: 169.254/16 and 100.64/10 read as Internet, and a username over 150 characters reads as unknown (`loginKey` truncation predates this unit).

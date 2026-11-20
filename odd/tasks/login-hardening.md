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
- S10. Administrators see a log of login attempts at "Registro de accesos", under Configuración, below "Gestión de usuarios". Owner, 2026-11-20, on what a login matching no user shows: "Ocultarlo (Recomendado)". Owner, 2026-11-20, on its old rows: "Borrarlos a los 90 días (Recomendado)" — they go after 90 days like the rest, even if that name is still locked.
- S11. The `secure` cookie is enabled only once the HTTPS tunnel exists (deferred).
- S12. The screens, states and copy follow the approved mockup. Code input: one field, `inputmode="numeric"`, `autocomplete="one-time-code"`.
- S14. Owner, 2026-11-20, asked who generates `TOTP_ENCRYPTION_KEY` on the workshop PC: "Si, opción 1" — the install script (`standalone.ps1`) creates it once, when `.env` lacks it, and says so. The owner keeps a copy of `.env` outside the PC, because the R2 backup holds the database, not the key.
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
| T4a | S10, S12 | Access log screen, read-only, typed text of unknown logins hidden | inline | done | `281cc09`, `eca7ca9` (PR #370, merged `5acd6d3`) |
| T4b | S10 | 90-day retention that keeps the rows a standing lock needs; unlock actor column | inline | done | `f86feb0`, `ee680ed`, `dada2e1` (PR #371, merged `e2781b3`) |
| T5 | S2, S4 | TOTP core, secret encryption, recovery hashes, env key (library only; storage lands with T6/T8) | inline | done | `a2718ad`, `168cfa3`, `30eb200` (PR #372, merged `823402f`) |
| T6 | S2 | Pending session, proxy gate, e2e fixtures | delegated (context backstop, L28) | done | `a038c74`, `5e34740`, `02c1d5c` |
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
- L19 (2026-11-20, T4a): GGA passed on the correction. Gentle AI review (risk + reliability, owner granted "Revisar este cambio") APPROVED and acknowledged, with no blockers. Follow-ups: a page number past the last page shows the empty state with no way back to page 1 (check `total` or clamp the page); the exact-match join depends on `loginKey` storing the login as typed.
- L20 (2026-11-20, T4b): `purgeOldLoginAttempts` runs daily at 03:40 Panama time (pg-boss `login-attempts-retention`, registered at boot). It deletes attempts older than 90 days that are refused (`locked`, which no lock counts) or that come strictly before a later success or unlock of the same login. That is exactly what `sinceLastReset` and the minutes-long IP window stop reading, so a standing lock keeps every row it is computed from, and a concurrent attempt cannot change the result: the last reset only moves forward. Checks: RED observed; four mutations caught by name (delete every old row, keep refused rows, `>=` letting the last reset delete itself, boot registration removed); e2e on `dforce_e2e`; suite 4857/4857, `tsc` clean, lint 0 errors. Consequence: for a login that never succeeds or is never unlocked, its counted failures stay past 90 days. That is the case of an unknown username guessed slowly without locking. The growth is bounded by the IP lock's rate, and is left as a follow-up.
- L21 (2026-11-20, T4b): migration 0040 adds `login_attempts.actor_id`, nullable, referencing `users` with `on delete set null`; additive, no existing row changes. The admin unlock records the session user; the emergency command records none. The access log reads "Desbloqueado por <administrador>" or "Desbloqueo de emergencia desde la PC del taller". Checks: RED observed; mutations caught by name (unlock writes no actor; actor read from the wrong join); e2e on `dforce_e2e`; suite 4858/4858, lint 0 errors. Checked at the LAN IP: an admin unlock and an emergency unlock of a QA user show the two copies. Migration 0040 was applied to the dev database; QA rows removed. Owner action: run migrations 0039 and 0040 on the workshop PC after main.
- L22 (2026-11-20, T4b): GGA passed. An independent verifier passed S6, S10 and S13 with no blockers; its random-history probe found the counted rows and `userLocks` identical before and after the purge. Its advisory, that a password typed as a username was never purged because an unknown login never resets, went to the owner, who chose "Borrarlos a los 90 días (Recomendado)". The purge now also deletes old rows of a login that matches no user; the cost is a 90-day delayed oracle on a deliberately locked name. RED observed by name. The access-log e2e now uses a separate administrator as the actor. Left as is: a hard-deleted administrator's unlocks read as emergency ones (the app never hard-deletes users); the purge is quadratic per login with no reset, which does not matter at one workshop.
- L23 (2026-11-20, T4b): Gentle AI review (risk + reliability, owner granted "Revisar este cambio") APPROVED and acknowledged, no blockers. Follow-ups:
  - The purge's "unknown login" test is an exact match against `users.username`, so a real username over 150 characters (`loginKey` truncation) would lose its old lock rows. `createUser` sets no length cap; capping usernames at 150 is the fix.
  - Unlocks with a null actor read as emergency ones: pre-0040 dev rows and hard-deleted administrators only.
  - A renamed user starts with no history under the new name; this predates T4b.
- L24 (2026-11-20, T5): a library only, with no tables. Per `schema.ts`, a table lands with the code that first reads it (T6, T8), and when it does it stays off `users`, which is selected whole.
  - `totp.ts`: RFC 6238 over RFC 4226 (SHA-1, 6 digits, 30 s) on `node:crypto`. The window is one step either side. `verifyTotp` returns the matched step and refuses any step at or before the last accepted one, so a code works once. It accepts six digits only and compares in constant time. The `otpauth` issuer is a parameter (per-install config).
  - `secret-box.ts`: AES-256-GCM with a fresh IV and a `v1:` prefix. The user id is AAD, so sealed secrets cannot be swapped between users. HKDF derives separate subkeys per use.
  - `recovery-codes.ts`: 10 Crockford codes `XXXX-XXXX` with no I/L/O/U and no modulo bias. Typed input forgives case, spaces and dashes, and reads O as 0 and I or L as 1. Codes are stored as HMAC-SHA256 under a derived key, not bcrypt: ten bcrypt checks at cost 12 per attempt would cost seconds of CPU on the PC that is also the database, and the key keeps a database copy alone from brute-forcing 40-bit codes. Losing the key loses the codes too, and S13 covers that.
  - `TOTP_ENCRYPTION_KEY` is optional at boot (`env.ts`), read when 2FA needs it, sensitive, and validated to exactly 32 bytes. `env.example` leaves it blank on purpose, because `standalone.ps1` copies that file verbatim.
  - Test vectors were fetched from the RFC texts (4226 Appendix D, 6238 Appendix B), including leading zeros.
  - Checks: RED observed, and mutations caught by name (AAD removed, replay allowed, any code shape, no O→0, unkeyed hash, leading zeros lost, no clock drift). Suite 4914/4914, `tsc` clean, lint 0 errors (13 warnings).
  - `security-audit` guidance, inline: no boundary is crossed yet, because nothing calls this code. Advisories: `base32Decode("")` yields an empty HMAC key, so callers must only pass generated secrets; Node's base64 decoding is lenient and only the length check guards the key. Process gap: the T4a and T4b log entries record verifier, GGA and review passes but no separate `security-audit` guidance pass.
- L25 (2026-11-20, T5): GGA passed. An independent verifier passed S2 and S4 with no blockers. Its probes confirmed:
  - every RFC 4226 and 6238 vector, on a separate implementation;
  - base32 against an independent encoder for every length from 0 to 40 bytes;
  - an unbiased alphabet over 160k symbols;
  - the ±1 window, and replay refusal at every boundary.

  Fixed from its advisories, RED first: `openSecret` accepted a GCM tag cut to 4 bytes (Node's default), so the tag length is now pinned to 16; it also accepted extra `:` fields. Left as is: a time before the epoch throws (unrealistic); the key parser accepts base64url and padding variants (usability only); a server clock set back refuses codes until it catches up, and recovery codes cover that.
- L26 (2026-11-20, T5): the Gentle AI review (risk and reliability, owner granted "Revisar este cambio") was APPROVED and acknowledged, with no blockers. Its two suggestions were applied after the review: `verifyTotp` now refuses a secret under 16 bytes (RFC 4226 §4), because a blank or damaged stored secret gives codes anyone can compute (RED observed); and the env test title now says it checks the key when 2FA asks for it.
- Follow-ups recorded now, built later:
  - T7: a wrong second-step code must count toward the user lock, or six digits can be guessed (likely a new `login_outcome` value, so a migration).
  - T8: on an install with no key, a mandatory role cannot finish login, so who generates the key on the workshop PC is the owner's call before T8 ships. WINDOWS.md and WINDOWS.es.md get the key and backup note with T8.
- Next: T6 (pending session, proxy gate, e2e fixtures).
- L27 (2026-11-20, owner): "Si, opción 1, y seguí con todo lo que falta, solo detente cuando necesites algo, corre todas las revisiones necesarias, no me preguntes." Standing consent for every Gentle AI review of the remaining units; key generation becomes S14, built with T8.
- L28 (2026-11-20, design for T6–T10, before any write). Grounded in `authenticate.ts`, `session.ts`, `proxy.ts`, `forced-change.ts`, `actions.ts` and `api/login/route.ts`.
  - **Storage (T6, migration 0041).**
    - `user_totp`: `user_id` PK, FK cascade. `secret_sealed`. `enabled_at`: null while enrolling. `last_step` bigint.
    - `recovery_codes`: `id`, `user_id` FK cascade, `code_hash`, `used_at`.
    - `sessions.pending`: null, `verify` or `enroll`.
    - `login_attempts.second_factor`: null, `totp`, `recovery` or `trusted_device`.
    - New `login_outcome` values: `password_ok` and `bad_code`.
    - Nothing is added to `users`, which is selected whole.
  - **Password step (T6).**
    - A correct password for a user with an enabled `user_totp` settles the attempt as `password_ok`, not `success`. A `success` resets the lock counter (S6), and an attacker who knows the password could otherwise alternate password and code guesses forever.
    - `password_ok` is neither a failure nor a reset in `lockedUntil`.
    - The session is issued with `pending = 'verify'` and a 10-minute expiry.
    - The `enroll` state and its gate land with T8, not T6 (L29).
  - **Proxy gate (T6).** This mirrors the forced password change.
    - `pending = 'verify'` comes first. Pages redirect to `/two-factor`. APIs answer 403 `second_factor_required`, except `/two-factor`, its API and `/api/logout`.
    - Then `mustChangePassword`.
    - These routes live outside `/login*`, which skips the proxy (L4).
  - **Second step (T7).**
    - A right code or an unused recovery code revokes the pending session and issues a fresh full one (no session fixation).
    - It updates the `password_ok` row to `success`, setting `at` to the verification time (L29) and `second_factor` (`totp` or `recovery`). It stores the TOTP step in `last_step` and marks the recovery code used.
    - The step has the same shape as `reserveLoginAttempt` (L29): it takes the user and IP advisory locks, refuses while either lock holds, and counts the attempt as a failure before it compares. A wrong code or recovery code then settles as `bad_code`, which counts toward the user lock (S6).
    - The access log reads `password_ok` as Fallido "Falta el código de verificación" and `bad_code` as Fallido "Código incorrecto". A success with `second_factor` reads "Con 2FA", "Con código de recuperación" or "Dispositivo de confianza".
  - **Enrolment (T8).**
    - `/two-factor/setup` and the `/account` section show a QR (`qrcode`, issuer = workshop name from `workshop_config`) and the base32 secret, then a code check, then the 10 recovery codes, shown once.
    - Optional for every role (S2) from `/account`, mandatory for `administrador` and `jefe_taller`. `pantalla` has none (A1).
    - S14: `standalone.ps1` creates `TOTP_ENCRYPTION_KEY` once, plus the WINDOWS.md and WINDOWS.es.md note on keeping a copy of `.env`.
  - **Trusted device (T9).** S3: "Recordar este dispositivo por 30 días" sets an httpOnly cookie holding a random token, stored hashed with `user_id` and `expires_at`. It skips the code and records `second_factor = 'trusted_device'`. A password change (S9) and a 2FA reset revoke every token (A5).
  - **Reset (T10).**
    - `POST /api/users/[id]/two-factor/reset` (`users.manage`) is refused for the caller's own id (S5). It deletes `user_totp` and `recovery_codes`, revokes sessions and trusted devices (A5), and logs a toast.
    - Gestión de usuarios gets a 2FA column (Activada, Desactivada, Pendiente) per the mockup.
    - `scripts/emergency.mjs reset-2fa <usuario>` does the same from the workshop PC (S13).
  - **Route.** The context backstop holds: this session is long. Each unit goes to one bounded writer, in order, because each depends on the previous one. The parent verifies, runs the reviews and merges.
- L29 (2026-11-20): the advisor's corrections to L28, applied above.
  - **A success is stamped at verification time.** The `password_ok` row turns into `success` with `at = now()`. Otherwise `bad_code` rows typed after the password would still count after a correct login, because `sinceLastReset` counts rows at or after the reset. Pin it with an e2e: two wrong codes, then a right one, leave the counter empty.
  - **The second step reserves before it compares and refuses while locked.** A pending session lives 10 minutes and several can exist. Single use is enforced in SQL: `last_step < step` and `used_at IS NULL`, checked by row count, with a concurrent e2e pair.
  - **The `enroll` gate moves to T8.** In T6 it would lock every `administrador` and `jefe_taller` out of the branch until enrolment exists. When it lands, it applies only while `mustChangePassword` is false, so the two screens cannot redirect to each other forever.
  - **T6 must find every caller of `validateSession` and every reader of the session cookie outside the proxy**, so none treats a pending session as full. Exempt paths match exactly. The verify action checks that its session is pending.
  - **Migration 0041 does not use the new enum values in the same migration.** Run it on a fresh database and on the dev database at 0040.
  - **Recorded for T8:**
    - `scripts/macos/dev.sh` and `standalone.sh` also copy `env.example`. e2e needs the key stubbed.
    - `navigator.clipboard` has no plain-HTTP support, so any copy button needs a fallback.
    - A missing key at the code step fails closed with a clear message.
    - Check mockup screen 4 for disable and regenerate actions, which need re-authentication. Mandatory roles cannot disable.
- L30 (2026-11-20, T6), written by a bounded writer; the parent read the `proxy.ts`, `session.ts` and `authenticate.ts` diffs in full.
  - **Storage.** Migration 0041 adds:
    - the `user_totp` and `recovery_codes` tables;
    - `sessions.pending` (`session_pending`);
    - `login_attempts.second_factor`;
    - the `password_ok` and `bad_code` outcomes.

    It does not use the new enum values, and it runs on a fresh database and on the dev database at 0040.
  - **Password step.** A correct password for a user with an enabled `user_totp` gets a 10-minute `verify` session and a `password_ok` attempt.
  - **Proxy gate.**
    - It runs before the forced change and alone decides a pending session, so the two screens cannot loop.
    - It matches exactly `/two-factor`, `/api/two-factor/verify` and `/api/logout`.
    - Blocked requests forward no identity.
  - **Access log.** It reads `password_ok` and `bad_code` as Fallido, and a success's `second_factor` as its detail.
  - **Checks.**
    - RED was observed by name for every rule except the `password_ok` lock test, which passed on its first run and is backed by a mutation.
    - Nine mutations were caught by name.
    - The 5 login e2e files pass 85/85 on `dforce_e2e`.
    - The suite passes 4962/4962, `tsc` is clean and lint shows 0 errors.
    - At the LAN IP, with curl and a QA user carrying an enabled `user_totp`:
      - the login returned `pending: "verify"`;
      - `/inventory` returned 307 to `/two-factor`;
      - `/api/account` returned 403 `second_factor_required`;
      - the attempt was `password_ok`;
      - the session was `verify` with 10 minutes left;
      - logout returned 200.

      A user without 2FA still gets a full session. QA rows were removed.
  - **Notes for T7.** `/two-factor` returns 404 until T7. Exempt paths forward `x-user-*`, so the verify route must read `pending` from the database, not from headers. `sinceLastReset` holds a second copy of the reset list in SQL. `STACK.md` should list the new tables.
- L31 (2026-11-20, T6). GGA passed. An independent verifier passed S2 (T6 scope) and S6 with no blockers. Its checks:
  - Path variants (trailing slash, case, encoding, `..`) against `handleProxy` with forged `x-user-id`: all blocked, with no identity forwarded.
  - Paths sent to the running server at the LAN IP: none reached a handler without the proxy.
  - Server actions: `loginAction` is the only one.
  - Migrations 0000–0041 on a fresh database, and `drizzle-kit check`.

  Fixed from its advisories: the pending TTL e2e now bounds the TTL from below too. A 1-second TTL fails it by name.

  Recorded for later:
  - The `enroll` gate must land in the same change that first issues `enroll` (T8).
  - The verify route must read `pending` from the database (T7).
- L32 (2026-11-20, T6): Gentle AI review (risk + reliability, granted under L27) APPROVED and acknowledged. Its advisory R1 is applied after the review, RED first: the proxy now gates any non-null `pending`, not only `verify`, so a later state (T8's `enroll`) fails closed. R3 (`/two-factor` is a 404 until T7) is expected and is closed by T7.

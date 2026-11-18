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
- S6. 5 failed attempts lock the user for 15 minutes; an administrator can unlock sooner.
- S7. 20 failed attempts from one IP in 15 minutes lock that IP.
- S8. Passwords need at least 10 characters and cannot be on a common-password list.
- S9. Changing a password revokes the user's other sessions.
- S10. Administrators see a log of login attempts at "Registro de accesos", under Configuración, below "Gestión de usuarios".
- S11. The `secure` cookie is enabled only once the HTTPS tunnel exists (deferred).
- S12. The screens, states and copy follow the approved mockup. Code input: one field, `inputmode="numeric"`, `autocomplete="one-time-code"`.
- S13. If the sole administrator loses the phone and the recovery codes, an emergency command that runs only on the workshop PC resets that user's 2FA. Owner, asked "¿Hago el comando de emergencia en la PC del taller?": "Si".

### Assumptions (not owner decisions yet)

- A1. `pantalla` has no 2FA: the role is not in S2 and cannot open `/account`.
- A2. A user who must change password does that first, then enrols.
- A3. Mandatory roles enrol at their next login; open sessions are not cut at rollout.
- A4. Passwords under 10 characters stay valid until their next change.
- A5. A 2FA reset also revokes that user's sessions and trusted devices.
- A6. Recovery codes use the mockup format `7KQM-2XPA`.
- A7. The IP lock and "Origen" are best-effort: on the direct LAN deployment `x-forwarded-for` can be forged by the client.

## Tasks

| ID | Specs | Work unit | Route | Status | Commit |
|---|---|---|---|---|---|
| T1 | S8, S9 | Password policy with server enforcement and fixtures | inline | in review | `feat/login-hardening-wu1-password-policy` |
| T2 | S6, S7 | Attempts table, IP helper, user and IP lock, shared cookie options | inline | pending | |
| T3 | S6, S12 | Lock message and admin unlock | inline | pending | |
| T4 | S10, S12 | Access log screen | inline | pending | |
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
- Follow-up: `scripts/seed-user.mjs` writes a hash without the policy; it is an install-time CLI, and its default `admin123` should be addressed with T8 enrolment.
- Next: T2.

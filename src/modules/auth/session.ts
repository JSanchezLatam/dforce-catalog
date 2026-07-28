import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";

import { db } from "@/shared/db/client";
import { sessions, users } from "@/shared/db/schema";

/** Cookie name shared by `proxy.ts` (reads it) and `/api/login` (sets it) — single source of truth. */
export const SESSION_COOKIE = "session";

import type { Role } from "./roles";

export type { Role };

/** Minimal identity `can()` and route handlers need — not the full `users` row. */
export type SessionUser = {
  id: string;
  role: Role;
  /**
   * Only ever set by `validateSession()` (design.md Decision 8 — zero-cost
   * ride on the existing `users` join). Absent (not `false`) when built from
   * forwarded proxy headers via `parseSessionUser()`, since the proxy does
   * not forward it and no route handler reads it yet — the forced-change
   * interception itself is WU3 scope, not this one.
   */
  mustChangePassword?: boolean;
};

/** Row shape `validateSession()`'s default query returns — the DB-free test seam's contract. */
export type SessionRow = {
  userId: string;
  role: Role;
  expiresAt: Date;
  revokedAt: Date | null;
  deactivatedAt: Date | null;
  mustChangePassword: boolean;
};

// ponytail: fixed 7-day session lifetime — no per-session TTL requirement exists yet;
// revisit if a spec requirement asks for configurable expiry.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** Pure — no DB access — so it's testable without a live Postgres connection. */
export function isSessionActive(session: { expiresAt: Date; revokedAt: Date | null }): boolean {
  return session.revokedAt === null && session.expiresAt.getTime() > Date.now();
}

/**
 * Pure — no DB access (design.md Decision 7). A deactivated user — INCLUDING
 * a deactivated administrador — has no valid session regardless of role;
 * this predicate is deliberately kept out of `policy.ts`'s `can()`, which
 * gates by role only.
 */
export function isUserActive(user: { deactivatedAt: Date | null }): boolean {
  return user.deactivatedAt === null;
}

export async function issueSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: token, userId, expiresAt });
  return { token, expiresAt };
}

async function queryDefaultSessionRow(token: string): Promise<SessionRow | undefined> {
  const rows = await db
    .select({
      userId: users.id,
      role: users.role,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      deactivatedAt: users.deactivatedAt,
      mustChangePassword: users.mustChangePassword,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, token))
    .limit(1);

  return rows[0];
}

/**
 * DB-backed session lookup (design.md — not a JWT). Returns null for any
 * invalid/expired/revoked token, and — design.md Decision 7 — for a
 * deactivated user's otherwise-valid session, reusing the exact same
 * "no valid session" path a browser/API client already handles.
 *
 * `queryFn` is an injectable seam (mirrors `revokeOtherSessions()`'s own
 * `queryFn` param) so this is testable without a live Postgres connection —
 * `vitest.config.ts` pins a fake `DATABASE_URL` and there is no DB in CI.
 */
export async function validateSession(
  token: string,
  queryFn: (token: string) => Promise<SessionRow | undefined> = queryDefaultSessionRow,
): Promise<SessionUser | null> {
  const row = await queryFn(token);
  if (!row || !isSessionActive(row) || !isUserActive(row)) {
    return null;
  }

  return { id: row.userId, role: row.role, mustChangePassword: row.mustChangePassword };
}

export async function revokeSession(token: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, token));
}

export async function revokeOtherSessions(
  userId: string,
  keepTokenId: string | null,
  queryFn?: (uid: string, keep: string | null) => Promise<void>,
): Promise<void> {
  if (queryFn) return queryFn(userId, keepTokenId);
  const now = new Date();
  const where_ = keepTokenId
    ? sql`user_id = ${userId} AND revoked_at IS NULL AND id <> ${keepTokenId}`
    : sql`user_id = ${userId} AND revoked_at IS NULL`;
  await db.execute(sql`UPDATE sessions SET revoked_at = ${now} WHERE ${where_}`);
}

function parseSessionUser(getHeader: (name: string) => string | null): SessionUser {
  const id = getHeader("x-user-id");
  const role = getHeader("x-user-role") as Role | null;
  if (!id || !role) {
    throw new Error(
      "requireSession() called on a request proxy.ts did not validate — check the matcher",
    );
  }
  return { id, role };
}

/**
 * Route-handler seam (design.md: "Route handlers call requireSession() then
 * can()"). Reads the identity `proxy.ts` already validated and forwarded
 * as headers — no second DB round-trip per request.
 */
export function requireSession(request: Request): SessionUser {
  return parseSessionUser((name) => request.headers.get(name));
}

/**
 * Server Component variant of `requireSession()` — Server Components don't
 * receive a `Request` object, only the ambient `headers()` Next.js exposes
 * (same headers `proxy.ts` forwarded). Same validation, different source.
 */
export async function requireSessionFromHeaders(): Promise<SessionUser> {
  const h = await headers();
  return parseSessionUser((name) => h.get(name));
}

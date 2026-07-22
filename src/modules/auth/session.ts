import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { sessions, users } from "@/shared/db/schema";

export type Role = "usuario" | "administrador";

/** Minimal identity `can()` and route handlers need — not the full `users` row. */
export type SessionUser = {
  id: string;
  role: Role;
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

export async function issueSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: token, userId, expiresAt });
  return { token, expiresAt };
}

/** DB-backed session lookup (design.md — not a JWT). Returns null for any invalid/expired/revoked token. */
export async function validateSession(token: string): Promise<SessionUser | null> {
  const rows = await db
    .select({
      userId: users.id,
      role: users.role,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, token))
    .limit(1);

  const row = rows[0];
  if (!row || !isSessionActive(row)) {
    return null;
  }

  return { id: row.userId, role: row.role };
}

export async function revokeSession(token: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, token));
}

/**
 * Route-handler seam (design.md: "Route handlers call requireSession() then
 * can()"). Reads the identity `middleware.ts` already validated and forwarded
 * as headers — no second DB round-trip per request.
 */
export function requireSession(request: Request): SessionUser {
  const id = request.headers.get("x-user-id");
  const role = request.headers.get("x-user-role") as Role | null;
  if (!id || !role) {
    throw new Error(
      "requireSession() called on a request middleware.ts did not validate — check the matcher",
    );
  }
  return { id, role };
}

/**
 * Drizzle schema.
 *
 * `users` + `sessions` land here in PR2 (auth). Remaining tables (`producto`,
 * `catalogs`, `template_config`, `sync_runs` — see design.md → "Database
 * Schema Outline") are added in later PRs, one module at a time, alongside
 * the code that uses them.
 */
import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** R9.6 / NFR-8 — single `role` column, extensible without an RBAC library. */
export const roleEnum = pgEnum("role", ["usuario", "administrador"]);

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  username: text("username").notNull().unique(),
  /** bcrypt hash, cost >= 12 (R9.5) — see modules/auth/password.ts. */
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("usuario"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  /** Opaque random token — see modules/auth/session.ts. Not a JWT (design.md). */
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** Set on explicit logout/revocation (R9.3); NULL = still active. */
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;

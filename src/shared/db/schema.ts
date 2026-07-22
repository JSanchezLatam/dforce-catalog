/**
 * Drizzle schema.
 *
 * `users` + `sessions` land here in PR2 (auth). `producto` + `sync_runs` land
 * in PR3 (inventory-sync). Remaining tables (`catalogs`, `template_config` —
 * see design.md → "Database Schema Outline") are added in later PRs, one
 * module at a time, alongside the code that uses them.
 */
import { index, integer, jsonb, pgEnum, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

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

/**
 * `producto` — JSONB raw + typed-projection hybrid (design.md → "Database
 * Schema Outline"). `raw` is the verbatim API payload and is the ONLY thing
 * that guarantees the round-trip property (R10.1-3): it is written once by
 * the mapper and never reshaped. The typed columns below are a best-effort
 * *projection* of `raw` for fast filtering (R3/R4) and are allowed to be
 * null when a field is missing/malformed — a projection miss must never
 * block storing `raw` (R10.4).
 */
export const producto = pgTable(
  "producto",
  {
    /** API product id — verbatim, used as PK for upsert-on-sync. */
    id: text("id").primaryKey(),
    raw: jsonb("raw").notNull().$type<Record<string, unknown>>(),
    name: text("name").notNull(),
    categoryL1: text("category_l1"),
    categoryL2: text("category_l2"),
    price: real("price"),
    stock: integer("stock"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // R3 (category filtering) + R4/NFR-2 (fast paginated list).
    index("producto_category_idx").on(table.categoryL1, table.categoryL2),
    index("producto_name_idx").on(table.name),
  ],
);

export const syncStatusEnum = pgEnum("sync_status", ["running", "completed", "failed"]);

/**
 * `sync_runs` — audit trail for R1.6/1.7 (weekly log) and R2.2 (manual
 * progress); also powers the explicit active-run check in
 * `modules/inventory-sync/job.ts` (Risk-6 — see design.md's "New Risks
 * Flagged" #6: pg-boss's `singletonKey` dedupes silently, so R2.5's
 * "already in progress" response needs its own source of truth).
 */
export const syncRuns = pgTable("sync_runs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: syncStatusEnum("status").notNull().default("running"),
  productCount: integer("product_count"),
  error: text("error"),
});

export type Producto = typeof producto.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;

/**
 * Drizzle schema.
 *
 * `users` + `sessions` land here in PR2 (auth). `producto` + `sync_runs` land
 * in PR3 (inventory-sync). `template_config` lands in PR5. `catalogs` lands
 * here in PR8 (catalog-storage) — see design.md → "Database Schema Outline".
 * Each table is added alongside the code that first needs it.
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
    /**
     * `real`, not `integer`/`numeric` — Interfuerza's `Available` field is a
     * decimal string (e.g. "-3.0000") summed across warehouses (see
     * inventory-sync/mapper.ts), and `real` keeps Drizzle's inferred
     * TypeScript type as `number | null` (unlike `numeric`, which infers
     * `string` and would cascade type changes into job.ts). See
     * interfuerza-api-contract-fix design.md.
     */
    stock: real("stock"),
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

/**
 * `template_config` — branding persisted across restarts (R8.1,8.2,8.4).
 *
 * ponytail: singleton-row-no-history — R8 only asks the system to remember
 * "the config that applies going forward" (the last saved one), not an audit
 * trail of past templates. If a future requirement asks for branding history
 * (e.g. "show what a catalog generated last month looked like"), promote this
 * to a real `id`-per-version table then — not before.
 */
export const templateConfig = pgTable("template_config", {
  id: text("id").primaryKey(),
  logoUrl: text("logo_url").notNull(),
  primaryColors: jsonb("primary_colors").notNull().$type<{ primary: string; secondary: string }>(),
  font: text("font").notNull(),
  coverText: text("cover_text").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TemplateConfig = typeof templateConfig.$inferSelect;

/**
 * `catalogs` — R7 (list/preview/download) + R11 (R2 upload, retention).
 *
 * `id` is minted by pdf-generation/enqueue.ts (`crypto.randomUUID()`) purely
 * as a job/queue correlation id (PR7) — this row is inserted by
 * pdf-generation/worker.ts right after render+handoff, BEFORE the
 * `pdf-upload` job is even sent, with `uploadStatus: "pending"` (Risk-1,
 * design.md's "New Risks Flagged" #1: makes a crash mid-upload-retry visible
 * as a queryable row instead of a silently orphaned local temp file, rather
 * than fully solving durability). `uploadStatus` then walks
 * pending -> uploading -> uploaded|failed, driven by
 * catalog-storage/upload-status.ts.
 *
 * `categories` is a denormalized snapshot (categoryL1/categoryL2 pairs) of
 * the selection at generation time — sufficient for R7.1's "name, date,
 * categories" listing without re-joining `producto`; it does NOT persist the
 * full product selection, so "regenerate" (R7.5) is a link back to
 * `/builder`, not an automatic replay (see app/catalogs/page.tsx).
 */
export const uploadStatusEnum = pgEnum("upload_status", ["pending", "uploading", "uploaded", "failed"]);

export const catalogs = pgTable(
  "catalogs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    categories: jsonb("categories").notNull().$type<{ categoryL1: string; categoryL2: string | null }[]>(),
    productsPerPage: integer("products_per_page").notNull(),
    uploadStatus: uploadStatusEnum("upload_status").notNull().default("pending"),
    r2Key: text("r2_key"),
    r2Url: text("r2_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // R11.2 retention (oldest-first per user) + R7.1 listing (own catalogs, newest first).
    index("catalogs_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export type Catalog = typeof catalogs.$inferSelect;

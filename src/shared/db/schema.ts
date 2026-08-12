/**
 * Drizzle schema.
 *
 * `users` + `sessions` land here in PR2 (auth). `producto` + `sync_runs` land
 * in PR3 (inventory-sync). `template_config` lands in PR5. `catalogs` lands
 * here in PR8 (catalog-storage) — see design.md → "Database Schema Outline".
 * Each table is added alongside the code that first needs it.
 */
import { boolean, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

/** R9.6 / NFR-8 — single `role` column, extensible without an RBAC library. */
export const roleEnum = pgEnum("role", ["tecnico", "administrador"]);

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  username: text("username").notNull().unique(),
  /** bcrypt hash, cost >= 12 (R9.5) — see modules/auth/password.ts. */
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("tecnico"),
  name: text("name"),
  email: text("email").unique(),
  // reserved for the crm-shell-settings-rbac user-management follow-up — no v1 code path reads or writes this
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  // reserved for the crm-shell-settings-rbac user-management follow-up — no v1 code path reads or writes this
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;

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

export type Session = typeof sessions.$inferSelect;

/**
 * `workshop_config` — singleton row holding the workshop display name,
 * logo (uploaded to R2, served through /api/workshop-config/logo), and
 * contact info shown on generated catalogs (catalog-templates-and-workshop-info
 * WU1). `coverText` moved here from `template_config` — the template owns the
 * FORM, the workshop owns the CONTENT (design.md D5/workshop-settings spec).
 * All contact columns are nullable: the Administrador may set any subset
 * independently (partial-field-touch upsert, see workshop-config/service.ts).
 */
export const workshopConfig = pgTable("workshop_config", {
  id: text("id").primaryKey().default("singleton"),
  name: text("name"),
  logoR2Key: text("logo_r2_key"),
  logoContentType: text("logo_content_type"),
  phone: text("phone"),
  whatsapp: text("whatsapp"),
  email: text("email"),
  address: text("address"),
  /** Free-text, e.g. "Lun-Vie 9-18, Sáb 9-13" — no structured per-day schedule (spec: "Hours is one free-text field"). */
  hours: text("hours"),
  website: text("website"),
  coverText: text("cover_text"),
  /** Open-ended platform → handle map (e.g. `{instagram: "@..."}`) — a new platform needs no migration. */
  socialHandles: jsonb("social_handles").$type<Record<string, string>>(),
  /**
   * Catalog cover photo (catalog-templates-and-workshop-info WU5, design D6)
   * — same R2-key + content-type pair as `logoR2Key`/`logoContentType`,
   * uploaded through the same route pattern (`api/workshop-config/cover-image/
   * route.ts`, mirrors `logo/route.ts`). Null renders no cover photo — the
   * cover degrades to the template's red/black block, never a broken `<img>`.
   */
  coverImageR2Key: text("cover_image_r2_key"),
  coverImageContentType: text("cover_image_content_type"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkshopConfig = typeof workshopConfig.$inferSelect;

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
    /** 'transparent' | 'opaque' | 'low_res' | null — classified at sync time by inventory-sync/mapper.ts heuristic. Null means unclassified/no image available. */
    imageType: text("image_type"),
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
 * `template_config` — R8.1/8.2/8.4. Shrunk by catalog-templates-and-workshop-info
 * WU3's migration `0009`: font/colours/logo/cover-text are no longer here —
 * font and colours are template-FIXED (the code registry, `shared/template/
 * registry.ts`), and logo/cover-text are workshop-OWNED (`workshop_config`,
 * see that table's comment). This table now holds only the admin's
 * SELECTION among templates plus the one remaining per-generation toggle.
 *
 * ponytail: singleton-row-no-history — R8 only asks the system to remember
 * "the config that applies going forward" (the last saved one), not an audit
 * trail of past templates. If a future requirement asks for branding history
 * (e.g. "show what a catalog generated last month looked like"), promote this
 * to a real `id`-per-version table then — not before.
 */
export const templateConfig = pgTable("template_config", {
  id: text("id").primaryKey(),
  /** 'strict' | 'adaptive' — strict forces all products to OpaqueProductCard; adaptive selects card based on each product's image_type. Null defaults to 'strict' (backward compat). */
  defaultImageHandling: text("default_image_handling"),
  /** Registry template id (WU2+) — NULL resolves to the default template via `getTemplate(null)`. */
  selectedTemplateId: text("selected_template_id"),
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

/**
 * crm-workshop-management — customers, service orders, line items, reminders.
 * See openspec/changes/archive/crm-workshop-management/design.md → "Data Model" for
 * the full rationale (ADR-5 opt-out re-check, ADR-6 inline vehicle + FK
 * restrict, ADR-7 line-item snapshot, ADR-8 retry idempotency).
 */
export const orderStatusEnum = pgEnum("order_status", ["open", "in_progress", "done", "cancelled"]);
export const reminderTypeEnum = pgEnum("reminder_type", ["service_due", "appointment"]);
export const reminderChannelEnum = pgEnum("reminder_channel", ["email", "whatsapp"]);
export const reminderStatusEnum = pgEnum("reminder_status", [
  "scheduled",
  "sent",
  "failed",
  "cancelled",
  "skipped",
  // R26 — per-channel opt-out is a distinct outcome from the generic
  // `skipped` (cancelled order, stale timing) so staff never conflate
  // "customer declined this channel" with an operational skip reason.
  // Added additively in migration 0006 (Postgres ALTER TYPE ... ADD VALUE) —
  // the enum's first 5 values already have committed rows via 0005_legal_spot.sql.
  "opted_out",
]);

/**
 * `cliente` — customer + inline single vehicle (v1, ADR-6). A separate
 * `vehiculo` table is deferred until a customer needs more than one vehicle
 * (YAGNI — see design.md ADR-6).
 */
export const cliente = pgTable(
  "cliente",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    /** E.164 preferred (WhatsApp needs it); validated in modules/customers/validation.ts. */
    phone: text("phone"),
    email: text("email"),
    vehicleMake: text("vehicle_make"),
    vehicleModel: text("vehicle_model"),
    vehicleYear: integer("vehicle_year"),
    vehiclePlate: text("vehicle_plate"),
    /**
     * Two INDEPENDENT opt-out flags (R26, design ADR-5) — WhatsApp and email
     * are legally distinct consent regimes, so a customer can decline one
     * channel without losing the other. Re-checked at reminder fire time,
     * not schedule time.
     */
    whatsappOptOut: boolean("whatsapp_opt_out").notNull().default(false),
    emailOptOut: boolean("email_opt_out").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("cliente_name_idx").on(table.name), // list search by name
    index("cliente_plate_idx").on(table.vehiclePlate), // lookup by plate
    index("cliente_created_idx").on(table.createdAt), // newest-first listing
  ],
);

export type Cliente = typeof cliente.$inferSelect;

/** `orden_servicio` — service order. */
export const ordenServicio = pgTable(
  "orden_servicio",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clienteId: text("cliente_id")
      .notNull()
      .references(() => cliente.id, { onDelete: "restrict" }), // protect history (ADR-6)
    status: orderStatusEnum("status").notNull().default("open"),
    description: text("description"),
    appointmentAt: timestamp("appointment_at", { withTimezone: true }), // basis for "appointment" reminders
    completedAt: timestamp("completed_at", { withTimezone: true }), // set on -> done; basis for "service_due"
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // per-customer history, mirrors catalogs_user_created_idx
    index("orden_cliente_created_idx").on(table.clienteId, table.createdAt),
    index("orden_status_idx").on(table.status),
  ],
);

export type OrdenServicio = typeof ordenServicio.$inferSelect;

/**
 * `orden_servicio_item` — parts used on a service order (ADR-7). `productName`
 * and `unitPrice` are a snapshot at time of use so a later inventory sync
 * that renames/reprices a part does NOT rewrite historical orders (same
 * philosophy as `catalogs.categories` / `producto.raw`). No stock deduction
 * (explicitly out of scope in the proposal).
 */
export const ordenServicioItem = pgTable(
  "orden_servicio_item",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ordenId: text("orden_id")
      .notNull()
      .references(() => ordenServicio.id, { onDelete: "cascade" }), // items die with the order
    productoId: text("producto_id").references(() => producto.id, { onDelete: "set null" }), // soft ref — re-sync must not delete history
    productName: text("product_name").notNull(), // snapshot at time of use
    unitPrice: real("unit_price"), // snapshot; `real` per producto.price convention
    quantity: integer("quantity").notNull().default(1),
  },
  (table) => [index("orden_item_orden_idx").on(table.ordenId)],
);

export type OrdenServicioItem = typeof ordenServicioItem.$inferSelect;

/**
 * `reminder` — source of truth for scheduled reminders (ADR-2); the pg-boss
 * `sendAfter` job is transport only, carrying `{ reminderId }`. `jobId` is
 * stored for later cancellation/correlation (design.md → pg-boss Job Design).
 */
export const reminder = pgTable(
  "reminder",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ordenId: text("orden_id")
      .notNull()
      .references(() => ordenServicio.id, { onDelete: "cascade" }),
    clienteId: text("cliente_id")
      .notNull()
      .references(() => cliente.id, { onDelete: "cascade" }),
    type: reminderTypeEnum("type").notNull(),
    channel: reminderChannelEnum("channel").notNull(),
    status: reminderStatusEnum("status").notNull().default("scheduled"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    jobId: text("job_id"), // pg-boss job id returned by sendAfter() — for correlation + cancellation
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("reminder_orden_idx").on(table.ordenId),
    index("reminder_status_sched_idx").on(table.status, table.scheduledFor),
  ],
);

export type Reminder = typeof reminder.$inferSelect;

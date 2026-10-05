/**
 * Drizzle schema.
 *
 * `users` + `sessions` land here in PR2 (auth). `producto` + `sync_runs` land
 * in PR3 (inventory-sync). `template_config` lands in PR5. `catalogs` lands
 * here in PR8 (catalog-storage) — see design.md → "Database Schema Outline".
 * Each table is added alongside the code that first needs it.
 */
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
   * LEGACY: nothing reads or writes these since catalog-cover-templates WU3
   * (each template owns its photo in `template_cover_image`; migration `0020`
   * copied this one into Clásico's row). Kept so a rollback still has the data.
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
 * One cover photo per template (catalog-cover-templates WU3a): a shared photo
 * always ruined one of the covers. `template_id` is the registry id and has no
 * FK because registry ids live in code (`shared/template/template-ids.ts`). A
 * missing row means "no photo" — there is no runtime fallback to the legacy
 * `workshop_config.cover_image_*` columns; migration `0020` copied them once.
 */
export const templateCoverImage = pgTable("template_cover_image", {
  templateId: text("template_id").primaryKey(),
  r2Key: text("r2_key").notNull(),
  contentType: text("content_type"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TemplateCoverImage = typeof templateCoverImage.$inferSelect;

/**
 * `catalogs` — R7 (list/preview/download) + R11 (R2 upload, retention).
 *
 * `id` is minted by the generate route (api/catalog-builder/generate/
 * route.ts, `crypto.randomUUID()` — server-side, so the LAN's insecure
 * context does not apply) and doubles as the job correlation id. This row is
 * inserted `pending` by pdf-generation/enqueue.ts, in the same advisory-locked
 * transaction that sends the `pdf-generate` job (Risk-1, design.md's "New
 * Risks Flagged" #1), so it is visible on /catalogs from the moment Generar
 * returns. `uploadStatus` then walks pending -> uploading -> uploaded|failed:
 * pdf-generation/worker.ts sets `failed` when the render's final attempt
 * fails, catalog-storage/upload-status.ts drives the rest.
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
/**
 * `orden_categoria` — service type vocabulary (C4, design.md D3). Unaccented
 * Spanish slugs, same convention `roleEnum` already established
 * (`"tecnico"`, not `"técnico"`). REVISADO is Panama's mandatory annual ATTT
 * technical inspection, modeled as a peer service type, not a status — it is
 * independent of `orderStatusEnum`. Append-only once real orders exist:
 * renaming/removing a value needs a hand-written migration (drizzle-kit
 * cannot infer an enum-value rename, precedent: `roleEnum`'s rename).
 */
export const ordenCategoriaEnum = pgEnum("orden_categoria", [
  "instalacion",
  "mant_preventivo",
  "mant_correctivo",
  "reparacion",
  "revisado",
]);
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

export const customerImportStatusEnum = pgEnum("customer_import_status", ["running", "completed", "failed"]);

/**
 * `customer_import_runs` — layer-1 concurrency guard for
 * `modules/customer-import/job.ts`'s `runCustomerImport`. Same shape and same
 * purpose as `sync_runs` above: a `status = 'running'` row is this feature's
 * own source of truth for "is one already going", checked by
 * `buildStartImportRunStatement`'s `WHERE NOT EXISTS` BEFORE the Interfuerza
 * fetch even starts, so a second concurrent request doesn't spend another
 * ~15 requests against an API that carries a real 1h IP ban.
 *
 * This is explicitly NOT the correctness guarantee — even folded into one
 * statement, it is not a unique constraint or an explicit lock (see that
 * function's docstring for the residual window). The actual guarantee against
 * duplicate customers is the `pg_advisory_xact_lock` taken inside the write
 * transaction, before `listExisting`, in `job.ts`.
 */
export const customerImportRuns = pgTable("customer_import_runs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: customerImportStatusEnum("status").notNull().default("running"),
  created: integer("created"),
  updated: integer("updated"),
  skippedCount: integer("skipped_count"),
  error: text("error"),
});

export type CustomerImportRun = typeof customerImportRuns.$inferSelect;

/**
 * `cliente` — customer. Originally shipped with one inline vehicle (v1,
 * ADR-6); superseded by the `vehiculo` child table below
 * (vehicles-one-to-many, C3) — the four inline vehicle columns and
 * `cliente_plate_idx` were dropped by migration `0014` (slice 3,
 * expand/contract's contract step). A vehicle is now always a `vehiculo` row.
 */
export const cliente = pgTable(
  "cliente",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    /**
     * Two write paths, two shapes. The app form goes through
     * `normalizePhone`, so `6123-4567` is stored as `61234567`. The customer
     * import does NOT (`customer-import/plan.ts` writes the mapper's output
     * straight through, by design D4), so the same number is stored
     * `6123-4567`, separators and all. Anything reading this column has to
     * tolerate both — the search and the duplicate check especially.
     *
     * Neither shape is E.164: `reminders/providers/whatsapp.ts` converts at
     * the wire, because that is a provider format. Validated in
     * modules/customers/validation.ts, which has always REQUIRED a phone — the
     * column only stopped disagreeing in migration `0016`. Not UNIQUE, and
     * deliberately so: a phone can belong to two people (a house line, a
     * shared handset). See `customer-shared-phones`.
     */
    phone: text("phone").notNull(),
    email: text("email"),
    /**
     * Cédula / RUC, free text (service-order-reception). Optional, capped at 30
     * characters in `customers/validation.ts` only — NOT a CHECK, NOT UNIQUE,
     * same stance as `phone`: cédulas, RUCs and passports vary in shape and
     * relatives share documents. The customer import never writes it.
     */
    documentoIdentidad: text("documento_identidad"),
    /**
     * Interfuerza's `Cliente` value (customer-import D2) — nullable because
     * every customer created through the app has none, and that stays the
     * normal case going forward; this column marks provenance, not a
     * requirement. Not UNIQUE at the database level, for the same reason
     * `phone` above is not: the import matches on it in application code, and
     * one more unique index is one more thing that rejects a legitimate row
     * later.
     *
     * `Token` is NOT the identifier despite the name — it is empty on all 370
     * live rows. Written here because the next person will reach for it.
     */
    externalId: text("external_id"),
    /**
     * Two INDEPENDENT opt-out flags (R26, design ADR-5) — WhatsApp and email
     * are legally distinct consent regimes, so a customer can decline one
     * channel without losing the other. Re-checked at reminder fire time,
     * not schedule time.
     */
    whatsappOptOut: boolean("whatsapp_opt_out").notNull().default(false),
    emailOptOut: boolean("email_opt_out").notNull().default(false),
    /**
     * NULL = active; stamped on deactivation (`customer-deactivation` D1).
     * A nullable timestamp, NOT a boolean — the third table in this codebase
     * to spell soft delete this way, after `users` and `vehiculo`.
     *
     * Deactivation is REVERSIBLE and nothing is ever destroyed: every
     * `vehiculo` and every `orden_servicio` of a deactivated customer
     * survives untouched. `queries.ts` owns the default exclusion; a customer
     * is hidden from the list and the service-order picker, and
     * `reminders/job.ts` refuses to send to them at fire time.
     */
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("cliente_name_idx").on(table.name), // list search by name
    index("cliente_created_idx").on(table.createdAt), // newest-first listing
  ],
);

export type Cliente = typeof cliente.$inferSelect;

/**
 * `vehiculo` — a `cliente`'s vehicle collection (vehicles-one-to-many, C3,
 * design.md D1/D3). Child table, not JSONB — C4's `orden_servicio.vehiculo_id`
 * needs a real FK target (D1). `cliente_id` cascades on delete: vehicles have
 * no independent lifecycle.
 *
 * `deactivatedAt` is a nullable timestamp, NOT a boolean (D3) — copies the
 * `users.deactivated_at` convention already in this codebase (`isUserActive()`,
 * `isNull(...)` filters, `deactivateUser`/`reactivateUser`). NULL = active.
 * Sole owner of reads/writes: `src/modules/customers/vehicles.ts` (slice 2).
 */
export const vehiculoMotorEnum = pgEnum("vehiculo_motor", ["combustion", "electrico", "hibrido"]);

export const vehiculo = pgTable(
  "vehiculo",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clienteId: text("cliente_id")
      .notNull()
      .references(() => cliente.id, { onDelete: "cascade" }),
    make: text("make"),
    model: text("model"),
    year: integer("year"),
    /** Required per vehicle (R17) — a vehicle without a plate has no reason to exist. */
    plate: text("plate").notNull(),
    chasis: text("chasis"),
    colorPrimario: text("color_primario"),
    colorSecundario: text("color_secundario"),
    /** Validated against `ESTILO_OPTIONS` in code, not a pgEnum: the list is curated and may change. */
    estilo: text("estilo"),
    motor: vehiculoMotorEnum("motor"),
    numeroUnidad: text("numero_unidad"),
    /** INTERNAL (needs `vencimientos.read`): month 1..12 the plate renews. Never on an order, a sheet, or a public route. */
    placaRenovacionMes: smallint("placa_renovacion_mes"),
    /** INTERNAL: insurance expiry as a `YYYY-MM-DD` string (string mode: no `Date`, no timezone shift). */
    seguroVence: date("seguro_vence", { mode: "string" }),
    /** NULL = active; stamped on soft delete. See table doc comment above. */
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  /**
   * `cliente_id` only. Every read path filters on it (D4's `EXISTS`, the
   * `array_agg` plates subselect) and `ON DELETE CASCADE` seq-scans this table
   * per parent delete without it. No index on bare `plate`: R19 searches
   * `unaccent("plate") ILIKE unaccent($1)`, an expression predicate a plain
   * btree on the raw column cannot serve. Add an exact-plate index when an
   * exact-plate lookup actually appears.
   */
  (table) => [
    index("vehiculo_cliente_idx").on(table.clienteId),
    check("vehiculo_placa_renovacion_mes_range", sql`${table.placaRenovacionMes} between 1 and 12`),
  ],
);

export type Vehiculo = typeof vehiculo.$inferSelect;

export const vencimientoKindEnum = pgEnum("vencimiento_kind", ["placa", "seguro"]);

/**
 * `vehiculo_contacto` — one row per "Contactado" mark (vehicle-details-and-renewals).
 * The composite PK IS the uniqueness rule: a mark is per vehicle, kind and
 * period (`YYYY-MM` for a plate, the expiry date for insurance), so a mark for
 * one period never hides a later one and a double insert is a no-op
 * (`onConflictDoNothing`). Cascades with the vehicle; `contacted_by` survives
 * the user's deletion as NULL.
 */
export const vehiculoContacto = pgTable(
  "vehiculo_contacto",
  {
    vehiculoId: text("vehiculo_id")
      .notNull()
      .references(() => vehiculo.id, { onDelete: "cascade" }),
    kind: vencimientoKindEnum("kind").notNull(),
    periodKey: text("period_key").notNull(),
    contactedAt: timestamp("contacted_at", { withTimezone: true }).notNull().defaultNow(),
    contactedBy: text("contacted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [primaryKey({ columns: [table.vehiculoId, table.kind, table.periodKey] })],
);

export type VehiculoContacto = typeof vehiculoContacto.$inferSelect;

/**
 * `orden_servicio` — service order. `vehiculoId`/`categoria`/the three note
 * columns land in C4 (design.md D5, migration `0015`) — added once `orden_servicio`
 * held 0 rows, which is why `vehiculoId`/`categoria` can be NOT NULL with no
 * backfill.
 */
export const ordenServicio = pgTable(
  "orden_servicio",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clienteId: text("cliente_id")
      .notNull()
      .references(() => cliente.id, { onDelete: "restrict" }), // protect history (ADR-6)
    // C4 — every order names exactly one vehicle of its customer's; RESTRICT
    // is the backstop, `customers/vehicles.ts#applyVehiculoPlan`'s SEAM is
    // what turns a blocked delete into Spanish copy instead of a raw 500.
    vehiculoId: text("vehiculo_id")
      .notNull()
      .references(() => vehiculo.id, { onDelete: "restrict" }),
    status: orderStatusEnum("status").notNull().default("open"),
    // C4 — no default: silently mis-filing an order under a guessed category
    // is worse than forcing staff to choose one (design.md D5).
    categoria: ordenCategoriaEnum("categoria").notNull(),
    description: text("description"),
    appointmentAt: timestamp("appointment_at", { withTimezone: true }), // basis for "appointment" reminders
    completedAt: timestamp("completed_at", { withTimezone: true }), // set on -> done; basis for "service_due"
    // C4 — technician findings, written only at completion (never at creation).
    hallazgos: text("hallazgos"),
    recomendaciones: text("recomendaciones"),
    observaciones: text("observaciones"),
    // service-order-reception — vehicle intake, all optional. `nivel_combustible`
    // is a quarter-tank step (0 = Vacío … 4 = Lleno); the ranges are enforced
    // here as well as in `service-orders/intake.ts`.
    kilometraje: integer("kilometraje"),
    nivelCombustible: smallint("nivel_combustible"),
    bateriaPct: smallint("bateria_pct"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("orden_kilometraje_range", sql`${table.kilometraje} between 0 and 2000000`),
    check("orden_nivel_combustible_range", sql`${table.nivelCombustible} between 0 and 4`),
    check("orden_bateria_pct_range", sql`${table.bateriaPct} between 0 and 100`),
    // per-customer history, mirrors catalogs_user_created_idx
    index("orden_cliente_created_idx").on(table.clienteId, table.createdAt),
    index("orden_status_idx").on(table.status),
    // C4 — per-vehicle history (WU3's listOrdenesByVehiculo), the SEAM's
    // inArray check, and ON DELETE RESTRICT's per-delete referencing scan.
    index("orden_vehiculo_created_idx").on(table.vehiculoId, table.createdAt),
  ],
);

export type OrdenServicio = typeof ordenServicio.$inferSelect;

/**
 * `orden_servicio_foto` — reception photos (service-order-reception). The id is
 * set by `service-orders/photos.ts` (a server-side `crypto.randomUUID()`, never
 * the client's) and is also the R2 object name, so there is no `content_type`
 * column: only JPEG is accepted. `position` is assigned under a row lock on the
 * parent order; the unique index backs that lock up and orders the list.
 */
export const ordenServicioFoto = pgTable(
  "orden_servicio_foto",
  {
    id: text("id").primaryKey(),
    ordenId: text("orden_id")
      .notNull()
      .references(() => ordenServicio.id, { onDelete: "cascade" }), // photos die with the order
    r2Key: text("r2_key").notNull(),
    position: smallint("position").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("orden_servicio_foto_orden_position_idx").on(table.ordenId, table.position)],
);

export type OrdenServicioFoto = typeof ordenServicioFoto.$inferSelect;

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

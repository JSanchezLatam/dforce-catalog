import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  cliente,
  orderStatusEnum,
  ordenServicio,
  ordenServicioItem,
  reminder,
  reminderChannelEnum,
  reminderStatusEnum,
  reminderTypeEnum,
  roleEnum,
  users,
  vehiculo,
  workshopConfig,
} from "./schema";

/** Find a column in a `getTableConfig(...)` result by its DB column name (snake_case). */
function findColumn(columns: ReturnType<typeof getTableConfig>["columns"], name: string) {
  const column = columns.find((c) => c.name === name);
  if (!column) throw new Error(`Column "${name}" not found`);
  return column;
}

/** Find an index in a `getTableConfig(...)` result by its index name. */
function findIndex(indexes: ReturnType<typeof getTableConfig>["indexes"], name: string) {
  const found = indexes.find((i) => i.config.name === name);
  if (!found) throw new Error(`Index "${name}" not found`);
  return found;
}

describe("schema — role enum (renamed in crm-shell-settings-rbac WU1)", () => {
  it("roleEnum has exactly the 2 renamed values (usuario → tecnico)", () => {
    expect(roleEnum.enumValues).toEqual(["tecnico", "administrador"]);
  });
});

describe("schema — users extended columns (crm-shell-settings-rbac WU1)", () => {
  const config = getTableConfig(users);

  it("name is nullable (added for display name)", () => {
    expect(findColumn(config.columns, "name").notNull).toBe(false);
  });

  it("email is nullable but unique", () => {
    const email = findColumn(config.columns, "email");
    expect(email.notNull).toBe(false);
    expect(email.isUnique).toBe(true);
  });

  it("deactivatedAt is nullable (reserved for follow-up)", () => {
    expect(findColumn(config.columns, "deactivated_at").notNull).toBe(false);
  });

  it("mustChangePassword is notNull with default false (reserved for follow-up)", () => {
    const col = findColumn(config.columns, "must_change_password");
    expect(col.notNull).toBe(true);
    expect(col.default).toBe(false);
  });
});

describe("schema — workshop_config singleton table", () => {
  const config = getTableConfig(workshopConfig);

  it("is named 'workshop_config'", () => {
    expect(config.name).toBe("workshop_config");
  });

  it("has an id column (singleton key)", () => {
    const id = findColumn(config.columns, "id");
    expect(id.notNull).toBe(true);
  });

  it("has nullable name, logoR2Key, logoContentType", () => {
    expect(findColumn(config.columns, "name").notNull).toBe(false);
    expect(findColumn(config.columns, "logo_r2_key").notNull).toBe(false);
    expect(findColumn(config.columns, "logo_content_type").notNull).toBe(false);
  });

  it("has updatedAt with default now", () => {
    const col = findColumn(config.columns, "updated_at");
    expect(col.notNull).toBe(true);
    expect(col.default).toBeDefined();
  });
});

describe("schema — crm-workshop-management enums (Phase 1, task 1.1)", () => {
  it("order_status enum has exactly the 4 lifecycle values", () => {
    expect(orderStatusEnum.enumValues).toEqual(["open", "in_progress", "done", "cancelled"]);
  });

  it("reminder_type enum has exactly the 2 milestone values", () => {
    expect(reminderTypeEnum.enumValues).toEqual(["service_due", "appointment"]);
  });

  it("reminder_channel enum has exactly the 2 channel values", () => {
    expect(reminderChannelEnum.enumValues).toEqual(["email", "whatsapp"]);
  });

  it("reminder_status enum has exactly the 6 lifecycle values (opted_out added post-Phase-4 for R26)", () => {
    expect(reminderStatusEnum.enumValues).toEqual(["scheduled", "sent", "failed", "cancelled", "skipped", "opted_out"]);
  });
});

describe("schema — cliente table (Phase 1, task 1.2)", () => {
  const config = getTableConfig(cliente);

  it("is named 'cliente'", () => {
    expect(config.name).toBe("cliente");
  });

  it("has TWO independent opt-out booleans (R26) — not a single combined flag", () => {
    const whatsappOptOut = findColumn(config.columns, "whatsapp_opt_out");
    const emailOptOut = findColumn(config.columns, "email_opt_out");

    expect(whatsappOptOut.columnType).toBe("PgBoolean");
    expect(whatsappOptOut.notNull).toBe(true);
    expect(whatsappOptOut.default).toBe(false);

    expect(emailOptOut.columnType).toBe("PgBoolean");
    expect(emailOptOut.notNull).toBe(true);
    expect(emailOptOut.default).toBe(false);

    // Two distinct columns, not one combined flag.
    expect(whatsappOptOut.name).not.toBe(emailOptOut.name);
  });

  it("has nullable contact/vehicle fields (name is the only required field)", () => {
    expect(findColumn(config.columns, "name").notNull).toBe(true);
    expect(findColumn(config.columns, "phone").notNull).toBe(false);
    expect(findColumn(config.columns, "email").notNull).toBe(false);
    expect(findColumn(config.columns, "vehicle_make").notNull).toBe(false);
    expect(findColumn(config.columns, "vehicle_model").notNull).toBe(false);
    expect(findColumn(config.columns, "vehicle_year").notNull).toBe(false);
    expect(findColumn(config.columns, "vehicle_plate").notNull).toBe(false);
  });

  it("has name/plate/createdAt indexes for list search + newest-first listing", () => {
    const nameIdx = findIndex(config.indexes, "cliente_name_idx");
    const plateIdx = findIndex(config.indexes, "cliente_plate_idx");
    const createdIdx = findIndex(config.indexes, "cliente_created_idx");

    expect(nameIdx.config.columns.map((c) => (c as { name: string }).name)).toEqual(["name"]);
    expect(plateIdx.config.columns.map((c) => (c as { name: string }).name)).toEqual(["vehicle_plate"]);
    expect(createdIdx.config.columns.map((c) => (c as { name: string }).name)).toEqual(["created_at"]);
  });

  it("still has its 4 inline vehicle columns + cliente_plate_idx — vehicles-one-to-many slice 1 does not touch cliente", () => {
    expect(findColumn(config.columns, "vehicle_make").notNull).toBe(false);
    expect(findColumn(config.columns, "vehicle_model").notNull).toBe(false);
    expect(findColumn(config.columns, "vehicle_year").notNull).toBe(false);
    expect(findColumn(config.columns, "vehicle_plate").notNull).toBe(false);
    expect(() => findIndex(config.indexes, "cliente_plate_idx")).not.toThrow();
  });
});

describe("schema — vehiculo table (vehicles-one-to-many, Phase 1 slice 1)", () => {
  const config = getTableConfig(vehiculo);

  it("is named 'vehiculo'", () => {
    expect(config.name).toBe("vehiculo");
  });

  it("has id/clienteId/make/model/year/plate/deactivatedAt/createdAt columns", () => {
    expect(findColumn(config.columns, "id").primary).toBe(true);
    expect(findColumn(config.columns, "cliente_id").notNull).toBe(true);
    expect(findColumn(config.columns, "make").notNull).toBe(false);
    expect(findColumn(config.columns, "model").notNull).toBe(false);
    expect(findColumn(config.columns, "year").notNull).toBe(false);
    expect(findColumn(config.columns, "plate").notNull).toBe(true);
    // D3 — nullable timestamp, not a boolean. NULL = active.
    const deactivatedAt = findColumn(config.columns, "deactivated_at");
    expect(deactivatedAt.columnType).toBe("PgTimestamp");
    expect(deactivatedAt.notNull).toBe(false);
    expect(findColumn(config.columns, "created_at").notNull).toBe(true);
  });

  it("does NOT have a boolean 'active' column — the spec's earlier draft is stale", () => {
    expect(config.columns.some((c) => c.name === "active")).toBe(false);
  });

  it("clienteId FK cascades on delete (D1 — vehicles have no independent lifecycle)", () => {
    const fk = config.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "cliente_id"));
    if (!fk) throw new Error("cliente_id foreign key not found");
    expect(fk.onDelete).toBe("cascade");
  });

  it("has a vehiculo_plate_idx index on plate", () => {
    const idx = findIndex(config.indexes, "vehiculo_plate_idx");
    expect(idx.config.columns.map((c) => (c as { name: string }).name)).toEqual(["plate"]);
  });
});

describe("schema — orden_servicio table (Phase 1, task 1.3)", () => {
  const config = getTableConfig(ordenServicio);

  it("is named 'orden_servicio'", () => {
    expect(config.name).toBe("orden_servicio");
  });

  it("clienteId FK uses onDelete 'restrict' to protect service history", () => {
    const fk = config.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "cliente_id"));
    if (!fk) throw new Error("cliente_id foreign key not found");
    expect(fk.onDelete).toBe("restrict");
  });

  it("status defaults to 'open' and is not nullable", () => {
    const status = findColumn(config.columns, "status");
    expect(status.notNull).toBe(true);
    expect(status.default).toBe("open");
  });

  it("has (clienteId, createdAt) composite index and a status index", () => {
    const historyIdx = findIndex(config.indexes, "orden_cliente_created_idx");
    const statusIdx = findIndex(config.indexes, "orden_status_idx");

    expect(historyIdx.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      "cliente_id",
      "created_at",
    ]);
    expect(statusIdx.config.columns.map((c) => (c as { name: string }).name)).toEqual(["status"]);
  });
});

describe("schema — orden_servicio_item table (Phase 1, task 1.4)", () => {
  const config = getTableConfig(ordenServicioItem);

  it("is named 'orden_servicio_item'", () => {
    expect(config.name).toBe("orden_servicio_item");
  });

  it("ordenId FK cascades — line items die with the order", () => {
    const fk = config.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "orden_id"));
    if (!fk) throw new Error("orden_id foreign key not found");
    expect(fk.onDelete).toBe("cascade");
  });

  it("productoId FK sets null — re-sync must not delete order history", () => {
    const fk = config.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "producto_id"));
    if (!fk) throw new Error("producto_id foreign key not found");
    expect(fk.onDelete).toBe("set null");
  });

  it("snapshots productName + unitPrice and defaults quantity to 1", () => {
    expect(findColumn(config.columns, "product_name").notNull).toBe(true);
    expect(findColumn(config.columns, "unit_price").notNull).toBe(false);
    const quantity = findColumn(config.columns, "quantity");
    expect(quantity.notNull).toBe(true);
    expect(quantity.default).toBe(1);
  });

  it("has an ordenId index for per-order item lookups", () => {
    const idx = findIndex(config.indexes, "orden_item_orden_idx");
    expect(idx.config.columns.map((c) => (c as { name: string }).name)).toEqual(["orden_id"]);
  });
});

describe("schema — reminder table (Phase 1, task 1.5)", () => {
  const config = getTableConfig(reminder);

  it("is named 'reminder'", () => {
    expect(config.name).toBe("reminder");
  });

  it("ordenId and clienteId FKs both cascade — reminders die with their order/customer", () => {
    const ordenFk = config.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "orden_id"));
    const clienteFk = config.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "cliente_id"));
    if (!ordenFk) throw new Error("orden_id foreign key not found");
    if (!clienteFk) throw new Error("cliente_id foreign key not found");
    expect(ordenFk.onDelete).toBe("cascade");
    expect(clienteFk.onDelete).toBe("cascade");
  });

  it("status defaults to 'scheduled'", () => {
    const status = findColumn(config.columns, "status");
    expect(status.notNull).toBe(true);
    expect(status.default).toBe("scheduled");
  });

  it("scheduledFor is required; sentAt/jobId/error are nullable (fire-time bookkeeping)", () => {
    expect(findColumn(config.columns, "scheduled_for").notNull).toBe(true);
    expect(findColumn(config.columns, "sent_at").notNull).toBe(false);
    expect(findColumn(config.columns, "job_id").notNull).toBe(false);
    expect(findColumn(config.columns, "error").notNull).toBe(false);
  });

  it("has an ordenId index and a (status, scheduledFor) composite index for the worker's due-lookup", () => {
    const ordenIdx = findIndex(config.indexes, "reminder_orden_idx");
    const dueIdx = findIndex(config.indexes, "reminder_status_sched_idx");

    expect(ordenIdx.config.columns.map((c) => (c as { name: string }).name)).toEqual(["orden_id"]);
    expect(dueIdx.config.columns.map((c) => (c as { name: string }).name)).toEqual(["status", "scheduled_for"]);
  });
});

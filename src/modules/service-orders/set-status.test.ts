import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ordenEstadoHistorial, ordenServicio } from "@/shared/db/schema";
import type { Tx } from "./order-lock";
import { setStatus } from "./set-status";
import { OrderTransitionError } from "./transitions";

/** Records the table and payload of every `update().set()` and `insert().values()`. */
function fakeTx() {
  const log = { sets: [] as { table: unknown; patch: Record<string, unknown> }[], inserts: [] as { table: unknown; row: Record<string, unknown> }[] };
  const tx = {
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => {
        log.sets.push({ table, patch });
        return { where: () => ({ returning: async () => [{ id: "o1", ...patch }] }) };
      },
    }),
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        log.inserts.push({ table, row });
      },
    }),
  };
  return { tx: tx as unknown as Tx, log };
}

describe("setStatus", () => {
  it("writes the status, clears espera_motivo explicitly, and records one history row", async () => {
    const { tx, log } = fakeTx();

    const row = await setStatus(tx, { id: "o1", status: "diagnosing" }, "in_progress", "jefe-1");

    expect(row).toMatchObject({ id: "o1", status: "in_progress" });
    expect(log.sets).toEqual([
      { table: ordenServicio, patch: { status: "in_progress", esperaMotivo: null, updatedAt: expect.any(Date) } },
    ]);
    expect(log.inserts).toEqual([
      {
        table: ordenEstadoHistorial,
        row: { ordenId: "o1", fromStatus: "diagnosing", toStatus: "in_progress", esperaMotivo: null, changedBy: "jefe-1" },
      },
    ]);
  });

  it("stores the reason on a hold and copies it to the history row", async () => {
    const { tx, log } = fakeTx();

    await setStatus(tx, { id: "o1", status: "in_progress" }, "on_hold", "jefe-1", { esperaMotivo: "repuesto" });

    expect(log.sets[0].patch).toMatchObject({ status: "on_hold", esperaMotivo: "repuesto" });
    expect(log.inserts[0].row).toMatchObject({ toStatus: "on_hold", esperaMotivo: "repuesto" });
  });

  it("writes completedAt when given", async () => {
    const { tx, log } = fakeTx();
    const completedAt = new Date("2026-10-26T10:00:00Z");

    await setStatus(tx, { id: "o1", status: "in_progress" }, "done", null, { completedAt });

    expect(log.sets[0].patch).toMatchObject({ status: "done", completedAt });
    expect(log.inserts[0].row).toMatchObject({ changedBy: null });
  });

  it("asserts the full table: an illegal pair throws and writes nothing", async () => {
    const { tx, log } = fakeTx();

    await expect(setStatus(tx, { id: "o1", status: "open" }, "in_progress", "jefe-1")).rejects.toBeInstanceOf(OrderTransitionError);

    expect(log.sets).toEqual([]);
    expect(log.inserts).toEqual([]);
  });

  it("has no path that updates or deletes a history row", () => {
    const source = readFileSync(new URL("./set-status.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\.(update|delete)\(\s*ordenEstadoHistorial/);
  });
});

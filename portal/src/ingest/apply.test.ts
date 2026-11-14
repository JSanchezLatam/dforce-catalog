import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IngestBody } from "../contract";

// Chain: insert(table).values(v).onConflictDoNothing(o).returning(r)
const h = vi.hoisted(() => {
  const returning = vi.fn();
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  // usage: every write must go through the transaction handle, never `db` itself.
  const txCalls: string[] = [];
  const chain = (name: string): unknown =>
    new Proxy(() => undefined, {
      get: (_t, prop) => (prop === "then" ? undefined : chain(`${name}.${String(prop)}`)),
      apply: () => {
        txCalls.push(name);
        return chain(name);
      },
    });
  const tx = chain("tx");
  const transaction = vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
  return { returning, onConflictDoNothing, values, insert, transaction, txCalls };
});
vi.mock("../db/client", () => ({ db: { insert: h.insert, transaction: h.transaction } }));

import { supportFeedback } from "../db/schema";
import { applyIngest } from "./apply";

const fb: Extract<IngestBody, { kind: "feedback" }> = {
  kind: "feedback",
  id: "0b8f6f0e-5d0e-4c53-9a53-6f7d2d6f1a11",
  username: "ana",
  role: "tecnico",
  category: "bug",
  text: "Se rompe al guardar",
  route: "/service-orders",
  screenLabel: "Órdenes de servicio",
  createdAt: "2026-11-01T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.txCalls.length = 0;
  h.returning.mockResolvedValue([{ id: fb.id }]);
});

describe("applyIngest feedback", () => {
  it("inserts the nine wire fields only: status, note and received_at are left to the database", async () => {
    await applyIngest(fb);
    expect(h.insert).toHaveBeenCalledWith(supportFeedback);
    expect(h.values).toHaveBeenCalledWith({
      id: fb.id,
      username: "ana",
      role: "tecnico",
      category: "bug",
      text: fb.text,
      route: fb.route,
      screenLabel: fb.screenLabel,
      createdAt: new Date(fb.createdAt),
    });
  });

  it("is ON CONFLICT (id) DO NOTHING, so a duplicate leaves the first row alone", async () => {
    await applyIngest(fb);
    expect(h.onConflictDoNothing).toHaveBeenCalledWith({ target: supportFeedback.id });
  });

  it("reports applied only when a row was inserted", async () => {
    expect(await applyIngest(fb)).toEqual({ applied: true });
    h.returning.mockResolvedValue([]);
    expect(await applyIngest(fb)).toEqual({ applied: false });
  });
});

describe("applyIngest usage", () => {
  const usage: Extract<IngestBody, { kind: "usage" }> = {
    kind: "usage",
    from: "2026-10-05",
    to: "2026-10-07",
    screens: [{ pattern: "/kanban", label: "Tablero" }],
    counts: [{ day: "2026-10-05", screen: "/kanban", group: "gestion", views: 3 }],
  };

  // What the SQL does is proven on a real database by `npm run test:portal-sync`
  // (scripts/portal-sync/usage.local.ts); this pins only that it is ONE transaction.
  it("writes everything inside one db.transaction and nothing through db directly", async () => {
    expect(await applyIngest(usage)).toEqual({ applied: true });
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.txCalls.filter((c) => c === "tx.delete")).toHaveLength(2); // counts in range, the old catalog
    expect(h.txCalls.filter((c) => c === "tx.insert")).toHaveLength(3); // counts, coverage, catalog
  });
});

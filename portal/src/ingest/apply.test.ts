import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IngestBody } from "../contract";

// Chain: insert(table).values(v).onConflictDoNothing(o).returning(r)
const h = vi.hoisted(() => {
  const returning = vi.fn();
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  return { returning, onConflictDoNothing, values, insert };
});
vi.mock("../db/client", () => ({ db: { insert: h.insert } }));

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

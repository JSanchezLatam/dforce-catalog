import { describe, expect, it } from "vitest";

import type { IngestBody, PortalOrder, PortalVehicle } from "../contract";
import { parseIngest } from "./parse";

const order: PortalOrder = {
  id: "o1",
  status: "En proceso",
  categoria: "Mecánica",
  createdAt: "2026-10-01T10:00:00.000Z",
  appointmentAt: null,
  completedAt: null,
  description: "Cambio de aceite",
  hallazgos: null,
  recomendaciones: null,
};
const vehicle: PortalVehicle = { id: "v1", plate: "AB1234", make: "Toyota", model: null, year: 2015, orders: [order] };
const upsert: IngestBody = {
  kind: "upsert",
  clienteId: "c1",
  version: 5,
  tokenHash: "a".repeat(64),
  generatedAt: "2026-10-01T10:00:00.000Z",
  vehicles: [vehicle],
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("parseIngest", () => {
  it("accepts the three wire shapes unchanged", () => {
    expect(parseIngest(clone(upsert))).toEqual({ ok: true, body: upsert });
    const del: IngestBody = { kind: "delete", clienteId: "c1", version: 7 };
    expect(parseIngest(clone(del))).toEqual({ ok: true, body: del });
    const rec: IngestBody = { kind: "reconcile", liveClienteIds: ["c1", "c2"], maxVersion: 9 };
    expect(parseIngest(clone(rec))).toEqual({ ok: true, body: rec });
  });

  it("rejects a wrong or missing kind and non-objects", () => {
    for (const bad of [null, [], "x", 3, {}, { ...upsert, kind: "purge" }]) {
      expect(parseIngest(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects an extra key at every level", () => {
    const top = { ...clone(upsert), phone: "555" };
    const veh = clone(upsert) as Extract<IngestBody, { kind: "upsert" }>;
    (veh.vehicles[0] as Record<string, unknown>).chasis = "X";
    const ord = clone(upsert) as Extract<IngestBody, { kind: "upsert" }>;
    (ord.vehicles[0].orders[0] as Record<string, unknown>).observaciones = "secret";
    const del = { kind: "delete", clienteId: "c1", version: 1, tokenHash: "h" };
    const rec = { kind: "reconcile", liveClienteIds: [], maxVersion: 1, extra: 1 };
    for (const bad of [top, veh, ord, del, rec]) expect(parseIngest(bad).ok, JSON.stringify(bad)).toBe(false);
  });

  it("rejects a missing required field at every level", () => {
    for (const drop of ["clienteId", "version", "tokenHash", "generatedAt", "vehicles"]) {
      const bad = clone(upsert) as Record<string, unknown>;
      delete bad[drop];
      expect(parseIngest(bad).ok, drop).toBe(false);
    }
    const veh = clone(upsert) as Extract<IngestBody, { kind: "upsert" }>;
    delete (veh.vehicles[0] as Partial<PortalVehicle>).plate;
    expect(parseIngest(veh).ok).toBe(false);
    const ord = clone(upsert) as Extract<IngestBody, { kind: "upsert" }>;
    delete (ord.vehicles[0].orders[0] as Partial<PortalOrder>).hallazgos;
    expect(parseIngest(ord).ok).toBe(false);
  });

  it("rejects a status outside the four labels, including internal ones", () => {
    for (const status of ["in_progress", "ready_for_review", "Abierta", ""]) {
      const bad = clone(upsert) as Extract<IngestBody, { kind: "upsert" }>;
      (bad.vehicles[0].orders[0] as { status: string }).status = status;
      expect(parseIngest(bad).ok, status).toBe(false);
    }
    for (const status of ["Recibida", "En proceso", "Terminada", "Cancelada"]) {
      const good = clone(upsert) as Extract<IngestBody, { kind: "upsert" }>;
      (good.vehicles[0].orders[0] as { status: string }).status = status;
      expect(parseIngest(good).ok, status).toBe(true);
    }
  });

  it("rejects wrong types: version, year, ids list, empty strings", () => {
    const wrong: unknown[] = [
      { ...upsert, version: "5" },
      { ...upsert, version: 1.5 },
      { ...upsert, version: -1 },
      { ...upsert, clienteId: "" },
      { ...upsert, tokenHash: "" },
      { ...upsert, vehicles: "none" },
      { kind: "delete", clienteId: "c1", version: "7" },
      { kind: "reconcile", liveClienteIds: "c1", maxVersion: 1 },
      { kind: "reconcile", liveClienteIds: [1], maxVersion: 1 },
      { kind: "reconcile", liveClienteIds: [], maxVersion: "1" },
    ];
    for (const bad of wrong) expect(parseIngest(bad).ok, JSON.stringify(bad)).toBe(false);
    const year = clone(upsert) as Extract<IngestBody, { kind: "upsert" }>;
    (year.vehicles[0] as { year: unknown }).year = "2015";
    expect(parseIngest(year).ok).toBe(false);
  });

  describe("feedback", () => {
    const fb = {
      kind: "feedback",
      id: "0b8f6f0e-5d0e-4c53-9a53-6f7d2d6f1a11",
      username: "ana",
      role: "tecnico",
      category: "bug",
      text: "Se rompe al guardar",
      route: "/service-orders",
      screenLabel: "Órdenes de servicio",
      createdAt: "2026-11-01T10:00:00.000Z",
    } as const satisfies IngestBody;

    it("accepts the exact wire shape and rebuilds it field by field", () => {
      expect(parseIngest(clone(fb))).toEqual({ ok: true, body: fb });
    });

    it("accepts the boundaries: 2000 chars, every role and category", () => {
      expect(parseIngest({ ...fb, text: "x".repeat(2000) }).ok).toBe(true);
      for (const role of ["tecnico", "jefe_taller", "administrador"]) expect(parseIngest({ ...fb, role }).ok).toBe(true);
      for (const category of ["bug", "idea", "other"]) expect(parseIngest({ ...fb, category }).ok).toBe(true);
    });

    it("rejects extra keys the portal must stamp itself", () => {
      expect(parseIngest({ ...fb, receivedAt: "2026-01-01T00:00:00.000Z" }).ok).toBe(false);
      expect(parseIngest({ ...fb, status: "resuelto" }).ok).toBe(false);
    });

    it("rejects a missing field", () => {
      for (const key of Object.keys(fb).filter((k) => k !== "kind")) {
        const bad: Record<string, unknown> = clone(fb);
        delete bad[key];
        expect(parseIngest(bad).ok, key).toBe(false);
      }
    });

    it("rejects bad values", () => {
      const bad: unknown[] = [
        { ...fb, role: "vendedor" },
        { ...fb, category: "praise" },
        { ...fb, text: "" },
        { ...fb, text: "x".repeat(2001) },
        { ...fb, id: "not-a-uuid" },
        { ...fb, id: "" },
        { ...fb, route: "service-orders" },
        { ...fb, route: "/" + "x".repeat(300) },
        { ...fb, screenLabel: "" },
        { ...fb, screenLabel: "x".repeat(201) },
        { ...fb, username: "x".repeat(201) },
        { ...fb, createdAt: "yesterday" },
        { ...fb, text: 5 },
      ];
      for (const b of bad) expect(parseIngest(b).ok, JSON.stringify(b)).toBe(false);
    });
  });

  describe("usage", () => {
    const usage = {
      kind: "usage",
      from: "2026-10-05",
      to: "2026-10-07",
      screens: [
        { pattern: "/kanban", label: "Tablero" },
        { pattern: "/service-orders/[id]", label: "Orden de servicio" },
      ],
      counts: [
        { day: "2026-10-05", screen: "/kanban", group: "gestion", views: 12 },
        { day: "2026-10-07", screen: "/service-orders/[id]", group: "tecnico", views: 0 },
      ],
    } as const satisfies IngestBody;
    type Usage = { kind: string; from: string; to: string; screens: Record<string, unknown>[]; counts: Record<string, unknown>[] };
    const u = (): Usage => clone(usage) as unknown as Usage;
    const rejects = (b: unknown) => expect(parseIngest(b).ok, JSON.stringify(b)).toBe(false);

    it("accepts the exact wire shape and rebuilds it field by field", () => {
      expect(parseIngest(u())).toEqual({ ok: true, body: usage });
    });

    it("accepts a range with no counts and no screens, a single day, and exactly 31 days", () => {
      expect(parseIngest({ ...u(), counts: [], screens: [] }).ok).toBe(true);
      expect(parseIngest({ ...u(), from: "2026-10-07", counts: [u().counts[1]] }).ok).toBe(true);
      expect(parseIngest({ ...u(), from: "2026-10-01", to: "2026-10-31" }).ok).toBe(true);
      expect(parseIngest({ ...u(), from: "2024-02-29", to: "2024-02-29", counts: [] }).ok).toBe(true);
    });

    it("rejects an extra top-level key, such as a user field", () => {
      rejects({ ...u(), username: "ana" });
      rejects({ ...u(), extra: 1 });
    });

    it("rejects an extra key in a count, such as a user field", () => {
      const b = u();
      b.counts[0].username = "ana";
      rejects(b);
    });

    it("rejects an extra key in a screen", () => {
      const b = u();
      b.screens[0].icon = "x";
      rejects(b);
    });

    it("rejects a missing key at every level", () => {
      for (const key of ["from", "to", "screens", "counts"]) {
        const b: Record<string, unknown> = u();
        delete b[key];
        rejects(b);
      }
      for (const key of ["day", "screen", "group", "views"]) {
        const b = u();
        delete b.counts[0][key];
        rejects(b);
      }
      for (const key of ["pattern", "label"]) {
        const b = u();
        delete b.screens[0][key];
        rejects(b);
      }
    });

    it("rejects a date that is not YYYY-MM-DD", () => {
      for (const from of ["2026-10-5", "05/10/2026", "2026-10-05T00:00:00Z", "", 20261005]) rejects({ ...u(), from });
      rejects({ ...u(), to: "yesterday" });
      const b = u();
      b.counts[0].day = "2026-10-5";
      rejects(b);
    });

    it("rejects a day that is not on the calendar (Feb 30, month 13, Feb 29 of a non-leap year)", () => {
      rejects({ ...u(), from: "2026-02-30", to: "2026-03-02", counts: [] });
      rejects({ ...u(), from: "2026-02-27", to: "2026-02-30", counts: [] });
      rejects({ ...u(), from: "2026-13-01", to: "2026-13-02", counts: [] });
      rejects({ ...u(), from: "2025-02-29", to: "2025-03-01", counts: [] });
    });

    it("rejects from after to", () => {
      rejects({ ...u(), from: "2026-10-08", to: "2026-10-07", counts: [] });
    });

    it("rejects a 32-day range", () => {
      rejects({ ...u(), from: "2026-10-01", to: "2026-11-01" });
    });

    it("rejects a count whose day is outside the range", () => {
      for (const day of ["2026-10-04", "2026-10-08"]) {
        const b = u();
        b.counts[0].day = day;
        rejects(b);
      }
    });

    it("rejects negative, fractional and non-number views", () => {
      for (const views of [-1, 1.5, "3", null, 2_147_483_648]) {
        const b = u();
        b.counts[0].views = views;
        rejects(b);
      }
    });

    it("accepts views at the integer column's ceiling", () => {
      const b = u();
      b.counts[0].views = 2_147_483_647;
      expect(parseIngest(b).ok).toBe(true);
    });

    it("rejects a group outside gestion | tecnico, including a raw role", () => {
      for (const group of ["administrador", "jefe_taller", "pantalla", "", null]) {
        const b = u();
        b.counts[0].group = group;
        rejects(b);
      }
    });

    it("rejects empty strings and non-arrays", () => {
      rejects({ ...u(), screens: {} });
      rejects({ ...u(), counts: "none" });
      const s = u();
      s.screens[0].label = "";
      rejects(s);
      const c = u();
      c.counts[0].screen = "";
      rejects(c);
    });

    it("rejects a duplicate count key or screen pattern, which the primary keys would refuse", () => {
      const c = u();
      c.counts.push({ ...c.counts[0], views: 1 });
      rejects(c);
      const s = u();
      s.screens.push({ ...s.screens[0], label: "Otro" });
      rejects(s);
    });
  });
});

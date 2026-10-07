import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { Cliente, OrdenServicio, Vehiculo } from "@/shared/db/schema";
import { buildSnapshot, hashToken } from "./snapshot";

const TOKEN = "PLAINTEXT_TOKEN_SENTINEL_0123456789abcdefghijklmnopq";
const NOW = new Date("2026-10-07T12:00:00.000Z");

/** Every column of `cliente`, the forbidden ones carrying a sentinel. */
const clienteRow: Cliente = {
  id: "cli-1",
  name: "SENTINEL_NAME",
  phone: "SENTINEL_PHONE",
  email: "SENTINEL_EMAIL",
  documentoIdentidad: "SENTINEL_CEDULA",
  externalId: "SENTINEL_EXTERNAL",
  whatsappOptOut: true,
  emailOptOut: true,
  deactivatedAt: null,
  portalToken: TOKEN,
  createdAt: new Date("2020-01-01T00:00:00.000Z"),
  updatedAt: new Date("2020-01-02T00:00:00.000Z"),
};

const vehicleRow = (id: string, extra: Partial<Vehiculo> = {}): Vehiculo => ({
  id,
  clienteId: "cli-1",
  make: "Toyota",
  model: "Hilux",
  year: 2019,
  plate: `PLATE-${id}`,
  chasis: "SENTINEL_CHASIS",
  colorPrimario: "SENTINEL_COLOR1",
  colorSecundario: "SENTINEL_COLOR2",
  estilo: "SENTINEL_ESTILO",
  motor: "hibrido",
  numeroUnidad: "SENTINEL_UNIT",
  placaRenovacionMes: 11,
  placaMunicipio: "SENTINEL_MUNICIPIO",
  seguroVence: "2031-12-24",
  deactivatedAt: null,
  createdAt: new Date("2020-01-01T00:00:00.000Z"),
  ...extra,
});

const orderRow = (id: string, vehiculoId: string, extra: Partial<OrdenServicio> = {}): OrdenServicio => ({
  id,
  clienteId: "cli-1",
  vehiculoId,
  status: "done",
  categoria: "mant_preventivo",
  description: "descripcion visible",
  appointmentAt: new Date("2026-10-01T15:00:00.000Z"),
  completedAt: new Date("2026-10-02T15:00:00.000Z"),
  hallazgos: "hallazgos visibles",
  recomendaciones: "recomendaciones visibles",
  observaciones: "SENTINEL_OBSERVACIONES",
  kilometraje: 918273,
  nivelCombustible: 3,
  bateriaPct: 77,
  createdBy: "SENTINEL_CREATED_BY",
  createdAt: new Date("2026-09-30T15:00:00.000Z"),
  updatedAt: new Date("2026-10-03T15:00:00.000Z"),
  ...extra,
});

const keys = (o: object) => Object.keys(o).sort();

describe("buildSnapshot whitelist", () => {
  const snapshot = buildSnapshot(
    {
      cliente: clienteRow,
      vehicles: [vehicleRow("v1")],
      orders: [orderRow("o1", "v1")],
    },
    7,
    NOW,
  );

  it("has exactly the whitelisted keys at every level", () => {
    expect(keys(snapshot)).toEqual(["clienteId", "generatedAt", "kind", "tokenHash", "vehicles", "version"]);
    expect(keys(snapshot.vehicles[0])).toEqual(["id", "make", "model", "orders", "plate", "year"]);
    expect(keys(snapshot.vehicles[0].orders[0])).toEqual([
      "appointmentAt",
      "categoria",
      "completedAt",
      "createdAt",
      "description",
      "hallazgos",
      "id",
      "recomendaciones",
      "status",
    ]);
  });

  it("carries no forbidden value anywhere in the serialized payload", () => {
    const wire = JSON.stringify(snapshot);
    expect(wire).not.toMatch(/SENTINEL/);
    for (const leaked of ["918273", "hibrido", "2031-12-24", "SENTINEL_OBSERVACIONES"]) {
      expect(wire).not.toContain(leaked);
    }
  });

  it("sends the token's SHA-256 and never the plaintext", () => {
    expect(snapshot.tokenHash).toBe(createHash("sha256").update(TOKEN).digest("hex"));
    expect(hashToken(TOKEN)).toBe(snapshot.tokenHash);
    expect(JSON.stringify(snapshot)).not.toContain(TOKEN);
  });

  it("stamps version and generatedAt", () => {
    expect(snapshot).toMatchObject({ kind: "upsert", clienteId: "cli-1", version: 7, generatedAt: NOW.toISOString() });
  });
});

describe("buildSnapshot content", () => {
  const build = (orders: OrdenServicio[], vehicles: Vehiculo[] = [vehicleRow("v1")]) =>
    buildSnapshot({ cliente: clienteRow, vehicles, orders }, 1, NOW);

  it("maps the five internal statuses to the four customer labels", () => {
    const statuses = ["open", "in_progress", "ready_for_review", "done", "cancelled"] as const;
    const s = build(statuses.map((status, i) => orderRow(`o${i}`, "v1", { status })));
    expect(s.vehicles[0].orders.map((o) => o.status)).toEqual([
      "Recibida",
      "En proceso",
      "En proceso",
      "Terminada",
      "Cancelada",
    ]);
    const wire = JSON.stringify(s);
    for (const internal of ["in_progress", "ready_for_review", '"open"', '"done"', "cancelled"]) {
      expect(wire).not.toContain(internal);
    }
  });

  it("sends the Spanish categoria label, not the slug", () => {
    const s = build([orderRow("o1", "v1", { categoria: "mant_correctivo" })]);
    expect(s.vehicles[0].orders[0].categoria).toBe("Mant. Correctivo");
    expect(JSON.stringify(s)).not.toContain("mant_correctivo");
  });

  it("omits a soft-deleted vehicle and its orders, keeps every active vehicle", () => {
    const s = build(
      [orderRow("o-live", "v1"), orderRow("o-dead", "v2"), orderRow("o-live3", "v3")],
      [vehicleRow("v1"), vehicleRow("v2", { deactivatedAt: new Date() }), vehicleRow("v3"), vehicleRow("v4")],
    );
    expect(s.vehicles.map((v) => v.id)).toEqual(["v1", "v3", "v4"]);
    expect(s.vehicles.flatMap((v) => v.orders.map((o) => o.id))).toEqual(["o-live", "o-live3"]);
    expect(JSON.stringify(s)).not.toContain("o-dead");
  });

  it("serializes dates as ISO strings and keeps nulls", () => {
    const s = build([orderRow("o1", "v1", { appointmentAt: null, completedAt: null, hallazgos: null })]);
    expect(s.vehicles[0].orders[0]).toMatchObject({
      createdAt: "2026-09-30T15:00:00.000Z",
      appointmentAt: null,
      completedAt: null,
      hallazgos: null,
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import type { ContactMark, DueCandidate } from "./queries";
import { getDueVencimientos, markContactado, VehiculoNotFoundError, VencimientoValidationError } from "./service";
import { insertContacto } from "./queries";

/** Every field the real SELECT returns, so a fixture cannot drift from the query. */
function candidate(overrides: Partial<DueCandidate> = {}): DueCandidate {
  return {
    vehiculoId: "veh-1",
    clienteId: "cli-1",
    customerName: "Ana Pérez",
    customerPhone: "6111-1111",
    whatsappOptOut: false,
    make: "Toyota",
    model: "Corolla",
    plate: "ABC123",
    numeroUnidad: "U-7",
    placaRenovacionMes: null,
    placaMunicipio: null,
    seguroVence: null,
    ...overrides,
  };
}

const NOW = new Date("2026-10-04T15:00:00Z");

const seams = (candidates: DueCandidate[], contacts: ContactMark[] = []) => ({
  listCandidates: async () => candidates,
  listContacts: async () => contacts,
});

describe("getDueVencimientos", () => {
  it("returns one row per due item with the fields the page and dialog need, and a count equal to the rows", async () => {
    const result = await getDueVencimientos(
      NOW,
      seams([
        candidate({ placaRenovacionMes: 10, seguroVence: "2026-10-20" }),
        candidate({ vehiculoId: "veh-2", plate: "XYZ789", make: null, model: null, numeroUnidad: null, seguroVence: "2026-09-01" }),
      ]),
    );

    expect(result.rows).toEqual([
      {
        vehiculoId: "veh-2",
        clienteId: "cli-1",
        customerName: "Ana Pérez",
        customerPhone: "6111-1111",
        whatsappOptOut: false,
        make: null,
        model: null,
        plate: "XYZ789",
        numeroUnidad: null,
        placaMunicipio: null,
        kind: "seguro",
        periodKey: "2026-09-01",
        state: "overdue",
        daysLeft: -33,
      },
      expect.objectContaining({ vehiculoId: "veh-1", kind: "placa", periodKey: "2026-10", state: "due", daysLeft: null }),
      expect.objectContaining({ vehiculoId: "veh-1", kind: "seguro", periodKey: "2026-10-20", state: "due", daysLeft: 16 }),
    ]);
    expect(result.count).toBe(3);
    expect(result.count).toBe(result.rows.length);
  });

  it("carries the vehicle's municipio onto every row it produces", async () => {
    const result = await getDueVencimientos(
      NOW,
      seams([candidate({ placaRenovacionMes: 10, seguroVence: "2026-10-20", placaMunicipio: "San Miguelito" })]),
    );
    expect(result.rows.map((r) => [r.kind, r.placaMunicipio])).toEqual([
      ["placa", "San Miguelito"],
      ["seguro", "San Miguelito"],
    ]);
  });

  it("a vehicle due on plate and insurance counts twice", async () => {
    const result = await getDueVencimientos(NOW, seams([candidate({ placaRenovacionMes: 10, seguroVence: "2026-10-20" })]));
    expect(result.count).toBe(2);
  });

  it("a contact mark hides its own vehicle's item, never another vehicle's", async () => {
    const result = await getDueVencimientos(
      NOW,
      seams(
        [candidate({ placaRenovacionMes: 10 }), candidate({ vehiculoId: "veh-2", placaRenovacionMes: 10 })],
        [{ vehiculoId: "veh-1", kind: "placa", periodKey: "2026-10" }],
      ),
    );

    expect(result.rows.map((r) => r.vehiculoId)).toEqual(["veh-2"]);
    expect(result.count).toBe(1);
  });

  it("decides the month by the Panamá date: 03:00Z on 1 October is still 30 September", async () => {
    const result = await getDueVencimientos(
      new Date("2026-10-01T03:00:00Z"),
      seams([candidate({ placaRenovacionMes: 11 }), candidate({ vehiculoId: "veh-2", placaRenovacionMes: 10 })]),
    );
    // On 30 September October is NEXT month (due); November is two ahead (not listed).
    expect(result.rows.map((r) => [r.vehiculoId, r.periodKey])).toEqual([["veh-2", "2026-10"]]);
  });

  it("an empty candidate list yields no rows and a zero count", async () => {
    expect(await getDueVencimientos(NOW, seams([candidate()]))).toEqual({ rows: [], count: 0 });
  });
});

describe("markContactado", () => {
  const input = { vehiculoId: "veh-1", kind: "placa", periodKey: "2026-10" };

  it("inserts the mark with the caller as contacted_by", async () => {
    const insert = vi.fn(async () => undefined);
    await markContactado(input, "user-1", { vehiculoExists: async () => true, insert });
    expect(insert).toHaveBeenCalledWith({ vehiculoId: "veh-1", kind: "placa", periodKey: "2026-10", contactedBy: "user-1" });
  });

  it("is idempotent from the caller's side: a second identical call resolves too", async () => {
    const insert = vi.fn(async () => undefined);
    const deps = { vehiculoExists: async () => true, insert };
    await markContactado(input, "user-1", deps);
    await expect(markContactado(input, "user-1", deps)).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("rejects a period key that does not fit its kind, and writes nothing", async () => {
    const insert = vi.fn();
    const deps = { vehiculoExists: async () => true, insert };
    for (const bad of [
      { kind: "placa", periodKey: "2026-10-20" },
      { kind: "placa", periodKey: "2026-13" },
      { kind: "placa", periodKey: "2026-00" },
      { kind: "seguro", periodKey: "2026-10" },
      { kind: "seguro", periodKey: "2026-02-30" },
      { kind: "seguro", periodKey: "2026-1-5" },
      { kind: "otro", periodKey: "2026-10" },
    ]) {
      await expect(markContactado({ vehiculoId: "veh-1", ...bad }, "user-1", deps)).rejects.toBeInstanceOf(VencimientoValidationError);
    }
    expect(insert).not.toHaveBeenCalled();
  });

  it("accepts a real insurance date and a real plate month", async () => {
    const insert = vi.fn(async () => undefined);
    const deps = { vehiculoExists: async () => true, insert };
    await markContactado({ vehiculoId: "veh-1", kind: "seguro", periodKey: "2028-02-29" }, "user-1", deps);
    await markContactado({ vehiculoId: "veh-1", kind: "placa", periodKey: "2027-12" }, "user-1", deps);
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("rejects a missing vehicle id", async () => {
    await expect(markContactado({ vehiculoId: "", kind: "placa", periodKey: "2026-10" }, "u", { vehiculoExists: async () => true, insert: vi.fn() })).rejects.toBeInstanceOf(
      VencimientoValidationError,
    );
  });

  it("throws VehiculoNotFoundError for an unknown vehicle, and writes nothing", async () => {
    const insert = vi.fn();
    await expect(markContactado(input, "user-1", { vehiculoExists: async () => false, insert })).rejects.toBeInstanceOf(VehiculoNotFoundError);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("insertContacto", () => {
  it("writes with onConflictDoNothing, so a double mark is a no-op and not an error", async () => {
    const onConflictDoNothing = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoNothing }));
    await insertContacto({ vehiculoId: "veh-1", kind: "seguro", periodKey: "2026-11-03", contactedBy: "user-1" }, { insert: () => ({ values }) });

    expect(values).toHaveBeenCalledWith({ vehiculoId: "veh-1", kind: "seguro", periodKey: "2026-11-03", contactedBy: "user-1" });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from "vitest";

import { toBoardSnapshot, toCustomerSnapshot, type BoardOrderRow } from "@/modules/board/shape";
import { toKanbanSnapshot } from "./shape";

const NOW = new Date("2026-10-26T15:00:00.000Z");
const T0 = new Date("2026-10-26T14:00:00.000Z");
const LEAK = "__LEAK__";

/** The columns the query selects plus every field it must never select, each holding the sentinel. */
const poisoned = (extra: Partial<BoardOrderRow> = {}): BoardOrderRow =>
  ({
    id: "ord-1",
    status: "in_progress",
    esperaMotivo: null,
    updatedAt: T0,
    appointmentAt: null,
    urgenteAt: null,
    vehiculoId: "veh-1",
    categoria: "revisado",
    plate: "AB1234",
    make: "Toyota",
    model: "Hilux",
    name: LEAK,
    phone: LEAK,
    email: LEAK,
    portalToken: LEAK,
    clienteId: LEAK,
    description: LEAK,
    urgenteBy: LEAK,
    userId: LEAK,
    ...extra,
  }) as BoardOrderRow;

const data = (rows: BoardOrderRow[], techs: { ordenId: string; nombre: string }[] = []) => ({ rows, techs, since: [] });
const viewer = (ordenIds: string[] = [], onRoster = true) => ({ onRoster, ordenIds });

describe("toKanbanSnapshot()", () => {
  it("card keys equal the whitelist exactly: id, missing, mine and categoria on top of the board row", () => {
    const [card] = toKanbanSnapshot(data([poisoned()]), viewer(), NOW).rows;

    expect(Object.keys(card).sort()).toEqual(
      ["categoria", "holdReason", "id", "make", "mine", "missing", "model", "plate", "status", "statusLabel", "statusSince", "technicians", "urgent"],
    );
    expect(card).toEqual({
      id: "ord-1",
      status: "in_progress",
      statusLabel: "En progreso",
      plate: "AB1234",
      make: "Toyota",
      model: "Hilux",
      holdReason: null,
      technicians: [],
      statusSince: T0.toISOString(),
      urgent: false,
      categoria: "revisado",
      missing: [],
      mine: false,
    });
  });

  it("envelope carries generatedAt and onRoster", () => {
    const snapshot = toKanbanSnapshot(data([]), viewer([], false), NOW);

    expect(snapshot).toEqual({ generatedAt: NOW.toISOString(), onRoster: false, rows: [] });
  });

  it("Sentinel privacy: no customer, portal, flagging-user or source-row field reaches the payload", () => {
    const snapshot = toKanbanSnapshot(data([poisoned()], [{ ordenId: "ord-1", nombre: "Ana", userId: LEAK } as { ordenId: string; nombre: string }]), viewer(["ord-1"]), NOW);

    expect(JSON.stringify(snapshot)).not.toContain(LEAK);
    expect(JSON.stringify(snapshot)).not.toContain("veh-1");
  });

  it("Id stays off the TV payloads: only the kanban rows contain id, missing or mine", () => {
    const rows = [poisoned()];
    const tv = JSON.stringify([toBoardSnapshot(rows, [], [], NOW), toCustomerSnapshot(rows, NOW)]);

    expect(tv).not.toMatch(/"(id|missing|mine)"/);
    expect(tv).not.toContain("ord-1");
    expect(Object.keys(toKanbanSnapshot(data(rows), viewer(), NOW).rows[0])).toEqual(expect.arrayContaining(["id", "missing", "mine"]));
  });

  it.each([
    ["no vehicle", { vehiculoId: null, plate: null, make: null, model: null }, ["vehiculo"]],
    ["no category", { categoria: null }, ["categoria"]],
    ["neither", { vehiculoId: null, plate: null, make: null, model: null, categoria: null }, ["vehiculo", "categoria"]],
  ] as const)("missing lists what a booked order lacks: %s", (_label, extra, missing) => {
    const [card] = toKanbanSnapshot(data([poisoned({ status: "booked", ...extra })]), viewer(), NOW).rows;

    expect(card.missing).toEqual(missing);
  });

  it("mine is true only for the orders the viewer is assigned to", () => {
    const rows = toKanbanSnapshot(data([poisoned({ id: "a" }), poisoned({ id: "b" })]), viewer(["b"]), NOW).rows;

    expect(rows.map((r) => [r.id, r.mine])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  it("orders like the board: status order, then urgent first, then the longest time in status", () => {
    const old = new Date("2026-10-26T08:00:00.000Z");
    const rows = toKanbanSnapshot(
      data([poisoned({ id: "old", updatedAt: old }), poisoned({ id: "hot", urgenteAt: T0 }), poisoned({ id: "open", status: "open" })]),
      viewer(),
      NOW,
    ).rows;

    expect(rows.map((r) => r.id)).toEqual(["open", "hot", "old"]);
  });
});

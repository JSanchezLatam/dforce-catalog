import { describe, expect, it } from "vitest";

import type { OrdenServicio, OrdenServicioItem } from "@/shared/db/schema";
import {
  buildOrdenServicioWhere,
  countOrdenesServicio,
  getOrdenServicioById,
  listOrdenesByVehiculo,
  listOrdenesServicio,
} from "./queries";

describe("buildOrdenServicioWhere (R21)", () => {
  it("returns undefined when no status filter is given", () => {
    expect(buildOrdenServicioWhere({})).toBeUndefined();
  });

  it("returns a defined condition when a status filter is given", () => {
    expect(buildOrdenServicioWhere({ status: "open" })).toBeDefined();
  });
});

describe("listOrdenesServicio (R21)", () => {
  it("returns whatever the injected queryFn resolves", async () => {
    const rows = [{ id: "o1", status: "open" }] as unknown as OrdenServicio[];
    await expect(
      listOrdenesServicio({ status: "open" }, { offset: 0, limit: 10 }, async () => rows),
    ).resolves.toEqual(rows);
  });
});

describe("countOrdenesServicio (R21)", () => {
  it("returns whatever the injected queryFn resolves", async () => {
    await expect(countOrdenesServicio({}, async () => 7)).resolves.toBe(7);
  });
});

describe("listOrdenesByVehiculo (C4)", () => {
  it("returns whatever the injected queryFn resolves", async () => {
    const rows = [{ id: "o1", vehiculoId: "v1" }] as unknown as OrdenServicio[];
    await expect(listOrdenesByVehiculo("v1", async () => rows)).resolves.toEqual(rows);
  });
});

describe("getOrdenServicioById (R20)", () => {
  it("returns null when the injected queryFn finds nothing", async () => {
    await expect(getOrdenServicioById("missing", async () => null)).resolves.toBeNull();
  });

  it("returns the order + its line items when found", async () => {
    const detail = {
      orden: { id: "o1", status: "open" } as unknown as OrdenServicio,
      items: [
        { id: "i1", ordenId: "o1", productName: "Filtro de aceite", quantity: 2 },
      ] as unknown as OrdenServicioItem[],
    };
    await expect(getOrdenServicioById("o1", async () => detail)).resolves.toEqual(detail);
  });
});

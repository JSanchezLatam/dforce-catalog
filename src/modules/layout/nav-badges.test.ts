import { describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/modules/auth/session";
import { getDueVencimientos } from "@/modules/vencimientos/service";
import type { ContactMark, DueCandidate } from "@/modules/vencimientos/queries";

import { getNavBadges } from "./nav-badges";

const admin: SessionUser = { id: "a1", role: "administrador" };
const tecnico: SessionUser = { id: "t1", role: "tecnico" };
const NOW = new Date("2026-10-04T15:00:00Z");

function candidate(id: string, over: Partial<DueCandidate> = {}): DueCandidate {
  return {
    vehiculoId: id,
    clienteId: `c-${id}`,
    customerName: `Cliente ${id}`,
    customerPhone: "6111-1111",
    whatsappOptOut: false,
    make: null,
    model: null,
    plate: `PL${id}`,
    numeroUnidad: null,
    placaRenovacionMes: 10,
    seguroVence: null,
    ...over,
  };
}

/** The real service over injected reads: the spec's "3 due items, 1 contacted" scenario. */
const dueWith = (candidates: DueCandidate[], contacts: ContactMark[]) => (now: Date) =>
  getDueVencimientos(now, { listCandidates: async () => candidates, listContacts: async () => contacts });

describe("getNavBadges()", () => {
  const candidates = [candidate("1"), candidate("2"), candidate("3")];
  const contacts: ContactMark[] = [{ vehiculoId: "2", kind: "placa", periodKey: "2026-10" }];

  it("gives an administrador the page's row count: 3 due items, 1 contacted, badge 2", async () => {
    const getDue = dueWith(candidates, contacts);
    const badges = await getNavBadges(admin, NOW, getDue);

    expect(badges).toEqual({ "/vencimientos": 2 });
    expect((await getDue(NOW)).rows).toHaveLength(2);
  });

  it("gives a técnico nothing and never reads the due list", async () => {
    const getDue = vi.fn();

    expect(await getNavBadges(tecnico, NOW, getDue)).toEqual({});
    expect(getDue).not.toHaveBeenCalled();
  });

  it("is zero, not missing, when nothing is due (getNavGroups hides a zero)", async () => {
    expect(await getNavBadges(admin, NOW, dueWith([], []))).toEqual({ "/vencimientos": 0 });
  });
});

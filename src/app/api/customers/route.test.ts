import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { Cliente } from "@/shared/db/schema";
import type { ClienteListItem } from "@/modules/customers/queries";
import { handleCreateCliente, handleListClientes, POST } from "./route";

const validInput = { name: "Juan Pérez", phone: "+52 55 1234 5678" };

function requestWith(body: unknown) {
  return new NextRequest("http://localhost/api/customers", {
    method: "POST",
    headers: { "x-user-id": "user-1", "x-user-role": "tecnico", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/customers (R16)", () => {
  it("throws when called without session headers (proxy.ts did not validate)", async () => {
    const request = new NextRequest("http://localhost/api/customers", {
      method: "POST",
      body: JSON.stringify(validInput),
    });
    await expect(POST(request)).rejects.toThrow();
  });

  it("creates the cliente and returns 201 on valid input", async () => {
    const insert = vi.fn().mockResolvedValue({ id: "c1", ...validInput, phone: "+525512345678" });

    const response = await handleCreateCliente(requestWith(validInput), {
      findByPhone: async () => null,
      insert,
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.cliente).toEqual({ id: "c1", name: "Juan Pérez", phone: "+525512345678" });
  });

  it("returns 400 with field errors on invalid input (R17)", async () => {
    const response = await handleCreateCliente(requestWith({ name: "" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors.name).toBeTruthy();
    expect(body.errors.phone).toBeTruthy();
  });

  it("returns 409 with a link to the existing customer on a duplicate phone (R18)", async () => {
    const response = await handleCreateCliente(requestWith(validInput), {
      findByPhone: async () => ({ id: "existing-1" }) as unknown as Cliente,
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.existingClienteId).toBe("existing-1");
  });

  // The route forwards the raw body whole, so the confirmation needs no route
  // plumbing of its own. This test is what makes that a guarantee instead of
  // an accident: a refactor that starts picking named fields off the body
  // would silently drop the override and re-block the shared-phone case.
  it("carries the shared-phone confirmation through to the service (R18)", async () => {
    const insert = vi.fn().mockResolvedValue({ id: "c2", ...validInput, phone: "+525512345678" });

    const response = await handleCreateCliente(
      requestWith({ ...validInput, allowDuplicatePhone: true }),
      { findByPhone: async () => ({ id: "existing-1" }) as unknown as Cliente, insert },
    );

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledOnce();
  });

  it("returns 400 for a vehicle missing its plate, unchanged error mapping (D5/D6)", async () => {
    const response = await handleCreateCliente(requestWith({ ...validInput, vehicles: [{ make: "Toyota" }] }), {
      findByPhone: async () => null,
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors["vehicles.0.plate"]).toBeTruthy();
  });
});

function getReq(role: string, query = "") {
  return new NextRequest(`http://localhost/api/customers${query}`, {
    headers: { "x-user-id": "user-1", "x-user-role": role },
  });
}

// `phone: ""`, not `null` — migration `0016` made the column NOT NULL, and
// NOT NULL forbids null but NOT the empty string. "No phone on record" is
// still a reachable state, and R19 still guarantees such a row renders.
const ROW: ClienteListItem = {
  id: "c1",
  name: "Juan",
  phone: "",
  email: null,
  // R20 — null is the ACTIVE state; the list only ever sees a non-null one
  // when the caller asked for deactivated records.
  deactivatedAt: null,
  plates: [],
  createdAt: new Date("2026-01-01"),
};

/**
 * Spec `customer-management` R19 — "GET route requires customers.read".
 * Mirrors `api/users/route.test.ts`'s "denies ... without listing anything"
 * shape: asserting the injected spies were never called proves the deny
 * branch runs before any query, not just that the status code is 403.
 */
describe("customers.read gating (R19)", () => {
  it("denies an unrecognised role on GET without running any query", async () => {
    const listClientes = vi.fn();
    const countClientes = vi.fn();

    const response = await handleListClientes(getReq("unknown"), { listClientes, countClientes });

    expect(response.status).toBe(403);
    expect(listClientes).not.toHaveBeenCalled();
    expect(countClientes).not.toHaveBeenCalled();
  });

  it("throws on GET without session headers (proxy.ts did not validate)", async () => {
    const bare = new NextRequest("http://localhost/api/customers");
    await expect(handleListClientes(bare, {})).rejects.toThrow();
  });
});

describe("GET /api/customers (R19)", () => {
  it("parses search/page/pageSize and clamps pageSize to a known option", async () => {
    const listClientes = vi.fn().mockResolvedValue([ROW]);
    const countClientes = vi.fn().mockResolvedValue(1);

    await handleListClientes(getReq("tecnico", "?search=juan&page=2&pageSize=25"), { listClientes, countClientes });

    // `includeInactive: false` rides every filter object now (R20) — the
    // default list is active-only, and asserting it here keeps that visible
    // at the call site rather than only in `buildClienteListWhere`.
    expect(listClientes).toHaveBeenCalledWith({ search: "juan", includeInactive: false }, { page: 2, offset: 25, limit: 25 });
    expect(countClientes).toHaveBeenCalledWith({ search: "juan", includeInactive: false });
  });

  it("defaults to page 1 and the standard page size with no query string", async () => {
    const listClientes = vi.fn().mockResolvedValue([ROW]);
    const countClientes = vi.fn().mockResolvedValue(1);

    await handleListClientes(getReq("tecnico"), { listClientes, countClientes });

    expect(listClientes).toHaveBeenCalledWith({ search: undefined, includeInactive: false }, { page: 1, offset: 0, limit: 10 });
  });

  it("re-queries with a relaxed term and sets relaxedFrom only when the primary search returns zero rows", async () => {
    const listClientes = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([ROW]);
    const countClientes = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const response = await handleListClientes(getReq("tecnico", "?search=Juan+Alberto"), {
      listClientes,
      countClientes,
    });

    const body = await response.json();
    expect(listClientes).toHaveBeenCalledTimes(2);
    expect(listClientes).toHaveBeenNthCalledWith(2, { search: "Juan", includeInactive: false }, expect.any(Object));
    expect(body.relaxedFrom).toBe("Juan");
    expect(body.total).toBe(1);
  });

  /**
   * `CustomerPicker` asks for exactly 50 (`pageSize=50`), and its own test
   * asserts only that the string is in the URL. `parsePageSize` silently falls
   * back to `DEFAULT_PAGE_SIZE` (10) for any value outside `[10,25,50,100]`,
   * so if 50 ever left that list the picker would quietly show 10 rows and
   * BOTH tests would stay green — reproducing the silent truncation this whole
   * change exists to remove. This is the test that would go red instead.
   */
  it("honours the pageSize=50 the picker actually asks for", async () => {
    const listClientes = vi.fn().mockResolvedValue([ROW]);
    const countClientes = vi.fn().mockResolvedValue(1);

    await handleListClientes(getReq("tecnico", "?search=perez&pageSize=50"), { listClientes, countClientes });

    expect(listClientes).toHaveBeenCalledWith({ search: "perez", includeInactive: false }, expect.objectContaining({ limit: 50 }));
  });

  /**
   * An empty PAGE is not an empty RESULT SET. Past the last page of a term
   * that does match rows, `listClientes` returns `[]` while `countClientes`
   * still reports the real total — so keying the fallback on the row count
   * relaxes a search that found plenty, and reports the relaxed term's total
   * under the caller's original term with no `relaxedFrom` to admit it.
   */
  it("does not relax a search that matched rows, when the requested page is past the end", async () => {
    const listClientes = vi.fn().mockResolvedValue([]);
    const countClientes = vi.fn().mockResolvedValue(40);

    const response = await handleListClientes(getReq("tecnico", "?search=gonzalez&page=99"), {
      listClientes,
      countClientes,
    });

    const body = await response.json();
    expect(listClientes).toHaveBeenCalledTimes(1);
    expect(body.relaxedFrom).toBeUndefined();
    expect(body.total).toBe(40);
  });

  /**
   * The relaxed pass is adopted whole or not at all. Taking its `total` while
   * its rows are empty publishes a count for a term the caller never asked
   * about, and `relaxedFrom` stays unset because that only fires on rows.
   */
  it("keeps the original total when the relaxed pass finds nothing to show", async () => {
    const listClientes = vi.fn().mockResolvedValue([]);
    const countClientes = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(7);

    const response = await handleListClientes(getReq("tecnico", "?search=Juan+Alberto&page=99"), {
      listClientes,
      countClientes,
    });

    const body = await response.json();
    expect(body.relaxedFrom).toBeUndefined();
    expect(body.total).toBe(0);
  });

  /**
   * The search is a sequential scan (design.md), so a serial `await list()`
   * then `await count()` doubles the latency of every keystroke burst.
   * `customers/page.tsx:49` already issues both at once.
   */
  it("issues the list and count queries concurrently, not one after the other", async () => {
    let resolveList: (rows: ClienteListItem[]) => void = () => {};
    const listClientes = vi.fn(
      () => new Promise<ClienteListItem[]>((resolve) => { resolveList = resolve; }),
    );
    const countClientes = vi.fn().mockResolvedValue(1);

    const pending = handleListClientes(getReq("tecnico", "?search=juan"), { listClientes, countClientes });
    await Promise.resolve();

    expect(countClientes).toHaveBeenCalled();

    resolveList([ROW]);
    expect((await (await pending).json()).total).toBe(1);
  });

  it("does not re-query when the primary search already has results", async () => {
    const listClientes = vi.fn().mockResolvedValue([ROW]);
    const countClientes = vi.fn().mockResolvedValue(1);

    const response = await handleListClientes(getReq("tecnico", "?search=Juan"), { listClientes, countClientes });

    expect(listClientes).toHaveBeenCalledTimes(1);
    expect((await response.json()).relaxedFrom).toBeUndefined();
  });

  it("suppresses the second query when relaxSearchTerm returns null (term too short to relax)", async () => {
    const listClientes = vi.fn().mockResolvedValue([]);
    const countClientes = vi.fn().mockResolvedValue(0);

    await handleListClientes(getReq("tecnico", "?search=abc"), { listClientes, countClientes });

    expect(listClientes).toHaveBeenCalledTimes(1);
  });
});

/**
 * R20 — added AFTER the e2e caught this: every unit test passed while
 * `includeInactive` was wired into the PAGE but not into this route, so
 * "ver desactivados" silently returned the active list. The query-string
 * parse is its own seam and needed its own test.
 */
describe("GET /api/customers — includeInactive (R20)", () => {
  function listSpy() {
    const listClientes = vi.fn().mockResolvedValue([]);
    const countClientes = vi.fn().mockResolvedValue(0);
    return { listClientes, countClientes };
  }

  it("does not ask for deactivated customers by default", async () => {
    const deps = listSpy();
    await handleListClientes(getReq("tecnico"), deps);

    expect(deps.listClientes.mock.calls[0][0].includeInactive).toBe(false);
  });

  it("passes includeInactive through when the query string asks for it", async () => {
    const deps = listSpy();
    await handleListClientes(getReq("tecnico", "?includeInactive=1"), deps);

    expect(deps.listClientes.mock.calls[0][0].includeInactive).toBe(true);
    expect(deps.countClientes.mock.calls[0][0].includeInactive).toBe(true);
  });

  it("reads =1 exactly, so includeInactive=0 stays off", async () => {
    const deps = listSpy();
    await handleListClientes(getReq("tecnico", "?includeInactive=0"), deps);

    expect(deps.listClientes.mock.calls[0][0].includeInactive).toBe(false);
  });

  // The near-match pass rebuilds the filter object. Dropped there, a relaxed
  // search would silently narrow back to active-only — the same class of bug
  // as the one the e2e found, one branch deeper.
  it("keeps includeInactive on the relaxed near-match pass", async () => {
    const listClientes = vi.fn().mockResolvedValue([]);
    const countClientes = vi.fn().mockResolvedValue(0);
    await handleListClientes(getReq("tecnico", "?search=50761234567&includeInactive=1"), {
      listClientes,
      countClientes,
    });

    expect(listClientes).toHaveBeenCalledTimes(2);
    expect(listClientes.mock.calls[1][0].includeInactive).toBe(true);
  });
});

/**
 * Full-flow E2E (Phase 8.1): login -> sync inventory -> filter/view ->
 * configure template -> build a selection -> enqueue -> real pg-boss +
 * real Playwright Chromium render -> uploaded -> preview/download, plus
 * 401/403 gating. See README's "Running the E2E test" for prerequisites.
 *
 * Ladder choice (coding-style ruleset): this is a Vitest request-level
 * integration test, NOT a `@playwright/test`-driven browser test — adding
 * `@playwright/test` would be a second E2E framework next to Vitest (the
 * project's only test runner so far); `playwright` (already a dependency,
 * used by pdf-generation/worker.ts) still runs a REAL Chromium render here,
 * just invoked through the app's own worker code, not from this test file
 * directly. Route Handlers are called directly with hand-built `NextRequest`
 * objects — the SAME pattern `api/template-config/route.test.ts` already
 * uses for 403 gating, just extended end-to-end. Only two boundaries are
 * mocked, both genuinely external network services this sandbox can't (and
 * production code already treats as swappable): the Interfuerza API (via
 * `runSync`'s existing `fetchProducts` injection seam) and Cloudflare R2
 * (via `vi.mock` below — R2 credentials aren't available here, and R2 is
 * the same class of external dependency the task explicitly sanctions
 * mocking "at the boundary", same as Interfuerza).
 *
 * Everything else is real: Postgres (via `DATABASE_URL`, see README),
 * Drizzle queries, pg-boss job processing (real queue engine, real advisory
 * locks), bcrypt, DB-backed sessions, and the actual Chromium `page.pdf()`
 * render.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/catalog-storage/r2", () => {
  const store = new Map<string, Buffer>();
  return {
    putObject: vi.fn(async (key: string, body: Buffer) => {
      store.set(key, body);
      return `https://fake-r2.test/${key}`;
    }),
    getObject: vi.fn(async (key: string) => store.get(key) ?? null),
    deleteObject: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

import { hashPassword } from "@/modules/auth/password";
import { SESSION_COOKIE, validateSession } from "@/modules/auth/session";
import { resolveAllPrices } from "@/modules/catalog-builder/price-lists";
import { applyVehiculoPlan } from "@/modules/customers/vehicles";
import { buildIndexSections } from "@/modules/catalog-builder/selection";
import { DEFAULT_TEMPLATE_ID } from "@/shared/template/registry";
import { listCatalogsForUser } from "@/modules/catalog-storage/queries";
import { registerPdfUploadWorker } from "@/modules/catalog-storage/upload-status";
import { countAllProducts, listCategoryL1Options, listInventory } from "@/modules/inventory-view/queries";
import { runSync } from "@/modules/inventory-sync/job";
import { listOrdenesByVehiculo } from "@/modules/service-orders/queries";
import { registerPdfGenerateWorker } from "@/modules/pdf-generation/worker";
import { proxy } from "@/proxy";
import { db } from "@/shared/db/client";
import { cliente, ordenServicio, users, vehiculo } from "@/shared/db/schema";
import { getBoss } from "@/shared/jobs/boss";

import { POST as loginPOST } from "../app/api/login/route";
import { POST as templateConfigPOST } from "../app/api/template-config/route";
import { POST as productsPOST } from "../app/api/catalog-builder/products/route";
import { POST as generatePOST } from "../app/api/catalog-builder/generate/route";
import { GET as filePOST } from "../app/api/catalogs/[id]/file/route";
import { GET as customersGET, POST as customersPOST } from "../app/api/customers/route";
import { PATCH as customersPATCH } from "../app/api/customers/[id]/route";

const PASSWORD = "Sup3rSecret!1";

function headersFor(user: { id: string; role: "tecnico" | "administrador" }) {
  return { "x-user-id": user.id, "x-user-role": user.role };
}

async function loginAs(username: string): Promise<{ id: string; role: "tecnico" | "administrador" }> {
  const response = await loginPOST(
    new NextRequest("http://localhost/api/login", { method: "POST", body: JSON.stringify({ username, password: PASSWORD }) }),
  );
  expect(response.status).toBe(200);
  const token = response.cookies.get(SESSION_COOKIE)?.value;
  expect(token).toBeTruthy();
  const user = await validateSession(token!);
  expect(user).not.toBeNull();
  return user!;
}

/**
 * AGENTS.md's "Known coverage limit" — every unit test for `listClientes`/
 * `countClientes` injects `queryFn`, so a fully green `npm test` proves ZERO
 * coverage of the real `ilike`/`or()` SQL `buildClienteSearchWhere` builds.
 * Specifically: `NULL ILIKE x` is NULL, not false, so a customer with a null
 * `phone` or `vehicle_plate` could in principle be silently dropped from the
 * `or()`. This describe calls the real `GET /api/customers` handler (no
 * injected deps) against a real Postgres to prove: mid-string case-
 * insensitive matching on name/plate, that a NULL column does not drop a row
 * matched through a different column, mid-string digit matching on phone,
 * and that the `relaxSearchTerm` near-match pass finds a row the raw
 * (unrelaxed) term cannot. Runs before the catalog-generation describe below
 * so `db.$client.end()` in that describe's `afterAll` — its own connection
 * teardown — still lands after this one, not before.
 */
describe("customer search (E2E)", () => {
  let mixedCaseName: { id: string };
  let noVehicles: { id: string };
  let nullPhone: { id: string };
  let formattedPhone: { id: string };

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });

    const [row1, row2, row3, row4] = await db
      .insert(cliente)
      .values([
        { name: "María GONZÁLEZ", phone: "50761111111" },
        { name: "Carlos Ruiz", phone: "50762222222" },
        { name: "Ana Torres", phone: null },
        // Stored with a leading "+" — `normalizePhone`'s real output shape
        // for an international number (validation.ts:47-51), i.e. what a
        // production row genuinely looks like, not a hand-formatted stub.
        { name: "Pedro Díaz", phone: "+5076444444" },
      ])
      .returning({ id: cliente.id });
    mixedCaseName = row1;
    noVehicles = row2;
    nullPhone = row3;
    formattedPhone = row4;

    // Migration `0014` (slice 3) dropped `cliente.vehicle_plate`, so a plate
    // now only ever lives in `vehiculo`. `mixedCaseName` gets TWO active
    // vehicles sharing the same "bc1" substring — that is what still proves
    // D4's `EXISTS` (not a `LEFT JOIN`): a join would emit one `cliente` row
    // PER matching vehicle here (two), which is exactly the duplication this
    // design decision exists to avoid. Before `0014` this row instead carried
    // the same plate on BOTH `cliente.vehicle_plate` and one `vehiculo` row —
    // that dedup risk is now structurally impossible (only one path to a
    // plate remains), so the fixture moved to the risk EXISTS still has to
    // cover: more than one matching vehicle on the same customer.
    //
    // Cascades with `mixedCaseName`'s deletion in `afterAll`, no separate cleanup.
    await db.insert(vehiculo).values([
      { clienteId: mixedCaseName.id, plate: "ABC111" },
      { clienteId: mixedCaseName.id, plate: "ABC112" },
    ]);
  }, 60_000);

  // Seeded rows are removed by id. Without this the describe is a one-way
  // write: `vitest.e2e.config.ts` deliberately does NOT override
  // `DATABASE_URL`, so this suite runs against whatever the environment
  // points at — a throwaway container if you were careful, the dev database
  // if you were not. Four customers per run, accumulating forever, is not a
  // cost a test is allowed to charge silently. Deleting by captured id (not
  // by name) leaves any real row that happens to share a name untouched.
  afterAll(async () => {
    // Optional chaining because a throwing `beforeAll` leaves these undefined,
    // and a TypeError in here would mask the real seed error underneath it.
    const seeded = [mixedCaseName?.id, noVehicles?.id, nullPhone?.id, formattedPhone?.id].filter(
      (id): id is string => Boolean(id),
    );
    if (seeded.length > 0) await db.delete(cliente).where(inArray(cliente.id, seeded));
  });

  const headers = { "x-user-id": "e2e-customer-search", "x-user-role": "tecnico" };

  async function search(term: string) {
    const response = await customersGET(
      new NextRequest(`http://localhost/api/customers?search=${encodeURIComponent(term)}`, { headers }),
    );
    expect(response.status).toBe(200);
    return response.json() as Promise<{ customers: { id: string }[]; total: number; relaxedFrom?: string }>;
  }

  it("matches partial, lowercase, mixed-case names (mid-string ilike, case-insensitive)", async () => {
    const body = await search("maría gonzá");
    expect(body.customers.map((c) => c.id)).toContain(mixedCaseName.id);
  });

  it("matches an accented name from an UNACCENTED term (unaccent() on both sides)", async () => {
    // The accented sibling above passes precisely by avoiding the failing
    // input: `ilike` folds case but not accents, so before migration 0012
    // 'María GONZÁLEZ' ilike '%maria gonza%' was false and staff typing the
    // name the ordinary way got zero matches plus a "create customer" button.
    // This is the only check that proves the real `unaccent()` SQL.
    const body = await search("maria gonza");
    expect(body.customers.map((c) => c.id)).toContain(mixedCaseName.id);
  });

  it("matches a partial plate (mid-string ilike on vehiculo.plate, via EXISTS)", async () => {
    const body = await search("bc11");
    expect(body.customers.map((c) => c.id)).toContain(mixedCaseName.id);
  });

  /**
   * `mixedCaseName` has TWO active vehicles ("ABC111"/"ABC112") that both
   * match "bc1". This is why `vehiculoPlateExists` is an `EXISTS` subquery
   * and not a `LEFT JOIN` (design D4): a join would emit one `cliente` row
   * PER matching vehicle (two, here) and need `DISTINCT` to hide it.
   * `toContain` cannot see that — only counting can.
   *
   * Before migration `0014` this same risk was covered by one customer
   * holding the same plate on BOTH `cliente.vehicle_plate` and a `vehiculo`
   * row (the shape `0013`'s backfill produced) — `0014` removed the flat
   * column, so that specific duplication is now structurally impossible.
   * The underlying EXISTS-vs-JOIN risk this test guards is not gone, so the
   * fixture moved to the shape that still exercises it: a customer with more
   * than one vehicle matching the same term.
   */
  it("returns one row for a customer with two vehicles matching the same term", async () => {
    const body = await search("bc11");
    const hits = body.customers.filter((c) => c.id === mixedCaseName.id);
    expect(hits).toHaveLength(1);
  });

  it("matches partial digits-only phone (mid-string ilike on phone)", async () => {
    const body = await search("622222");
    expect(body.customers.map((c) => c.id)).toContain(noVehicles.id);
  });

  // `cliente.vehicle_plate` is gone (migration 0014); `noVehicles` (Carlos
  // Ruiz) now has ZERO vehicles instead of a NULL flat plate. The risk this
  // guards is unchanged either way: `noVehicles`'s plate-match branch (`EXISTS`
  // over `vehiculo`, false for a zero-vehicle customer, never NULL) must not
  // suppress the row when a DIFFERENT branch (`name`) matches it.
  it("does not drop a zero-vehicle row from the or() when matched by name", async () => {
    const body = await search("Carlos");
    expect(body.customers.map((c) => c.id)).toContain(noVehicles.id);
  });

  it("does not silently drop a row with a NULL phone from the or() when matched by name", async () => {
    const body = await search("Torres");
    expect(body.customers.map((c) => c.id)).toContain(nullPhone.id);
  });

  it("finds a customer only through the relaxed near-match pass, not the raw term", async () => {
    // "644-4444" is dashed and has no country code; the stored phone
    // ("+5076444444") has neither dash nor a bare "644-4444" substring, so
    // the primary pass must return zero rows before relaxSearchTerm's
    // digits-only relaxation ("6444444") finds it as a substring.
    // NOTE: this is the one case in this describe that depends on the whole
    // table, not just the seeded rows — `relaxedFrom` is only set when the
    // primary pass finds ZERO rows anywhere. Run against a database that
    // already holds a customer whose phone contains "644-4444" and it goes red
    // for a reason unrelated to the code. Every other case uses `toContain`
    // and is immune. Recreate the database per run, as the header says.
    const raw = await search("644-4444");
    expect(raw.relaxedFrom).toBe("6444444");
    expect(raw.customers.map((c) => c.id)).toContain(formattedPhone.id);
  });
});

/**
 * vehicles-one-to-many (C3, design.md Testing Strategy) — the ONE thing every
 * unit test cannot prove: `service.test.ts`/`queries.test.ts` inject the
 * query seam, so a green `npm test` proves zero coverage of the real
 * `EXISTS`/`array_agg` SQL `buildClienteSearchWhere`/`listClientes` build.
 * Mirrors `customer search (E2E)` exactly: real migrate, seed via captured
 * ids, `afterAll` deletes those `cliente` ids (`vehiculo` cascades, no
 * separate cleanup needed).
 */
describe("vehicle search (E2E)", () => {
  let threeVehicles: { id: string };
  let zeroVehicles: { id: string };
  let withDeactivated: { id: string };
  /** `threeVehicles`' seeded rows, in `values()` order — AAA111, BBB222, CCC333. */
  let threeVehicleIds: string[] = [];
  /** All created by the tests below through the REAL write path, not seeded here. */
  let explicitEmptyVehicles: { id: string } | undefined;
  let collectionWrite: { id: string } | undefined;
  let collectionPatch: { id: string } | undefined;
  let collectionRoundTrip: { id: string } | undefined;
  let collectionDelete: { id: string } | undefined;
  /**
   * C4 — one customer with one vehicle that has real service history, for the
   * NOT NULL/FK/RESTRICT/SEAM proofs below. `historyOrderId` is what makes the
   * SEAM's check find a blocking row and what makes RESTRICT bite on a raw
   * vehicle delete.
   */
  let historyCliente: { id: string };
  let historyVehicleId: string;
  let historyOrderId: string;

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });

    const [row1, row2, row3] = await db
      .insert(cliente)
      .values([
        { name: "Lucía Fernández", phone: "50763333333" },
        { name: "Roberto Silva", phone: "50764444444" },
        { name: "Marta Núñez", phone: "50765555555" },
      ])
      .returning({ id: cliente.id });
    threeVehicles = row1;
    zeroVehicles = row2;
    withDeactivated = row3;

    const seededVehicles = await db
      .insert(vehiculo)
      .values([
        { clienteId: threeVehicles.id, plate: "AAA111" },
        { clienteId: threeVehicles.id, plate: "BBB222" },
        { clienteId: threeVehicles.id, plate: "CCC333" },
        { clienteId: withDeactivated.id, plate: "ZZZ999", deactivatedAt: new Date() },
      ])
      .returning({ id: vehiculo.id });
    threeVehicleIds = seededVehicles.slice(0, 3).map((v) => v.id);

    const [historyClienteRow] = await db
      .insert(cliente)
      .values({ name: "Marcos Peña", phone: "50761313131" })
      .returning({ id: cliente.id });
    historyCliente = historyClienteRow;
    const [historyVehiculoRow] = await db
      .insert(vehiculo)
      .values({ clienteId: historyCliente.id, plate: "HIS001" })
      .returning({ id: vehiculo.id });
    historyVehicleId = historyVehiculoRow.id;
    // Real orden_servicio insert (full column round trip) — proves the whole
    // migration 0015 shape (vehiculoId FK + categoria NOT NULL) as a byproduct.
    const [historyOrderRow] = await db
      .insert(ordenServicio)
      .values({ clienteId: historyCliente.id, vehiculoId: historyVehicleId, categoria: "revisado" })
      .returning({ id: ordenServicio.id });
    historyOrderId = historyOrderRow.id;
  }, 60_000);

  afterAll(async () => {
    const seeded = [
      threeVehicles?.id,
      zeroVehicles?.id,
      withDeactivated?.id,
      explicitEmptyVehicles?.id,
      collectionWrite?.id,
      collectionPatch?.id,
      collectionRoundTrip?.id,
      collectionDelete?.id,
      historyCliente?.id,
    ].filter(
      (id): id is string => Boolean(id),
    );
    if (seeded.length === 0) return;
    // `ordenServicio.clienteId` is RESTRICT (ADR-6, protect history) — the
    // cliente delete below would itself be blocked by the very constraint
    // this describe exists to prove, unless the order row goes first.
    await db.delete(ordenServicio).where(inArray(ordenServicio.clienteId, seeded));
    await db.delete(cliente).where(inArray(cliente.id, seeded));
  });

  const headers = { "x-user-id": "e2e-vehicle-search", "x-user-role": "tecnico" };

  async function search(term: string) {
    const response = await customersGET(
      new NextRequest(`http://localhost/api/customers?search=${encodeURIComponent(term)}`, { headers }),
    );
    expect(response.status).toBe(200);
    return response.json() as Promise<{ customers: { id: string; plates: string[] }[]; total: number }>;
  }

  /**
   * A `vehicles`-only PATCH: nothing scalar changes, so the collection write
   * is all that runs. `role` defaults to the describe's tecnico — permanent
   * deletion needs `customers.deleteVehicle`, which only administrador has.
   */
  async function patchVehicles(
    id: string,
    vehicles: { id?: string; plate?: string; deactivated?: boolean; deleted?: boolean }[],
    role: "tecnico" | "administrador" = "tecnico",
  ) {
    const response = await patchVehiclesRaw(id, vehicles, role);
    expect(response.status).toBe(200);
  }

  /** The same PATCH without the 200 assertion — for the cases whose POINT is a refusal. */
  async function patchVehiclesRaw(
    id: string,
    vehicles: { id?: string; plate?: string; deactivated?: boolean; deleted?: boolean }[],
    role: "tecnico" | "administrador" = "tecnico",
  ) {
    return customersPATCH(
      new NextRequest(`http://localhost/api/customers/${id}`, {
        method: "PATCH",
        headers: { ...headers, "x-user-role": role, "Content-Type": "application/json" },
        body: JSON.stringify({ vehicles }),
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  it("matches a 3-vehicle customer by the SECOND plate, not only the first", async () => {
    const body = await search("bbb2");
    expect(body.customers.map((c) => c.id)).toContain(threeVehicles.id);
  });

  it("matches a 3-vehicle customer by the THIRD plate", async () => {
    const body = await search("ccc3");
    expect(body.customers.map((c) => c.id)).toContain(threeVehicles.id);
  });

  it("still matches a zero-vehicle customer on name and phone", async () => {
    const body = await search("Roberto Silva");
    expect(body.customers.map((c) => c.id)).toContain(zeroVehicles.id);
  });

  it("excludes a soft-deleted vehicle's plate from search while its customer stays findable by name", async () => {
    const byPlate = await search("zzz9");
    expect(byPlate.customers.map((c) => c.id)).not.toContain(withDeactivated.id);

    const byName = await search("Marta Núñez");
    expect(byName.customers.map((c) => c.id)).toContain(withDeactivated.id);
  });

  /**
   * Migration `0014` (slice 3) removed the flat write path this case used to
   * exercise (`CustomerForm` sending only `vehiclePlate`, no `vehicles` key) —
   * `validateClienteInput` no longer reads that field at all, so it would now
   * silently do nothing. `createCliente`'s explicit-`vehicles: []` branch
   * replaces it: it is real hand-written SQL (`db.transaction` +
   * `planVehiculoReconcile([], [])`) with no other automated coverage —
   * `service.test.ts`'s fake `deps.database` never reaches it, and every
   * other case in this describe seeds `vehiculo` directly or sends a
   * non-empty `vehicles` array.
   */
  it("creates a customer via POST with an explicit empty vehicles array — opens the real transaction, writes nothing, still findable by name", async () => {
    const response = await customersPOST(
      new NextRequest("http://localhost/api/customers", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Sofía Ledesma", phone: "50766666666", vehicles: [] }),
      }),
    );
    expect(response.status).toBe(201);
    explicitEmptyVehicles = ((await response.json()) as { cliente: { id: string } }).cliente;

    const body = await search("Sofía Ledesma");
    const row = body.customers.find((c) => c.id === explicitEmptyVehicles!.id);
    expect(row).toBeDefined();
    expect(row?.plates).toEqual([]);
  });

  it("writes a vehicles[] payload through the REAL transaction and reads the plates back", async () => {
    // The newest hand-written SQL in this slice — `db.transaction` +
    // `applyVehiculoPlan`'s batch insert — has no other automated coverage:
    // `service.test.ts` injects `deps.database`, so a green `npm test` proves
    // zero coverage of it (AGENTS.md's "Known coverage limit"). Two plates,
    // not one, so the batch insert is a real multi-row `values()`.
    // Sorted before comparing, like the `array_agg` case below: `id` is a
    // random uuid, so `platesSubquery`'s `(created_at, id)` order is stable
    // across reads but NOT predictable from the payload — asserting a literal
    // order here would flake, not pin the ordering fix.
    const response = await customersPOST(
      new NextRequest("http://localhost/api/customers", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Diego Ramírez",
          phone: "50767777777",
          vehicles: [{ plate: "TRX001" }, { plate: "TRX002" }],
        }),
      }),
    );
    expect(response.status).toBe(201);
    collectionWrite = ((await response.json()) as { cliente: { id: string } }).cliente;

    const body = await search("trx00");
    const row = body.customers.find((c) => c.id === collectionWrite!.id);
    expect(row?.plates.slice().sort()).toEqual(["TRX001", "TRX002"]);
  });

  it("returns `plates` as a real multi-element array (array_agg), active vehicles only", async () => {
    const body = await search("Lucía Fernández");
    const row = body.customers.find((c) => c.id === threeVehicles.id);
    expect(row?.plates.slice().sort()).toEqual(["AAA111", "BBB222", "CCC333"]);
  });

  it("PATCHes the collection through the REAL transaction: an update lands, dropped vehicles deactivate, and a re-added plate becomes a NEW row", async () => {
    // `applyVehiculoPlan`'s update and deactivate branches are hand-written
    // SQL with no other automated coverage: `service.test.ts` injects
    // `deps.database`, and the soft-delete case above seeds `deactivated_at`
    // by hand instead of going through this path (AGENTS.md's "Known coverage
    // limit"). One customer, one lifecycle: create three, keep one under a new
    // plate, then re-add a dropped plate.
    const created = await customersPOST(
      new NextRequest("http://localhost/api/customers", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Elena Ortiz",
          phone: "50768888888",
          vehicles: [{ plate: "PCH001" }, { plate: "PCH002" }, { plate: "PCH003" }],
        }),
      }),
    );
    expect(created.status).toBe(201);
    collectionPatch = ((await created.json()) as { cliente: { id: string } }).cliente;

    const seeded = await db.select().from(vehiculo).where(eq(vehiculo.clienteId, collectionPatch.id));
    const keep = seeded.find((v) => v.plate === "PCH001")!;

    // Renames the kept vehicle AND drops the other two, so one PATCH exercises
    // both mutating branches. A plate the payload does not name is not "left
    // alone" — the reconcile deactivates it.
    //
    // The surviving plate deliberately shares NO prefix with the dropped ones:
    // `relaxSearchTerm` retypes a 6-char term to its first 4 chars, so a
    // survivor named `PCH009` would answer a `pch002` search through the
    // near-match pass and the deactivation assertion below would pass whether
    // or not the row was ever deactivated.
    await patchVehicles(collectionPatch.id, [{ id: keep.id, plate: "KEP009" }]);

    const afterDrop = await search("kep009");
    expect(afterDrop.customers.find((c) => c.id === collectionPatch!.id)?.plates).toEqual(["KEP009"]);
    expect((await search("pch002")).customers.map((c) => c.id)).not.toContain(collectionPatch.id);

    // D5's no-resurrection rule, where `deactivated_at` is real: re-adding
    // PCH002 with no id must write a brand new row and leave the deactivated
    // one deactivated — the property `planVehiculoReconcile`'s unit tests
    // structurally cannot see, since callers only ever hand them ACTIVE rows.
    await patchVehicles(collectionPatch.id, [{ id: keep.id, plate: "KEP009" }, { plate: "PCH002" }]);

    const rows = await db.select().from(vehiculo).where(eq(vehiculo.clienteId, collectionPatch.id));
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.plate === "PCH002")).toHaveLength(2);
    expect(rows.filter((r) => r.plate === "PCH002" && r.deactivatedAt === null)).toHaveLength(1);
  });

  it("re-sending an unchanged collection leaves a soft-deleted vehicle deactivated; only an explicit ask restores it", async () => {
    // `getClienteById` returns inactive vehicles so restore has an id to act
    // on, which makes "GET the detail, PATCH the collection back" the most
    // obvious thing a client can do. It must change nothing. The conditional
    // `deactivated_at` in `applyVehiculoPlan`'s SET that guarantees it is
    // hand-written write SQL — `vehicles.test.ts` records that patch through
    // an injected `TxLike` and never executes it (AGENTS.md's known coverage
    // limit), so a real `deactivated_at` is the only place this is proven.
    const created = await customersPOST(
      new NextRequest("http://localhost/api/customers", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Nadia Bravo",
          phone: "50769999999",
          vehicles: [{ plate: "RTR001" }, { plate: "RTR002" }],
        }),
      }),
    );
    expect(created.status).toBe(201);
    collectionRoundTrip = ((await created.json()) as { cliente: { id: string } }).cliente;

    const readRows = () => db.select().from(vehiculo).where(eq(vehiculo.clienteId, collectionRoundTrip!.id));
    const seeded = await readRows();
    const keep = seeded.find((v) => v.plate === "RTR001")!;
    const dropped = seeded.find((v) => v.plate === "RTR002")!;

    await patchVehicles(collectionRoundTrip.id, [{ id: keep.id, plate: "RTR001", deactivated: false }]);
    const deactivatedAt = (await readRows()).find((v) => v.id === dropped.id)!.deactivatedAt;
    expect(deactivatedAt).not.toBeNull();

    // The round trip: both ids named, neither asking for an activation change.
    await patchVehicles(collectionRoundTrip.id, [
      { id: keep.id, plate: "RTR001" },
      { id: dropped.id, plate: "RTR002" },
    ]);
    const afterRoundTrip = await readRows();
    expect(afterRoundTrip.find((v) => v.id === dropped.id)!.deactivatedAt).toEqual(deactivatedAt);
    expect(afterRoundTrip.find((v) => v.id === keep.id)!.deactivatedAt).toBeNull();

    // `deactivated: false` — what `CustomerForm`'s restore action sends.
    await patchVehicles(collectionRoundTrip.id, [
      { id: keep.id, plate: "RTR001", deactivated: false },
      { id: dropped.id, plate: "RTR002", deactivated: false },
    ]);
    expect((await readRows()).every((v) => v.deactivatedAt === null)).toBe(true);
  });

  it("ignores a plan naming another customer's vehicle — ownership is enforced in SQL, not by the caller", async () => {
    // No API call can reach this: `planVehiculoReconcile` rejects a foreign id
    // first. That is exactly the point — the rejection is a caller-side
    // invariant, so `applyVehiculoPlan` is called directly here with the plan a
    // buggy caller could hand it. `db` satisfies `TxLike`. Both statements are
    // scoped to `zeroVehicles`, so both must affect zero rows.
    const [rename, deactivate, remove] = threeVehicleIds;
    await applyVehiculoPlan(db, zeroVehicles.id, {
      inserts: [],
      updates: [{ id: rename, plate: "HACK01" }],
      deactivate: [deactivate],
      // The DELETE is the statement where getting this wrong is unrecoverable:
      // a mis-scoped update can be edited back, a mis-scoped delete cannot.
      delete: [remove],
    });

    const rows = await db.select().from(vehiculo).where(eq(vehiculo.clienteId, threeVehicles.id));
    expect(rows.map((r) => r.plate).sort()).toEqual(["AAA111", "BBB222", "CCC333"]);
    expect(rows.filter((r) => r.deactivatedAt !== null)).toHaveLength(0);
  });

  /**
   * `applyVehiculoPlan`'s DELETE is hand-written write SQL with no other
   * automated coverage: `vehicles.test.ts` hands it an injected `TxLike` that
   * records the rendered `where` and never executes it, so a green `npm test`
   * proves nothing about whether the row actually goes away (AGENTS.md's known
   * coverage limit). Deleting is also the one operation whose bug cannot be
   * corrected afterwards, so it gets the real database.
   */
  it("PATCHing `deleted: true` removes the row outright, where `deactivated: true` only stamps it", async () => {
    const created = await customersPOST(
      new NextRequest("http://localhost/api/customers", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Diego Salas",
          phone: "50761212121",
          vehicles: [{ plate: "DEL001" }, { plate: "DEL002" }, { plate: "DEL003" }],
        }),
      }),
    );
    expect(created.status).toBe(201);
    collectionDelete = ((await created.json()) as { cliente: { id: string } }).cliente;

    const readRows = () => db.select().from(vehiculo).where(eq(vehiculo.clienteId, collectionDelete!.id));
    const seeded = await readRows();
    const doomed = seeded.find((v) => v.plate === "DEL001")!;
    const quitado = seeded.find((v) => v.plate === "DEL002")!;
    const kept = seeded.find((v) => v.plate === "DEL003")!;

    // One PATCH, both removals, so the difference between them is what this
    // asserts rather than two independent facts: DEL001 asks to be deleted,
    // DEL002 is omitted (the form's Quitar), DEL003 stays.
    // A tecnico may not destroy the row. Asserted BEFORE the successful
    // delete so the refusal is proven against a vehicle that demonstrably
    // still existed — a 403 over an already-gone row proves nothing.
    const refused = await patchVehiclesRaw(collectionDelete.id, [{ id: doomed.id, deleted: true }]);
    expect(refused.status).toBe(403);
    expect((await readRows()).map((v) => v.id)).toContain(doomed.id);

    await patchVehicles(
      collectionDelete.id,
      [
        { id: kept.id, plate: "DEL003", deactivated: false },
        { id: doomed.id, deleted: true },
      ],
      "administrador",
    );

    const after = await readRows();
    expect(after.map((v) => v.id)).not.toContain(doomed.id);
    expect(after).toHaveLength(2);
    // The soft one survives, stamped — the row a service history would hang off.
    expect(after.find((v) => v.id === quitado.id)!.deactivatedAt).not.toBeNull();
    expect(after.find((v) => v.id === kept.id)!.deactivatedAt).toBeNull();

    // Deleting an ALREADY-deactivated vehicle is the typo'd-plate case the
    // defect was reported for: Quitar first, then discover it never should
    // have existed. Nothing in the plan re-stamps or skips it.
    await patchVehicles(
      collectionDelete.id,
      [
        { id: kept.id, plate: "DEL003" },
        { id: quitado.id, deleted: true },
      ],
      "administrador",
    );
    const afterSecond = await readRows();
    expect(afterSecond.map((v) => v.plate)).toEqual(["DEL003"]);
  });

  /**
   * C4 (service-history-per-vehicle, WU1 task 1.14) — the FK/NOT NULL/RESTRICT/
   * SEAM behaviour AGENTS.md's known coverage limit says no unit test can
   * prove: `service.test.ts`/`vehicles.test.ts` both inject their seam, so a
   * green `npm test` proves zero coverage of the real constraints migration
   * `0015` added. These raw `db.insert`/`db.delete` calls deliberately bypass
   * `createOrder`'s app-level ownership check — the point is the DATABASE
   * constraint, not the validation layer already proven in service.test.ts.
   */
  describe("service history per vehicle — NOT NULL, FK, RESTRICT, and the SEAM (C4, real Postgres)", () => {
    /**
     * Asserts the SQLSTATE, not the message text. Drizzle wraps the driver
     * error in its own `Failed query: ...` string, so matching on the outer
     * message fails — and loosening the matcher until it passes would make
     * these assert "the insert failed somehow", which every one of them would
     * satisfy for the wrong reason. The code names the exact constraint:
     * 23502 not_null_violation, 23503 foreign_key_violation.
     */
    async function rejectsWithSqlState(operation: Promise<unknown>, sqlState: string, constraint?: string) {
      const error = await operation.then(
        () => null,
        (err: unknown) => err,
      );
      expect(error, "expected the database to reject this, but it succeeded").not.toBeNull();
      const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
      expect(cause?.code).toBe(sqlState);
      if (constraint) expect(cause?.constraint).toBe(constraint);
    }

    it("rejects an orden_servicio insert with no vehiculoId — real NOT NULL", async () => {
      await rejectsWithSqlState(
        db.insert(ordenServicio).values({ clienteId: historyCliente.id, categoria: "revisado" } as never),
        "23502",
      );
    });

    it("rejects an orden_servicio insert with a nonexistent vehiculoId — real FK", async () => {
      await rejectsWithSqlState(
        db.insert(ordenServicio).values({
          clienteId: historyCliente.id,
          vehiculoId: "00000000-0000-0000-0000-000000000000",
          categoria: "revisado",
        }),
        "23503",
        "orden_servicio_vehiculo_id_vehiculo_id_fk",
      );
    });

    it("RESTRICT blocks a raw vehicle delete while an order still references it — the SEAM's backstop", async () => {
      // Names the constraint: this must fail because of the ORDER's FK, not
      // some other one the row happens to participate in.
      await rejectsWithSqlState(
        db.delete(vehiculo).where(eq(vehiculo.id, historyVehicleId)),
        "23503",
        "orden_servicio_vehiculo_id_vehiculo_id_fk",
      );
      const rows = await db.select().from(vehiculo).where(eq(vehiculo.id, historyVehicleId));
      expect(rows).toHaveLength(1);
    });

    it("SEAM: refuses permanent deletion of a vehicle with service-order history — Spanish 400, row survives", async () => {
      const response = await patchVehiclesRaw(historyCliente.id, [{ id: historyVehicleId, deleted: true }], "administrador");
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.errors).toHaveProperty("vehicles");

      const rows = await db.select().from(vehiculo).where(eq(vehiculo.id, historyVehicleId));
      expect(rows).toHaveLength(1);
      expect(rows[0].deactivatedAt).toBeNull();
    });

    it("asymmetry: deactivating that SAME vehicle still succeeds — 200, row survives, history stays queryable", async () => {
      // Omitting historyVehicleId from the payload deactivates it (D5) —
      // historyCliente has exactly one vehicle, so `vehicles: []` targets it.
      await patchVehicles(historyCliente.id, []);

      const rows = await db.select().from(vehiculo).where(eq(vehiculo.id, historyVehicleId));
      expect(rows).toHaveLength(1);
      expect(rows[0].deactivatedAt).not.toBeNull();

      const orders = await db.select().from(ordenServicio).where(eq(ordenServicio.vehiculoId, historyVehicleId));
      expect(orders.map((o) => o.id)).toContain(historyOrderId);
    });

    /**
     * C4 WU3 (task 3.4) — `listOrdenesByVehiculo`'s `queryFn`-less default is
     * hand-written SQL (`where(eq(vehiculoId, …))`) with no other automated
     * coverage: `queries.test.ts` injects `queryFn` and never runs it against
     * real Postgres. Reuses `threeVehicles` (seeded above, three vehicles on
     * ONE customer) so a bug scoping by `clienteId` instead of `vehiculoId`
     * would still pass — the real risk this proves against.
     */
    it("scopes history to one vehicle: two vehicles on the same customer, each with orders, return only the queried vehicle's rows", async () => {
      const [firstVehicleId, secondVehicleId] = threeVehicleIds;
      const [firstOrder] = await db
        .insert(ordenServicio)
        .values({ clienteId: threeVehicles.id, vehiculoId: firstVehicleId, categoria: "reparacion" })
        .returning({ id: ordenServicio.id });
      const [secondOrder] = await db
        .insert(ordenServicio)
        .values({ clienteId: threeVehicles.id, vehiculoId: secondVehicleId, categoria: "instalacion" })
        .returning({ id: ordenServicio.id });

      const firstVehicleHistory = await listOrdenesByVehiculo(firstVehicleId);
      expect(firstVehicleHistory.map((o) => o.id)).toContain(firstOrder.id);
      expect(firstVehicleHistory.map((o) => o.id)).not.toContain(secondOrder.id);

      const secondVehicleHistory = await listOrdenesByVehiculo(secondVehicleId);
      expect(secondVehicleHistory.map((o) => o.id)).toContain(secondOrder.id);
      expect(secondVehicleHistory.map((o) => o.id)).not.toContain(firstOrder.id);
    });
  });
});

describe("full catalog-generation flow (E2E)", () => {
  let regularUser: { id: string; role: "tecnico" | "administrador" };
  let adminUser: { id: string; role: "tecnico" | "administrador" };
  let otherUser: { id: string; role: "tecnico" | "administrador" };

  beforeAll(async () => {
    // Real migrations against whatever DATABASE_URL points at (README:
    // point this at a disposable Postgres, never the dev DB).
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });

    const passwordHash = await hashPassword(PASSWORD);
    await db.insert(users).values([
      { username: "e2e-user", passwordHash, role: "tecnico" },
      { username: "e2e-admin", passwordHash, role: "administrador" },
      { username: "e2e-other", passwordHash, role: "tecnico" },
    ]);

    // Real pg-boss workers — the same functions instrumentation.ts registers
    // at real server startup (see that file's header for why this is new
    // this phase: nothing called them before PR9).
    await registerPdfGenerateWorker();
    await registerPdfUploadWorker();
  }, 60_000);

  afterAll(async () => {
    const boss = await getBoss();
    await boss.stop({ close: true, graceful: false });
    await db.$client.end();
  });

  // Stale before this fix: written against a proxy.ts behavior superseded by
  // 9b789e2 ("fix: redirect unauthenticated page visits to /login instead of
  // raw 401 JSON") — a page route with no cookie now redirects (307), the
  // same as an invalid one; 401 JSON is API-routes-only (proxy.ts's
  // `isApiRoute` split). Not a WU4 defect, but blocking for the WU4 live
  // smoke this test is required to run.
  it("proxy: redirects an unauthenticated page visit; 401s an unauthenticated API call (NFR-5, R9.3)", async () => {
    const noCookiePage = await proxy(new NextRequest("http://localhost/inventory"));
    expect(noCookiePage.status).toBeGreaterThanOrEqual(300);
    expect(noCookiePage.status).toBeLessThan(400);
    expect(noCookiePage.headers.get("location")).toContain("/login");

    const badCookie = await proxy(
      new NextRequest("http://localhost/inventory", { headers: { cookie: `${SESSION_COOKIE}=not-a-real-token` } }),
    );
    expect(badCookie.status).toBeGreaterThanOrEqual(300);
    expect(badCookie.status).toBeLessThan(400);
    expect(badCookie.headers.get("location")).toContain("/login");

    const noCookieApi = await proxy(new NextRequest("http://localhost/api/catalog-builder/generate"));
    expect(noCookieApi.status).toBe(401);
  });

  it("logs in as each seeded user; wrong password is a generic 401 (R9.1/9.2)", async () => {
    regularUser = await loginAs("e2e-user");
    adminUser = await loginAs("e2e-admin");
    otherUser = await loginAs("e2e-other");

    const badLogin = await loginPOST(
      new NextRequest("http://localhost/api/login", {
        method: "POST",
        body: JSON.stringify({ username: "e2e-user", password: "wrong-password" }),
      }),
    );
    expect(badLogin.status).toBe(401);
    expect(await badLogin.json()).toEqual({ error: "invalid_credentials" });
  });

  it("syncs inventory from a mocked Interfuerza boundary, then filters it (R1, R3, R10)", async () => {
    // catalog-templates-and-workshop-info WU4: the real Interfuerza wrapper is
    // {Producto, InStock, PriceLists, Images, Matrix} (mapper.ts, fixed in
    // a828759) — a flat {id, name, price} object throws "missing a usable
    // Producto.id" in parseProduct. `Matrix` is omitted below: `parseProduct`
    // and `warnMalformedWrapper` never read it (Producto/InStock/PriceLists
    // are the only keys the mapper depends on — mapper.ts's own docstring),
    // so it is pure round-trip passthrough this fixture has no use for.
    // `priceLists` below also carries a real "0.00" tier (p2's socio price)
    // — the production-verified case R6's em-dash rule exists for (spec: "A
    // zero tier renders an em-dash").
    function wrapper(
      id: string,
      nombre: string,
      categoryL1: string,
      categoryL2: string | null,
      venta: string,
      taller: string,
      socio: string,
    ) {
      return {
        Producto: { id, Nombre: nombre, Category_L1: categoryL1, Category_L2: categoryL2, Precio_Venta: venta },
        InStock: [{ Available: "5" }],
        PriceLists: [
          { Name: "Precio de venta", Precio: venta, Precio_Real: venta },
          { Name: "PRECIO TALLER ", Precio: taller, Precio_Real: taller },
          { Name: "Precio Socio", Precio: socio, Precio_Real: socio },
        ],
        Images: [],
      };
    }

    async function* fakeInterfuerzaPage() {
      yield [
        wrapper("p1", "Filtro de aceite", "Motor", "Filtros", "10.00", "8.00", "6.00"),
        wrapper("p2", "Bujía", "Motor", "Encendido", "5.00", "4.00", "0.00"),
        wrapper("p3", "Amortiguador", "Suspensión", null, "80.00", "70.00", "60.00"),
      ];
    }

    await runSync({ mode: "manual", triggeredBy: adminUser.id }, { fetchProducts: fakeInterfuerzaPage });

    const all = await listInventory({}, { offset: 0, limit: 25 });
    expect(all.total).toBe(3);

    // The mock seeds "Motor" because that is the mixed case Interfuerza really
    // sends; `normalizeCategory` (mapper.ts, and migration 0011 for rows written
    // before it) folds the typed projection to upper case, so the stored value
    // is "MOTOR" and an exact `eq()` filter must use that. Asserting the folded
    // value here is what makes this the only end-to-end proof that the fold
    // actually reaches the database — every unit test injects its query seam.
    const motorOnly = await listInventory({ categoryL1: "MOTOR" }, { offset: 0, limit: 25 });
    expect(motorOnly.items.map((i) => i.id).sort()).toEqual(["p1", "p2"]);

    // PR10 — grand total stays 3 regardless of the active filter, unlike
    // `listInventory().total` above which is filter-scoped (motorOnly = 2).
    expect(await countAllProducts()).toBe(3);

    // Folded, and still alphabetical: the fold is what collapses the real
    // ERP's "Accesorios"/"ACCESORIOS" into one option instead of two.
    expect(await listCategoryL1Options()).toEqual(["MOTOR", "SUSPENSIÓN"]);
  });

  it("configures branding as admin; a non-admin gets 403 (R8, R9.6/NFR-8)", async () => {
    // Pre-existing, unrelated to WU4: this body carried the four legacy
    // branding fields WU3's migration 0009 dropped and validateTemplateConfigInput
    // no longer accepts (service.ts's TemplateConfigInput is `{defaultImageHandling,
    // selectedTemplateId}`). It parsed to `{}` and still returned 200 — a false
    // green that configured nothing, caught by GGA while running this WU's
    // required live smoke. Fixed to the real current shape.
    const templateBody = JSON.stringify({
      selectedTemplateId: DEFAULT_TEMPLATE_ID,
      defaultImageHandling: "strict",
    });

    const forbidden = await templateConfigPOST(
      new NextRequest("http://localhost/api/template-config", { method: "POST", headers: headersFor(regularUser), body: templateBody }),
    );
    expect(forbidden.status).toBe(403);

    const saved = await templateConfigPOST(
      new NextRequest("http://localhost/api/template-config", { method: "POST", headers: headersFor(adminUser), body: templateBody }),
    );
    expect(saved.status).toBe(200);
    expect((await saved.json()).config.selectedTemplateId).toBe(DEFAULT_TEMPLATE_ID);
  });

  it("builds a selection, enqueues it, and it reaches uploaded via the real queue+render+upload pipeline (R5, R6, R11, R12)", async () => {
    const candidatesRes = await productsPOST(
      new NextRequest("http://localhost/api/catalog-builder/products", {
        method: "POST",
        headers: headersFor(regularUser),
        // "MOTOR", not "Motor" — same folded projection as the filter above.
        body: JSON.stringify({ categories: [{ categoryL1: "MOTOR" }] }),
      }),
    );
    const { products } = await candidatesRes.json();
    expect(products).toHaveLength(2);

    // The only real exercise of queries.ts's hand-built jsonb extraction
    // (AGENTS.md: the injected-dep seam means a fully green `npm test` run
    // proves ZERO coverage of it) — same resolution `CatalogBuilderForm`'s
    // `reviewedProducts` does, against the real Postgres row this query just
    // read. p2's real "0.00" socio tier (design D4/R6) must collapse to null.
    const reviewedProducts = products.map((p: (typeof products)[number]) => ({
      ...p,
      prices: resolveAllPrices(p.priceLists),
    }));
    const bujia = reviewedProducts.find((p: { id: string }) => p.id === "p2");
    expect(bujia.prices).toEqual({ venta: 5, taller: 4, socio: null });

    const sections = buildIndexSections(products);
    // `catalogs.generate` is admin-only in the real MATRIX (policy.ts) — this
    // step used `regularUser` (tecnico) before this fix, which the matrix has
    // always rejected with 403 (verified: `catalogs.generate: false` for
    // tecnico since the very first commit that introduced it, edd86d7). Not a
    // WU4 defect, but blocking for this required live smoke.
    const generateRes = await generatePOST(
      new NextRequest("http://localhost/api/catalog-builder/generate", {
        method: "POST",
        headers: headersFor(adminUser),
        body: JSON.stringify({
          title: "Catalog: Motor",
          sections,
          products: reviewedProducts,
          productsPerPage: 10,
          includedCategoryCount: 1,
        }),
      }),
    );
    expect(generateRes.status).toBe(200);
    const { jobId } = await generateRes.json();
    expect(jobId).toBeTruthy();

    // Real pg-boss processing (render worker + upload worker) — poll instead
    // of a fixed sleep since job pickup timing isn't deterministic.
    let catalog;
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      [catalog] = await listCatalogsForUser(adminUser.id);
      if (catalog?.uploadStatus === "uploaded" || catalog?.uploadStatus === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(catalog?.uploadStatus).toBe("uploaded");

    const fileRes = await filePOST(new NextRequest(`http://localhost/api/catalogs/${catalog!.id}/file`, { headers: headersFor(adminUser) }), {
      params: Promise.resolve({ id: catalog!.id }),
    });
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get("content-type")).toBe("application/pdf");
    const bytes = Buffer.from(await fileRes.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF"); // real Chromium-rendered PDF, not a stub buffer

    // R7 ownership check — a different, non-admin user must not see it (404, not 403 — no existence signal).
    const denied = await filePOST(new NextRequest(`http://localhost/api/catalogs/${catalog!.id}/file`, { headers: headersFor(otherUser) }), {
      params: Promise.resolve({ id: catalog!.id }),
    });
    expect(denied.status).toBe(404);
  });
});
